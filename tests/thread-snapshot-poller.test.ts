import assert from "node:assert/strict";
import test from "node:test";

import {
  THREAD_SNAPSHOT_POLL_MS,
  THREAD_SNAPSHOT_RETRY_MS,
  ThreadSnapshotPoller,
  type ThreadSnapshotPollerScheduler,
} from "../src/features/chat/application/thread-snapshot-poller";

class FakeScheduler implements ThreadSnapshotPollerScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();
  readonly delays: number[] = [];

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    this.delays.push(delayMs);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  runNext(): void {
    const next = this.callbacks.entries().next().value as
      | [number, () => void]
      | undefined;
    if (!next) throw new Error("No scheduled callback");
    this.callbacks.delete(next[0]);
    next[1]();
  }

  get size(): number {
    return this.callbacks.size;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("starts immediately then polls at normal cadence after success", async () => {
  const scheduler = new FakeScheduler();
  const delivered: number[] = [];
  let requests = 0;
  const poller = new ThreadSnapshotPoller(
    async () => ++requests,
    (value) => delivered.push(value),
    scheduler
  );

  poller.start();
  await settle();

  assert.equal(requests, 1);
  assert.deepEqual(delivered, [1]);
  assert.deepEqual(scheduler.delays, [THREAD_SNAPSHOT_POLL_MS]);

  scheduler.runNext();
  await settle();

  assert.equal(requests, 2);
  assert.deepEqual(delivered, [1, 2]);
  assert.deepEqual(scheduler.delays, [
    THREAD_SNAPSHOT_POLL_MS,
    THREAD_SNAPSHOT_POLL_MS,
  ]);
});

test("backs off transient failures through capped retry delays", async () => {
  const scheduler = new FakeScheduler();
  const poller = new ThreadSnapshotPoller(
    async () => Promise.reject(new Error("offline")),
    () => {},
    scheduler
  );

  poller.start();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await settle();
    if (attempt < 4) scheduler.runNext();
  }

  assert.deepEqual(scheduler.delays, [
    ...THREAD_SNAPSHOT_RETRY_MS,
    THREAD_SNAPSHOT_RETRY_MS.at(-1),
  ]);
});

test("success resets transient retry backoff", async () => {
  const scheduler = new FakeScheduler();
  let requests = 0;
  const poller = new ThreadSnapshotPoller(
    async () => {
      requests += 1;
      if (requests === 2) return "recovered";
      throw new Error("offline");
    },
    () => {},
    scheduler
  );

  poller.start();
  await settle();
  scheduler.runNext();
  await settle();
  scheduler.runNext();
  await settle();

  assert.deepEqual(scheduler.delays, [
    THREAD_SNAPSHOT_RETRY_MS[0],
    THREAD_SNAPSHOT_POLL_MS,
    THREAD_SNAPSHOT_RETRY_MS[0],
  ]);
});

for (const [name, error] of [
  ["status", { status: 404 }],
  ["statusCode", { statusCode: 404 }],
  ["nested response status", { response: { status: 404 } }],
] as const) {
  test(`stops silently after a missing snapshot reported by ${name}`, async () => {
    const scheduler = new FakeScheduler();
    let delivered = 0;
    const poller = new ThreadSnapshotPoller(
      async () => Promise.reject(error),
      () => {
        delivered += 1;
      },
      scheduler
    );

    poller.start();
    await settle();

    assert.equal(delivered, 0);
    assert.equal(scheduler.size, 0);
    assert.deepEqual(scheduler.delays, []);
  });
}

test("unknown failure remains a transient retry", async () => {
  const scheduler = new FakeScheduler();
  const poller = new ThreadSnapshotPoller(
    async () => Promise.reject(undefined),
    () => {},
    scheduler
  );

  poller.start();
  await settle();

  assert.deepEqual(scheduler.delays, [THREAD_SNAPSHOT_RETRY_MS[0]]);
});

test("delivery failure retries without an unhandled rejection", async () => {
  const scheduler = new FakeScheduler();
  const unhandled: unknown[] = [];
  const captureUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", captureUnhandled);

  try {
    const poller = new ThreadSnapshotPoller(
      async () => "snapshot",
      () => {
        throw new Error("delivery failed");
      },
      scheduler
    );

    poller.start();
    await settle();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(unhandled, []);
    assert.deepEqual(scheduler.delays, [THREAD_SNAPSHOT_RETRY_MS[0]]);
  } finally {
    process.off("unhandledRejection", captureUnhandled);
  }
});

test("waits for each request to settle before scheduling another", async () => {
  const scheduler = new FakeScheduler();
  const request = deferred<number>();
  let calls = 0;
  const poller = new ThreadSnapshotPoller(
    () => {
      calls += 1;
      return request.promise;
    },
    () => {},
    scheduler
  );

  poller.start();
  assert.equal(calls, 1);
  assert.equal(scheduler.size, 0);

  request.resolve(1);
  await settle();

  assert.equal(calls, 1);
  assert.equal(scheduler.size, 1);
});

test("repeated start does not overlap a pending lifecycle request", () => {
  const scheduler = new FakeScheduler();
  const request = deferred<number>();
  let calls = 0;
  const poller = new ThreadSnapshotPoller(
    () => {
      calls += 1;
      return request.promise;
    },
    () => {},
    scheduler
  );

  poller.start();
  poller.start();

  assert.equal(calls, 1);
  assert.equal(scheduler.size, 0);
});

test("stop cancels a pending poll", async () => {
  const scheduler = new FakeScheduler();
  const poller = new ThreadSnapshotPoller(
    async () => "snapshot",
    () => {},
    scheduler
  );

  poller.start();
  await settle();
  assert.equal(scheduler.size, 1);

  poller.stop();

  assert.equal(scheduler.size, 0);
});

test("late response after stop is neither delivered nor rescheduled", async () => {
  const scheduler = new FakeScheduler();
  const request = deferred<string>();
  const delivered: string[] = [];
  const poller = new ThreadSnapshotPoller(
    () => request.promise,
    (value) => delivered.push(value),
    scheduler
  );

  poller.start();
  poller.stop();
  request.resolve("stale");
  await settle();

  assert.deepEqual(delivered, []);
  assert.equal(scheduler.size, 0);
  assert.deepEqual(scheduler.delays, []);
});

test("stop then start ignores old response and delivers fresh lifecycle", async () => {
  const scheduler = new FakeScheduler();
  const oldRequest = deferred<string>();
  const freshRequest = deferred<string>();
  const delivered: string[] = [];
  let calls = 0;
  const poller = new ThreadSnapshotPoller(
    () => {
      calls += 1;
      return calls === 1 ? oldRequest.promise : freshRequest.promise;
    },
    (value) => delivered.push(value),
    scheduler
  );

  poller.start();
  poller.stop();
  poller.start();
  oldRequest.resolve("old");
  await settle();

  assert.deepEqual(delivered, []);
  assert.equal(scheduler.size, 0);

  freshRequest.resolve("fresh");
  await settle();

  assert.deepEqual(delivered, ["fresh"]);
  assert.deepEqual(scheduler.delays, [THREAD_SNAPSHOT_POLL_MS]);
});
