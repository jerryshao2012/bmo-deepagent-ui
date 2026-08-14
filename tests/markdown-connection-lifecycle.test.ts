import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKDOWN_AUTO_CLOSE_SECONDS,
  MARKDOWN_COUNTDOWN_TICK_MS,
  MARKDOWN_INACTIVITY_MS,
  MarkdownConnectionLifecycle,
  type ConnectionScheduler,
  type MarkdownConnectionEffects,
  type MarkdownConnectionStatus,
  WEBSOCKET_ATTEMPT_TIMEOUT_MS,
  WEBSOCKET_RETRY_DELAYS_MS,
  WEBSOCKET_UPGRADE_INTERVAL_MS,
} from "../src/features/markdown-sync/application/connection-lifecycle";

class FakeScheduler implements ConnectionScheduler {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<
    number,
    { callback: () => void; deadline: number; delayMs: number }
  >();
  private readonly retainedCallbacks: Array<() => void> = [];
  private readonly retainedClearCounts = new Map<number, number>();

  constructor(retainedClearDelays: readonly number[] = []) {
    for (const delayMs of retainedClearDelays) {
      this.retainedClearCounts.set(
        delayMs,
        (this.retainedClearCounts.get(delayMs) ?? 0) + 1,
      );
    }
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, {
      callback,
      deadline: this.now + delayMs,
      delayMs,
    });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number;
    const timer = this.timers.get(id);
    const retainCount = timer
      ? (this.retainedClearCounts.get(timer.delayMs) ?? 0)
      : 0;
    if (timer && retainCount > 0) {
      this.retainedClearCounts.set(timer.delayMs, retainCount - 1);
      this.timers.delete(id);
      this.retainedCallbacks.push(timer.callback);
      return;
    }
    this.timers.delete(id);
  }

  get pendingTimerCount(): number {
    return this.timers.size;
  }

  runRetainedCallback(): void {
    const callback = this.retainedCallbacks.shift();
    if (!callback) throw new Error("Expected a retained callback");
    callback();
  }

  advanceBy(delayMs: number): void {
    const target = this.now + delayMs;

    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.deadline <= target)
        .sort(
          ([leftId, left], [rightId, right]) =>
            left.deadline - right.deadline || leftId - rightId,
        )[0];

      if (!next) break;

      const [id, timer] = next;
      this.now = timer.deadline;
      this.timers.delete(id);
      timer.callback();
    }

    this.now = target;
  }
}

class EffectRecorder implements MarkdownConnectionEffects {
  connectWebSocketCalls = 0;
  abortWebSocketAttemptCalls = 0;
  readonly connectedAttemptIds: number[] = [];
  readonly abortedAttemptIds: number[] = [];
  startFallbackCalls = 0;
  stopFallbackCalls = 0;
  startCrossDeploySyncCalls = 0;
  stopAllTransportsCalls = 0;
  readonly countdowns: Array<number | null> = [];
  requestAutoCloseCalls = 0;
  onRequestAutoClose: (() => void) | undefined;
  onSetAutoCloseCountdown:
    | ((seconds: number | null) => void)
    | undefined;
  onStopAllTransports: (() => void) | undefined;
  onSetStatus: ((status: MarkdownConnectionStatus) => void) | undefined;
  readonly statuses: MarkdownConnectionStatus[] = [];

  connectWebSocket(attemptId: number): void {
    this.connectWebSocketCalls += 1;
    this.connectedAttemptIds.push(attemptId);
  }

  abortWebSocketAttempt(attemptId: number): void {
    this.abortWebSocketAttemptCalls += 1;
    this.abortedAttemptIds.push(attemptId);
  }

  startFallback(): void {
    this.startFallbackCalls += 1;
  }

  stopFallback(): void {
    this.stopFallbackCalls += 1;
  }

  startCrossDeploySync(): void {
    this.startCrossDeploySyncCalls += 1;
  }

  stopAllTransports(): void {
    this.stopAllTransportsCalls += 1;
    this.onStopAllTransports?.();
  }

