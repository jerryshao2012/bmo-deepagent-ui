import assert from "node:assert/strict";
import test from "node:test";

import {
  PreviewFocusRestoration,
  type AnimationFrameScheduler,
} from "../src/features/markdown-sync/application/preview-focus-restoration";

class FakeAnimationFrameScheduler implements AnimationFrameScheduler {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();

  request(callback: () => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

test("focus restoration schedules one deferred restore", () => {
  const scheduler = new FakeAnimationFrameScheduler();
  const restoration = new PreviewFocusRestoration(scheduler);
  let focusCalls = 0;

  restoration.schedule(
    () => {
      focusCalls += 1;
    },
    () => true
  );
  assert.equal(focusCalls, 0);

  scheduler.flush();
  scheduler.flush();
  assert.equal(focusCalls, 1);
});

test("focus restoration cancellation blocks a scheduled restore", () => {
  const scheduler = new FakeAnimationFrameScheduler();
  const restoration = new PreviewFocusRestoration(scheduler);
  let focusCalls = 0;

  restoration.schedule(
    () => {
      focusCalls += 1;
    },
    () => true
  );
  restoration.cancel();
  scheduler.flush();

  assert.equal(focusCalls, 0);
});

test("rescheduling focus restoration replaces the previous restore", () => {
  const scheduler = new FakeAnimationFrameScheduler();
  const restoration = new PreviewFocusRestoration(scheduler);
  const restored: string[] = [];

  restoration.schedule(
    () => restored.push("old"),
    () => true
  );
  restoration.schedule(
    () => restored.push("new"),
    () => true
  );
  scheduler.flush();

  assert.deepEqual(restored, ["new"]);
});

test("focus restoration checks eligibility when the frame runs", () => {
  const scheduler = new FakeAnimationFrameScheduler();
  const restoration = new PreviewFocusRestoration(scheduler);
  let focusCalls = 0;

  restoration.schedule(
    () => {
      focusCalls += 1;
    },
    () => false
  );
  scheduler.flush();

  assert.equal(focusCalls, 0);
});
