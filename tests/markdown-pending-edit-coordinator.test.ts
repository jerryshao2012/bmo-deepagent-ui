import assert from "node:assert/strict";
import test from "node:test";

import {
  MarkdownPendingEditCoordinator,
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