  setStatus(status: MarkdownConnectionStatus): void {
    this.statuses.push(status);
    this.onSetStatus?.(status);
  }

  setAutoCloseCountdown(seconds: number | null): void {
    this.countdowns.push(seconds);
    this.onSetAutoCloseCountdown?.(seconds);
  }

  requestAutoClose(): void {
    this.requestAutoCloseCalls += 1;
    this.onRequestAutoClose?.();
  }

  get status(): MarkdownConnectionStatus | undefined {
    return this.statuses.at(-1);
  }

  get currentAttemptId(): number {
    const attemptId = this.connectedAttemptIds.at(-1);
    if (attemptId === undefined) {
      throw new Error("Expected an active WebSocket attempt");
    }
    return attemptId;
  }
}

function createLifecycle(scheduler = new FakeScheduler()) {
  const effects = new EffectRecorder();
  const lifecycle = new MarkdownConnectionLifecycle(effects, scheduler);

  return { effects, lifecycle, scheduler };
}

function wake(lifecycle: MarkdownConnectionLifecycle): void {
  lifecycle.setVisibility(true);
  lifecycle.setDialogOpen(true);
}

function failCurrent(
  lifecycle: MarkdownConnectionLifecycle,
  effects: EffectRecorder,
): void {
  lifecycle.connectionFailed(effects.currentAttemptId);
}

function openCurrent(
  lifecycle: MarkdownConnectionLifecycle,
  effects: EffectRecorder,
): void {
  lifecycle.socketOpened(effects.currentAttemptId);
}

function onNextIdleEffect(
  effects: EffectRecorder,
  boundary: "stopAllTransports" | "setStatus",
  callback: () => void,
): void {
  if (boundary === "stopAllTransports") {
    effects.onStopAllTransports = () => {
      effects.onStopAllTransports = undefined;
      callback();
    };
    return;
  }

  effects.onSetStatus = (status) => {
    if (status !== "idle") return;
    effects.onSetStatus = undefined;
    callback();
  };
}

function reachFallback(
  lifecycle: MarkdownConnectionLifecycle,
  scheduler: FakeScheduler,
  effects: EffectRecorder,
): void {
  failCurrent(lifecycle, effects);
  for (const retryDelay of WEBSOCKET_RETRY_DELAYS_MS) {
    scheduler.advanceBy(retryDelay);
    failCurrent(lifecycle, effects);
  }
}

test("exports exact markdown connection timing values", () => {
  assert.equal(MARKDOWN_AUTO_CLOSE_SECONDS, 5);
  assert.equal(MARKDOWN_COUNTDOWN_TICK_MS, 1_000);
  assert.equal(MARKDOWN_INACTIVITY_MS, 300_000);
  assert.equal(WEBSOCKET_ATTEMPT_TIMEOUT_MS, 10_000);
  assert.deepEqual(WEBSOCKET_RETRY_DELAYS_MS, [1_000, 2_000, 4_000]);
  assert.equal(WEBSOCKET_UPGRADE_INTERVAL_MS, 60_000);
});

test("initial ineligible reconciliation publishes idle and stops transports once", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();

  lifecycle.setDialogOpen(false);
  lifecycle.setVisibility(false);

  assert.equal(effects.status, "idle");
  assert.equal(effects.stopAllTransportsCalls, 1);
  assert.equal(scheduler.pendingTimerCount, 0);
});

test("closed dialog and hidden tab remain idle", () => {
  const closed = createLifecycle();
  closed.lifecycle.setVisibility(true);

  assert.equal(closed.lifecycle.isEligible(), false);
  assert.equal(closed.effects.connectWebSocketCalls, 0);

  const hidden = createLifecycle();
  hidden.lifecycle.setVisibility(false);
  hidden.lifecycle.setDialogOpen(true);

  assert.equal(hidden.lifecycle.isEligible(), false);
  assert.equal(hidden.effects.connectWebSocketCalls, 0);
});

