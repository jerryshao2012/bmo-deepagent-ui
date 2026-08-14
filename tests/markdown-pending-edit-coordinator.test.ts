import assert from "node:assert/strict";
import test from "node:test";

import {
  MarkdownPendingEditCoordinator,
  resolveMarkdownWebSocketSync,
  type FallbackWriteContext,
  type PendingEditCoordinatorScheduler,
  type PendingMarkdownEdit,
} from "../src/features/markdown-sync/application/pending-edit-coordinator";

class FakeScheduler implements PendingEditCoordinatorScheduler {
  private nextId = 1;
  private readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  runAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("delayed fallback initial flushes latest A to B edit", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const writes: PendingMarkdownEdit[] = [];
  coordinator.publish("111111", "A", false);
  const generation = coordinator.startFallback("111111", async (edit) => {
    writes.push(edit);
  });

  coordinator.publish("111111", "B", true);
  assert.deepEqual(writes, []);

  coordinator.markFallbackInitialSeen(generation);
  await settle();

  assert.deepEqual(
    writes.map((edit) => edit.content),
    ["B"]
  );
  assert.equal(coordinator.pendingForThread("111111"), null);
});

test("old fallback response cannot clear newer ABA edit", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const firstWrite = deferred<void>();
  const secondWrite = deferred<void>();
  const writes: PendingMarkdownEdit[] = [];
  const generation = coordinator.startFallback("111111", (edit) => {
    writes.push(edit);
    return writes.length === 1 ? firstWrite.promise : secondWrite.promise;
  });
  coordinator.markFallbackInitialSeen(generation);
  const first = coordinator.publish("111111", "A", false);
  await settle();
  const second = coordinator.publish("111111", "A", true);

  firstWrite.resolve();
  await settle();

  assert.notEqual(first.operationId, second.operationId);
  assert.equal(
    coordinator.pendingForThread("111111")?.operationId,
    second.operationId
  );
  assert.deepEqual(
    writes.map((edit) => edit.operationId),
    [first.operationId, second.operationId]
  );

  secondWrite.resolve();
  await settle();
  assert.equal(coordinator.pendingForThread("111111"), null);
});

test("hibernate aborts old generation without blocking new thread writes", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const oldWrite = deferred<void>();
  const newWrite = deferred<void>();
  let oldContext: FallbackWriteContext | undefined;
  const oldGeneration = coordinator.startFallback(
    "111111",
    (_edit, context) => {
      oldContext = context;
      return oldWrite.promise;
    }
  );
  coordinator.markFallbackInitialSeen(oldGeneration);
  coordinator.publish("111111", "old", false);
  await settle();

  coordinator.stopFallback();
  assert.equal(oldContext?.signal.aborted, true);

  coordinator.switchThread("222222");
  const newWrites: PendingMarkdownEdit[] = [];
  const newGeneration = coordinator.startFallback("222222", (edit) => {
    newWrites.push(edit);
    return newWrite.promise;
  });
  coordinator.markFallbackInitialSeen(newGeneration);
  const current = coordinator.publish("222222", "new", false);
  await settle();
  assert.deepEqual(
    newWrites.map((edit) => edit.operationId),
    [current.operationId]
  );

  oldWrite.resolve();
  await settle();
  assert.equal(
    coordinator.pendingForThread("222222")?.operationId,
    current.operationId
  );

  newWrite.resolve();
  await settle();
  assert.equal(coordinator.pendingForThread("222222"), null);
});

test("failed write retains latest edit for immediate promotion to a new generation", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const failures: unknown[] = [];
  const firstGeneration = coordinator.startFallback(
    "111111",
    async () => {
      throw new Error("offline");
    },
    { onWriteError: (error) => failures.push(error) }
  );
  coordinator.markFallbackInitialSeen(firstGeneration);
  const edit = coordinator.publish("111111", "latest", false);
  await settle();

  assert.equal(failures.length, 1);
  assert.equal(
    coordinator.pendingForThread("111111")?.operationId,
    edit.operationId
  );

  const promoted: PendingMarkdownEdit[] = [];
  const nextGeneration = coordinator.startFallback(
    "111111",
    async (pending) => {
      promoted.push(pending);
    }
  );
  coordinator.markFallbackInitialSeen(nextGeneration);
  await settle();

  assert.deepEqual(
    promoted.map((pending) => pending.operationId),
    [edit.operationId]
  );
  assert.equal(coordinator.pendingForThread("111111"), null);
});

test("failed active fallback write redrives without waiting for page polling", async () => {
  const scheduler = new FakeScheduler();
  const coordinator = new MarkdownPendingEditCoordinator(scheduler);
  let attempts = 0;
  const generation = coordinator.startFallback("111111", async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
  });
  coordinator.markFallbackInitialSeen(generation);
  coordinator.publish("111111", "latest", false);
  await settle();

  assert.equal(attempts, 1);
  assert.equal(coordinator.pendingForThread("111111")?.content, "latest");

  scheduler.runAll();
  await settle();

  assert.equal(attempts, 2);
  assert.equal(coordinator.pendingForThread("111111"), null);
});