test("open visible dialog wakes client", () => {
  const { effects, lifecycle } = createLifecycle();

  wake(lifecycle);

  assert.equal(lifecycle.isEligible(), true);
  assert.equal(effects.connectWebSocketCalls, 1);
  assert.equal(effects.status, "connecting");
});

test("five minutes hibernates transport before exact countdown and one close", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);
  assert.equal(effects.status, "connected");
  assert.equal(effects.stopAllTransportsCalls, 1);

  scheduler.advanceBy(1);
  assert.equal(effects.status, "idle");
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.deepEqual(effects.countdowns, [5]);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(scheduler.pendingTimerCount, 1);

  for (const remaining of [4, 3, 2, 1]) {
    scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);
    assert.equal(effects.countdowns.at(-1), remaining);
    assert.equal(effects.stopAllTransportsCalls, 2);
    assert.equal(effects.requestAutoCloseCalls, 0);
    assert.equal(scheduler.pendingTimerCount, 1);
  }

  scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);
  assert.equal(effects.countdowns.at(-1), null);
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(effects.requestAutoCloseCalls, 1);
  assert.equal(scheduler.pendingTimerCount, 0);
});

for (const boundary of ["stopAllTransports", "setStatus"] as const) {
  test(`inactivity rechecks epoch after reentrant activity from ${boundary}`, () => {
    const { effects, lifecycle, scheduler } = createLifecycle();
    wake(lifecycle);
    openCurrent(lifecycle, effects);
    onNextIdleEffect(effects, boundary, () => lifecycle.recordActivity());

    scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

    assert.deepEqual(effects.countdowns, []);
    assert.equal(effects.requestAutoCloseCalls, 0);
    assert.equal(effects.connectWebSocketCalls, 2);
    assert.equal(effects.stopAllTransportsCalls, 2);
    assert.equal(effects.status, "connecting");
    assert.equal(scheduler.pendingTimerCount, 2);
  });
}

for (const action of ["activity", "visibility", "dispose"] as const) {
  test(`countdown start rechecks after reentrant ${action}`, () => {
    const { effects, lifecycle, scheduler } = createLifecycle();
    wake(lifecycle);
    openCurrent(lifecycle, effects);
    effects.onSetAutoCloseCountdown = (seconds) => {
      if (seconds !== MARKDOWN_AUTO_CLOSE_SECONDS) return;
      effects.onSetAutoCloseCountdown = undefined;
      if (action === "activity") lifecycle.recordActivity();
      if (action === "visibility") lifecycle.setVisibility(false);
      if (action === "dispose") lifecycle.dispose();
    };

    scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

    assert.deepEqual(effects.countdowns, [5, null]);
    assert.equal(effects.requestAutoCloseCalls, 0);
    assert.equal(
      scheduler.pendingTimerCount,
      action === "activity" ? 2 : 0,
    );
    assert.equal(
      effects.connectWebSocketCalls,
      action === "activity" ? 2 : 1,
    );
  });
}

test("countdown tick rechecks epoch after reentrant activity", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  effects.onSetAutoCloseCountdown = (seconds) => {
    if (seconds !== 4) return;
    effects.onSetAutoCloseCountdown = undefined;
    lifecycle.recordActivity();
  };

  scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);

  assert.deepEqual(effects.countdowns, [5, 4, null]);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.connectWebSocketCalls, 2);
  assert.equal(scheduler.pendingTimerCount, 2);
});

test("inactivity rechecks eligibility after visibility changes in stop effect", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  onNextIdleEffect(effects, "stopAllTransports", () =>
    lifecycle.setVisibility(false),
  );

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  assert.equal(lifecycle.isEligible(), false);
  assert.deepEqual(effects.countdowns, []);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(effects.status, "idle");
  assert.equal(scheduler.pendingTimerCount, 0);
});

test("inactivity rechecks eligibility after dialog closes in status effect", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  onNextIdleEffect(effects, "setStatus", () => lifecycle.setDialogOpen(false));

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  assert.equal(lifecycle.isEligible(), false);
  assert.deepEqual(effects.countdowns, []);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(effects.status, "idle");
  assert.equal(scheduler.pendingTimerCount, 0);
});

for (const boundary of ["stopAllTransports", "setStatus"] as const) {
  test(`inactivity rechecks disposal after reentrant ${boundary}`, () => {
    const { effects, lifecycle, scheduler } = createLifecycle();
    wake(lifecycle);
    openCurrent(lifecycle, effects);
    onNextIdleEffect(effects, boundary, () => lifecycle.dispose());

    scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

    assert.equal(lifecycle.isEligible(), false);
    assert.deepEqual(effects.countdowns, []);
    assert.equal(effects.requestAutoCloseCalls, 0);
    assert.equal(effects.stopAllTransportsCalls, 3);
    assert.equal(
      effects.status,
      boundary === "stopAllTransports" ? "connected" : "idle",
    );
    assert.equal(scheduler.pendingTimerCount, 0);
  });
}

test("activity at countdown three clears warning, wakes once, and resets five minutes", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  scheduler.advanceBy(2 * MARKDOWN_COUNTDOWN_TICK_MS);
  assert.deepEqual(effects.countdowns, [5, 4, 3]);

  lifecycle.recordActivity();
  assert.deepEqual(effects.countdowns, [5, 4, 3, null]);
  assert.equal(effects.connectWebSocketCalls, 2);
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(effects.status, "connecting");
  assert.equal(scheduler.pendingTimerCount, 2);
  openCurrent(lifecycle, effects);

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);
  assert.equal(effects.status, "connected");
  assert.deepEqual(effects.countdowns, [5, 4, 3, null]);
  assert.equal(effects.requestAutoCloseCalls, 0);

  scheduler.advanceBy(1);
  assert.equal(effects.status, "idle");
  assert.deepEqual(effects.countdowns, [5, 4, 3, null, 5]);
  assert.equal(effects.stopAllTransportsCalls, 3);
  assert.equal(scheduler.pendingTimerCount, 1);
});

test("same-value eligible setters leave an active countdown unchanged", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  lifecycle.setDialogOpen(true);
  lifecycle.setVisibility(true);

  assert.equal(effects.status, "idle");
  assert.equal(effects.connectWebSocketCalls, 1);
  assert.deepEqual(effects.countdowns, [5]);
  assert.equal(scheduler.pendingTimerCount, 1);

  scheduler.advanceBy(5 * MARKDOWN_COUNTDOWN_TICK_MS);
  assert.deepEqual(effects.countdowns, [5, 4, 3, 2, 1, null]);
  assert.equal(effects.requestAutoCloseCalls, 1);
  assert.equal(effects.connectWebSocketCalls, 1);
  assert.equal(scheduler.pendingTimerCount, 0);
});

test("hidden time after four minutes fifty-nine seconds starts a fresh idle window", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - MARKDOWN_COUNTDOWN_TICK_MS);
  lifecycle.setVisibility(false);
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(scheduler.pendingTimerCount, 0);

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS * 2);
  assert.deepEqual(effects.countdowns, []);
  assert.equal(effects.requestAutoCloseCalls, 0);

  lifecycle.setVisibility(true);
  assert.equal(effects.connectWebSocketCalls, 2);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);
  assert.deepEqual(effects.countdowns, []);
  assert.equal(effects.status, "connected");

  scheduler.advanceBy(1);
  assert.deepEqual(effects.countdowns, [5]);
  assert.equal(effects.stopAllTransportsCalls, 3);
  assert.equal(scheduler.pendingTimerCount, 1);
});

test("hiding during warning clears countdown without stale close", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS + MARKDOWN_COUNTDOWN_TICK_MS);
  assert.deepEqual(effects.countdowns, [5, 4]);

  lifecycle.setVisibility(false);
  assert.deepEqual(effects.countdowns, [5, 4, null]);
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(scheduler.pendingTimerCount, 0);

  scheduler.advanceBy(10 * MARKDOWN_COUNTDOWN_TICK_MS);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.connectWebSocketCalls, 1);
});