test("empty delete remains a versioned pending operation", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const writes: PendingMarkdownEdit[] = [];
  const edit = coordinator.publish("111111", "", true);
  const generation = coordinator.startFallback("111111", async (pending) => {
    writes.push(pending);
  });

  assert.equal(
    coordinator.pendingForThread("111111")?.operationId,
    edit.operationId
  );
  coordinator.markFallbackInitialSeen(generation);
  await settle();

  assert.equal(writes[0]?.content, "");
  assert.equal(coordinator.pendingForThread("111111"), null);
});

test("fallback readiness waits for both initial barrier and current acceptance", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const write = deferred<void>();
  let readyCalls = 0;
  const generation = coordinator.startFallback("111111", () => write.promise, {
    onReady: () => (readyCalls += 1),
  });
  coordinator.publish("111111", "pending", false);

  coordinator.markFallbackInitialSeen(generation);
  await settle();
  assert.equal(readyCalls, 0);

  write.resolve();
  await settle();
  assert.equal(readyCalls, 1);

  coordinator.markFallbackInitialSeen(generation);
  assert.equal(readyCalls, 1);
});

test("WebSocket resolver rejects stale ABA acknowledgements until exact A3 echo", () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const clientId = "md-client_123";
  const first = coordinator.publish("111111", "A", false);
  const second = coordinator.publish("111111", "B", false);
  const third = coordinator.publish("111111", "A", true);

  for (const incoming of [
    { content: "A", clientId, operationId: first.operationId },
    { content: "B", clientId, operationId: second.operationId },
    { content: "A" },
  ]) {
    assert.deepEqual(
      resolveMarkdownWebSocketSync({
        incoming,
        localClientId: clientId,
        pendingEdit: third,
      }),
      { action: "ignore" }
    );
    assert.equal(
      coordinator.pendingForThread("111111")?.operationId,
      third.operationId
    );
  }

  const exact = resolveMarkdownWebSocketSync({
    incoming: {
      content: "A",
      clientId,
      operationId: third.operationId,
    },
    localClientId: clientId,
    pendingEdit: third,
  });
  assert.deepEqual(exact, {
    action: "apply",
    acknowledgeOperationId: third.operationId,
  });
  coordinator.acknowledgeWebSocket("111111", exact.acknowledgeOperationId);
  assert.equal(coordinator.pendingForThread("111111"), null);
});

test("WebSocket resolver resends pending edit at initial barrier without exact echo", () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  const pendingEdit = coordinator.publish("111111", "local", false);

  for (const incoming of [
    { content: "remote", initial: true },
    {
      content: "local",
      initial: true,
      clientId: { arbitrary: true },
      operationId: pendingEdit.operationId,
    },
    {
      content: "local",
      initial: true,
      clientId: "md-client_123",
      operationId: "1",
    },
  ]) {
    assert.deepEqual(
      resolveMarkdownWebSocketSync({
        incoming,
        localClientId: "md-client_123",
        pendingEdit,
      }),
      { action: "resend" }
    );
  }
});

test("WebSocket resolver applies remote sync when no local edit is pending", () => {
  assert.deepEqual(
    resolveMarkdownWebSocketSync({
      incoming: { content: "remote" },
      localClientId: "md-client_123",
      pendingEdit: null,
    }),
    { action: "apply" }
  );
});

test("delayed browser cache read cannot replace a newer pending local edit", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  coordinator.switchThread("111111");
  const cacheLoad = deferred<string | null>();

  const read = coordinator.readCurrent("111111", () => cacheLoad.promise);
  const localEdit = coordinator.publish("111111", "new local", false);
  cacheLoad.resolve("stale cache");

  assert.deepEqual(await read, { current: false });
  assert.equal(
    coordinator.pendingForThread("111111")?.operationId,
    localEdit.operationId
  );
});

test("backend read cannot apply while its mirrored edit still awaits WebSocket acknowledgement", async () => {
  const coordinator = new MarkdownPendingEditCoordinator();
  coordinator.switchThread("111111");
  const backendLoad = deferred<string | null>();

  const read = coordinator.readCurrent("111111", () => backendLoad.promise);
  const localEdit = coordinator.publish("111111", "new local", false);
  // Backend mirror completion does not acknowledge the independent WebSocket write.
  backendLoad.resolve("older remote");

  assert.deepEqual(await read, { current: false });
  assert.equal(
    coordinator.pendingForThread("111111")?.operationId,
    localEdit.operationId
  );
});