test("epoch rejects retained countdown callback after visibility loss", () => {
  const { effects, lifecycle, scheduler } = createLifecycle(
    new FakeScheduler([MARKDOWN_COUNTDOWN_TICK_MS]),
  );
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  lifecycle.setVisibility(false);
  scheduler.runRetainedCallback();

  assert.deepEqual(effects.countdowns, [5, null]);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.connectWebSocketCalls, 1);
});

test("retained stale inactivity callback cannot orphan a rearmed timer", () => {
  const { effects, lifecycle, scheduler } = createLifecycle(
    new FakeScheduler([MARKDOWN_INACTIVITY_MS]),
  );
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(1);
  lifecycle.recordActivity();

  scheduler.runRetainedCallback();
  lifecycle.setVisibility(false);

  assert.equal(scheduler.pendingTimerCount, 0);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  assert.deepEqual(effects.countdowns, []);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.stopAllTransportsCalls, 2);
});

test("retained stale countdown callback cannot orphan a newer countdown", () => {
  const { effects, lifecycle, scheduler } = createLifecycle(
    new FakeScheduler([MARKDOWN_COUNTDOWN_TICK_MS]),
  );
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  lifecycle.recordActivity();
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  scheduler.runRetainedCallback();
  lifecycle.dispose();

  assert.equal(scheduler.pendingTimerCount, 0);
  scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);
  assert.deepEqual(effects.countdowns, [5, null, 5, null]);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.stopAllTransportsCalls, 4);
});

test("closing during warning clears countdown and never reconnects", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  lifecycle.setDialogOpen(false);
  lifecycle.recordActivity();
  assert.deepEqual(effects.countdowns, [5, null]);
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(effects.connectWebSocketCalls, 1);
  assert.equal(scheduler.pendingTimerCount, 0);

  scheduler.advanceBy(10 * MARKDOWN_COUNTDOWN_TICK_MS);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.connectWebSocketCalls, 1);
});

test("activity before zero cancels close while zero before activity stays latched", () => {
  const beforeZero = createLifecycle();
  wake(beforeZero.lifecycle);
  openCurrent(beforeZero.lifecycle, beforeZero.effects);
  beforeZero.scheduler.advanceBy(
    MARKDOWN_INACTIVITY_MS + 4 * MARKDOWN_COUNTDOWN_TICK_MS,
  );
  assert.equal(beforeZero.effects.countdowns.at(-1), 1);

  beforeZero.lifecycle.recordActivity();
  beforeZero.scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);
  assert.equal(beforeZero.effects.requestAutoCloseCalls, 0);
  assert.equal(beforeZero.effects.connectWebSocketCalls, 2);
  assert.equal(beforeZero.effects.countdowns.at(-1), null);

  const afterZero = createLifecycle();
  wake(afterZero.lifecycle);
  openCurrent(afterZero.lifecycle, afterZero.effects);
  afterZero.scheduler.advanceBy(
    MARKDOWN_INACTIVITY_MS + 5 * MARKDOWN_COUNTDOWN_TICK_MS,
  );
  assert.equal(afterZero.effects.requestAutoCloseCalls, 1);

  afterZero.lifecycle.recordActivity();
  assert.equal(afterZero.effects.connectWebSocketCalls, 1);
  assert.equal(afterZero.effects.stopAllTransportsCalls, 2);
  assert.equal(afterZero.scheduler.pendingTimerCount, 0);
});

for (const action of ["visibility", "dialog", "dispose"] as const) {
  test(`zero tick suppresses close after null effect reentrant ${action}`, () => {
    const { effects, lifecycle, scheduler } = createLifecycle();
    wake(lifecycle);
    openCurrent(lifecycle, effects);
    scheduler.advanceBy(
      MARKDOWN_INACTIVITY_MS + 4 * MARKDOWN_COUNTDOWN_TICK_MS,
    );
    effects.onSetAutoCloseCountdown = (seconds) => {
      if (seconds !== null) return;
      effects.onSetAutoCloseCountdown = undefined;
      if (action === "visibility") lifecycle.setVisibility(false);
      if (action === "dialog") lifecycle.setDialogOpen(false);
      if (action === "dispose") lifecycle.dispose();
    };

    scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);

    assert.deepEqual(effects.countdowns, [5, 4, 3, 2, 1, null]);
    assert.equal(lifecycle.isEligible(), false);
    assert.equal(effects.requestAutoCloseCalls, 0);
    assert.equal(effects.connectWebSocketCalls, 1);
    assert.equal(
      effects.stopAllTransportsCalls,
      action === "dispose" ? 3 : 2,
    );
    assert.equal(scheduler.pendingTimerCount, 0);

    lifecycle.recordActivity();
    assert.equal(effects.connectWebSocketCalls, 1);
  });
}

test("synchronous auto-close can reopen same lifecycle for a second close cycle", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  effects.onRequestAutoClose = () => lifecycle.setDialogOpen(false);
  wake(lifecycle);
  openCurrent(lifecycle, effects);

  scheduler.advanceBy(
    MARKDOWN_INACTIVITY_MS + 5 * MARKDOWN_COUNTDOWN_TICK_MS,
  );
  assert.equal(effects.requestAutoCloseCalls, 1);
  assert.equal(lifecycle.isEligible(), false);
  assert.equal(scheduler.pendingTimerCount, 0);

  lifecycle.setDialogOpen(true);
  assert.equal(effects.connectWebSocketCalls, 2);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(
    MARKDOWN_INACTIVITY_MS + 5 * MARKDOWN_COUNTDOWN_TICK_MS,
  );

  assert.equal(effects.requestAutoCloseCalls, 2);
  assert.equal(effects.connectWebSocketCalls, 2);
  assert.equal(effects.stopAllTransportsCalls, 3);
  assert.equal(lifecycle.isEligible(), false);
  assert.deepEqual(effects.countdowns, [
    5,
    4,
    3,
    2,
    1,
    null,
    5,
    4,
    3,
    2,
    1,
    null,
  ]);
  assert.equal(scheduler.pendingTimerCount, 0);
});

test("WebSocket attempt aborts at ten seconds", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);

  scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS - 1);
  assert.equal(effects.abortWebSocketAttemptCalls, 0);

  scheduler.advanceBy(1);
  assert.equal(effects.abortWebSocketAttemptCalls, 1);
  assert.equal(effects.status, "reconnecting");
});

test("early failure clears old deadline before later attempt", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  failCurrent(lifecycle, effects);

  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);
  assert.equal(effects.connectWebSocketCalls, 2);

  scheduler.advanceBy(
    WEBSOCKET_ATTEMPT_TIMEOUT_MS - WEBSOCKET_RETRY_DELAYS_MS[0],
  );
  assert.equal(effects.abortWebSocketAttemptCalls, 0);

  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);
  assert.equal(effects.abortWebSocketAttemptCalls, 1);
});

test("duplicate and stale failures cannot advance retries or clear newer deadlines", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  const firstAttemptId = effects.currentAttemptId;

  lifecycle.connectionFailed(firstAttemptId);
  lifecycle.connectionFailed(firstAttemptId);
  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);

  assert.equal(effects.connectWebSocketCalls, 2);
  const secondAttemptId = effects.currentAttemptId;
  lifecycle.socketOpened(firstAttemptId);
  assert.equal(effects.status, "reconnecting");
  lifecycle.connectionFailed(firstAttemptId);
  scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS);

  assert.deepEqual(effects.abortedAttemptIds, [secondAttemptId]);
  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[1] - 1);
  assert.equal(effects.connectWebSocketCalls, 2);
  scheduler.advanceBy(1);
  assert.equal(effects.connectWebSocketCalls, 3);
});

test("attempt deadlines alone exhaust retries and start fallback", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);

  for (const retryDelay of WEBSOCKET_RETRY_DELAYS_MS) {
    scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS);
    scheduler.advanceBy(retryDelay);
  }
  scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS);

  assert.equal(effects.connectWebSocketCalls, 4);
  assert.equal(effects.abortWebSocketAttemptCalls, 4);
  assert.equal(effects.startFallbackCalls, 1);
  assert.equal(effects.status, "fallback");
});

test("failed WebSocket retries after one, two, and four seconds before fallback", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);

  failCurrent(lifecycle, effects);
  assert.equal(effects.status, "reconnecting");
  assert.equal(effects.connectWebSocketCalls, 1);

  for (const [index, retryDelay] of WEBSOCKET_RETRY_DELAYS_MS.entries()) {
    scheduler.advanceBy(retryDelay - 1);
    assert.equal(effects.connectWebSocketCalls, index + 1);
    scheduler.advanceBy(1);
    assert.equal(effects.connectWebSocketCalls, index + 2);
    failCurrent(lifecycle, effects);
  }

  assert.equal(effects.startFallbackCalls, 1);
  assert.equal(effects.status, "fallback");
});

test("fallback retries WebSocket upgrade every sixty seconds without leaving fallback", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  reachFallback(lifecycle, scheduler, effects);

  scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  assert.equal(effects.connectWebSocketCalls, 5);
  assert.equal(effects.status, "fallback");

  failCurrent(lifecycle, effects);
  assert.equal(effects.status, "fallback");
  scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  assert.equal(effects.connectWebSocketCalls, 6);
  assert.equal(effects.status, "fallback");
});

test("hiding or closing cancels scheduled retry and fallback upgrade", () => {
  const retrying = createLifecycle();
  wake(retrying.lifecycle);
  failCurrent(retrying.lifecycle, retrying.effects);
  retrying.lifecycle.setVisibility(false);
  retrying.scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);

  assert.equal(retrying.effects.connectWebSocketCalls, 1);
  assert.equal(retrying.effects.status, "idle");
  assert.equal(retrying.scheduler.pendingTimerCount, 0);

  const fallback = createLifecycle();
  wake(fallback.lifecycle);
  reachFallback(fallback.lifecycle, fallback.scheduler, fallback.effects);
  fallback.lifecycle.setDialogOpen(false);
  fallback.scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);

  assert.equal(fallback.effects.connectWebSocketCalls, 4);
  assert.equal(fallback.effects.status, "idle");
  assert.equal(fallback.scheduler.pendingTimerCount, 0);
});

test("socket opened clears attempt deadline and publishes connected", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);

  assert.equal(effects.status, "connected");
  assert.equal(effects.stopFallbackCalls, 2);
  scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS);
  assert.equal(effects.abortWebSocketAttemptCalls, 0);
  assert.equal(effects.status, "connected");
});

test("cross-deployment sync waits for authoritative WebSocket initial sync", () => {
  const { effects, lifecycle } = createLifecycle();
  wake(lifecycle);

  assert.equal(effects.startCrossDeploySyncCalls, 0);
  openCurrent(lifecycle, effects);
  assert.equal(effects.startCrossDeploySyncCalls, 0);

  lifecycle.initialSyncReady();
  lifecycle.socketOpened(effects.currentAttemptId);
  lifecycle.initialSyncReady();
  assert.equal(effects.startCrossDeploySyncCalls, 1);
});

test("fallback readiness starts cross-deployment sync once", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  reachFallback(lifecycle, scheduler, effects);

  assert.equal(effects.startCrossDeploySyncCalls, 0);
  lifecycle.fallbackReady();
  lifecycle.fallbackReady();
  assert.equal(effects.startCrossDeploySyncCalls, 1);
});

test("successful fallback upgrade restores normal retry path", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  reachFallback(lifecycle, scheduler, effects);
  scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  openCurrent(lifecycle, effects);

  failCurrent(lifecycle, effects);

  assert.equal(effects.status, "reconnecting");
  assert.equal(effects.startFallbackCalls, 1);
  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);
  assert.equal(effects.connectWebSocketCalls, 6);
  assert.equal(effects.startFallbackCalls, 1);
});

test("manual reconnect wakes an eligible idle client and rearms inactivity", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  lifecycle.reconnectNow();

  assert.equal(effects.connectWebSocketCalls, 2);
  assert.equal(effects.status, "connecting");
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  assert.equal(effects.status, "idle");
});

test("manual reconnect during fallback starts an immediate upgrade attempt", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  reachFallback(lifecycle, scheduler, effects);

  lifecycle.reconnectNow();

  assert.equal(effects.connectWebSocketCalls, 5);
  assert.equal(effects.status, "fallback");
});

test("manual reconnect is a no-op while WebSocket is connected", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  const connectedAttemptId = effects.currentAttemptId;

  lifecycle.reconnectNow();

  assert.equal(effects.connectWebSocketCalls, 1);
  assert.equal(effects.abortWebSocketAttemptCalls, 0);
  assert.equal(effects.currentAttemptId, connectedAttemptId);
  assert.equal(effects.status, "connected");
  assert.equal(scheduler.pendingTimerCount, 1);
});

test("lifecycle instances hibernate and wake independently", () => {
  const first = createLifecycle();
  const second = createLifecycle();
  wake(first.lifecycle);
  wake(second.lifecycle);
  openCurrent(first.lifecycle, first.effects);
  openCurrent(second.lifecycle, second.effects);

  first.scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  assert.equal(first.effects.status, "idle");
  assert.equal(second.effects.status, "connected");

  first.lifecycle.recordActivity();
  assert.equal(first.effects.status, "connecting");
  assert.equal(second.effects.connectWebSocketCalls, 1);
});

test("disposed controller cannot warn or close while replacement reaches countdown", () => {
  const scheduler = new FakeScheduler([MARKDOWN_INACTIVITY_MS]);
  const oldEffects = new EffectRecorder();
  const oldLifecycle = new MarkdownConnectionLifecycle(oldEffects, scheduler);
  wake(oldLifecycle);
  openCurrent(oldLifecycle, oldEffects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);

  oldLifecycle.dispose();
  const replacementEffects = new EffectRecorder();
  const replacement = new MarkdownConnectionLifecycle(
    replacementEffects,
    scheduler,
  );
  wake(replacement);
  openCurrent(replacement, replacementEffects);
  scheduler.runRetainedCallback();
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  assert.deepEqual(oldEffects.countdowns, []);
  assert.equal(oldEffects.requestAutoCloseCalls, 0);
  assert.deepEqual(replacementEffects.countdowns, [5]);
  assert.equal(replacementEffects.requestAutoCloseCalls, 0);
});

test("dispose during warning clears countdown and prevents later close", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  openCurrent(lifecycle, effects);
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);

  lifecycle.dispose();
  assert.deepEqual(effects.countdowns, [5, null]);
  assert.equal(effects.stopAllTransportsCalls, 3);
  assert.equal(scheduler.pendingTimerCount, 0);

  scheduler.advanceBy(10 * MARKDOWN_COUNTDOWN_TICK_MS);
  lifecycle.recordActivity();
  lifecycle.setDialogOpen(false);
  lifecycle.setVisibility(false);
  assert.equal(effects.requestAutoCloseCalls, 0);
  assert.equal(effects.connectWebSocketCalls, 1);
});

test("dispose stops transports, cancels timers, and publishes no later status", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  failCurrent(lifecycle, effects);
  const statusesBeforeDispose = effects.statuses.length;

  lifecycle.dispose();
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(effects.statuses.length, statusesBeforeDispose);
  assert.equal(scheduler.pendingTimerCount, 0);

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS + WEBSOCKET_UPGRADE_INTERVAL_MS);
  lifecycle.setDialogOpen(false);
  lifecycle.setVisibility(false);
  lifecycle.recordActivity();
  openCurrent(lifecycle, effects);
  lifecycle.initialSyncReady();
  lifecycle.fallbackReady();
  failCurrent(lifecycle, effects);
  lifecycle.reconnectNow();

  assert.equal(effects.connectWebSocketCalls, 1);
  assert.equal(effects.startCrossDeploySyncCalls, 0);
  assert.equal(effects.statuses.length, statusesBeforeDispose);
});
