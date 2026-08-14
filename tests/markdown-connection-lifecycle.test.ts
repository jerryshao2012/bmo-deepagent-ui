import assert from "node:assert/strict";
import test from "node:test";

import {
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
    { callback: () => void; deadline: number }
  >();

  setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, { callback, deadline: this.now + delayMs });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
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
  startFallbackCalls = 0;
  stopFallbackCalls = 0;
  startCrossDeploySyncCalls = 0;
  stopAllTransportsCalls = 0;
  readonly statuses: MarkdownConnectionStatus[] = [];

  connectWebSocket(): void {
    this.connectWebSocketCalls += 1;
  }

  abortWebSocketAttempt(): void {
    this.abortWebSocketAttemptCalls += 1;
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
  }

  setStatus(status: MarkdownConnectionStatus): void {
    this.statuses.push(status);
  }

  get status(): MarkdownConnectionStatus | undefined {
    return this.statuses.at(-1);
  }
}

function createLifecycle() {
  const scheduler = new FakeScheduler();
  const effects = new EffectRecorder();
  const lifecycle = new MarkdownConnectionLifecycle(effects, scheduler);

  return { effects, lifecycle, scheduler };
}

function wake(lifecycle: MarkdownConnectionLifecycle): void {
  lifecycle.setVisibility(true);
  lifecycle.setDialogOpen(true);
}

function reachFallback(
  lifecycle: MarkdownConnectionLifecycle,
  scheduler: FakeScheduler,
): void {
  lifecycle.connectionFailed();
  for (const retryDelay of WEBSOCKET_RETRY_DELAYS_MS) {
    scheduler.advanceBy(retryDelay);
    lifecycle.connectionFailed();
  }
}

test("exports exact markdown connection timing values", () => {
  assert.equal(MARKDOWN_INACTIVITY_MS, 300_000);
  assert.equal(WEBSOCKET_ATTEMPT_TIMEOUT_MS, 10_000);
  assert.deepEqual(WEBSOCKET_RETRY_DELAYS_MS, [1_000, 2_000, 4_000]);
  assert.equal(WEBSOCKET_UPGRADE_INTERVAL_MS, 60_000);
});

test("initial ineligible reconciliation publishes idle and stops transports once", () => {
  const { effects, lifecycle } = createLifecycle();

  lifecycle.setDialogOpen(false);
  lifecycle.setVisibility(false);

  assert.equal(effects.status, "idle");
  assert.equal(effects.stopAllTransportsCalls, 1);
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

test("connected visible dialog hibernates exactly after five minutes", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  lifecycle.socketOpened();

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);
  assert.equal(effects.status, "connected");
  assert.equal(effects.stopAllTransportsCalls, 1);

  scheduler.advanceBy(1);
  assert.equal(effects.status, "idle");
  assert.equal(effects.stopAllTransportsCalls, 2);
});

test("activity resets inactivity timer and wakes eligible idle client", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  lifecycle.socketOpened();

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);
  lifecycle.recordActivity();
  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);
  assert.equal(effects.status, "connected");

  scheduler.advanceBy(1);
  assert.equal(effects.status, "idle");
  lifecycle.recordActivity();
  assert.equal(effects.connectWebSocketCalls, 2);
  assert.equal(effects.status, "connecting");
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
  lifecycle.connectionFailed();

  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);
  assert.equal(effects.connectWebSocketCalls, 2);

  scheduler.advanceBy(
    WEBSOCKET_ATTEMPT_TIMEOUT_MS - WEBSOCKET_RETRY_DELAYS_MS[0],
  );
  assert.equal(effects.abortWebSocketAttemptCalls, 0);

  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);
  assert.equal(effects.abortWebSocketAttemptCalls, 1);
});

test("failed WebSocket retries after one, two, and four seconds before fallback", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);

  lifecycle.connectionFailed();
  assert.equal(effects.status, "reconnecting");
  assert.equal(effects.connectWebSocketCalls, 1);

  for (const [index, retryDelay] of WEBSOCKET_RETRY_DELAYS_MS.entries()) {
    scheduler.advanceBy(retryDelay - 1);
    assert.equal(effects.connectWebSocketCalls, index + 1);
    scheduler.advanceBy(1);
    assert.equal(effects.connectWebSocketCalls, index + 2);
    lifecycle.connectionFailed();
  }

  assert.equal(effects.startFallbackCalls, 1);
  assert.equal(effects.status, "fallback");
});

test("fallback retries WebSocket upgrade every sixty seconds without leaving fallback", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  reachFallback(lifecycle, scheduler);

  scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  assert.equal(effects.connectWebSocketCalls, 5);
  assert.equal(effects.status, "fallback");

  lifecycle.connectionFailed();
  assert.equal(effects.status, "fallback");
  scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  assert.equal(effects.connectWebSocketCalls, 6);
  assert.equal(effects.status, "fallback");
});

test("hiding or closing cancels scheduled retry and fallback upgrade", () => {
  const retrying = createLifecycle();
  wake(retrying.lifecycle);
  retrying.lifecycle.connectionFailed();
  retrying.lifecycle.setVisibility(false);
  retrying.scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);

  assert.equal(retrying.effects.connectWebSocketCalls, 1);
  assert.equal(retrying.effects.status, "idle");

  const fallback = createLifecycle();
  wake(fallback.lifecycle);
  reachFallback(fallback.lifecycle, fallback.scheduler);
  fallback.lifecycle.setDialogOpen(false);
  fallback.scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);

  assert.equal(fallback.effects.connectWebSocketCalls, 4);
  assert.equal(fallback.effects.status, "idle");
});

test("socket opened clears attempt deadline and publishes connected", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  lifecycle.socketOpened();

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
  lifecycle.socketOpened();
  assert.equal(effects.startCrossDeploySyncCalls, 0);

  lifecycle.initialSyncReady();
  lifecycle.initialSyncReady();
  assert.equal(effects.startCrossDeploySyncCalls, 1);
});

test("fallback readiness starts cross-deployment sync once", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  reachFallback(lifecycle, scheduler);

  assert.equal(effects.startCrossDeploySyncCalls, 0);
  lifecycle.fallbackReady();
  lifecycle.fallbackReady();
  assert.equal(effects.startCrossDeploySyncCalls, 1);
});

test("successful fallback upgrade restores normal retry path", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  reachFallback(lifecycle, scheduler);
  scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  lifecycle.socketOpened();

  lifecycle.connectionFailed();

  assert.equal(effects.status, "reconnecting");
  assert.equal(effects.startFallbackCalls, 1);
  scheduler.advanceBy(WEBSOCKET_RETRY_DELAYS_MS[0]);
  assert.equal(effects.connectWebSocketCalls, 6);
  assert.equal(effects.startFallbackCalls, 1);
});

test("manual reconnect wakes an eligible idle client and rearms inactivity", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  lifecycle.socketOpened();
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
  reachFallback(lifecycle, scheduler);

  lifecycle.reconnectNow();

  assert.equal(effects.connectWebSocketCalls, 5);
  assert.equal(effects.status, "fallback");
});

test("lifecycle instances hibernate and wake independently", () => {
  const first = createLifecycle();
  const second = createLifecycle();
  wake(first.lifecycle);
  wake(second.lifecycle);
  first.lifecycle.socketOpened();
  second.lifecycle.socketOpened();

  first.scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  assert.equal(first.effects.status, "idle");
  assert.equal(second.effects.status, "connected");

  first.lifecycle.recordActivity();
  assert.equal(first.effects.status, "connecting");
  assert.equal(second.effects.connectWebSocketCalls, 1);
});

test("dispose stops transports, cancels timers, and publishes no later status", () => {
  const { effects, lifecycle, scheduler } = createLifecycle();
  wake(lifecycle);
  lifecycle.connectionFailed();
  const statusesBeforeDispose = effects.statuses.length;

  lifecycle.dispose();
  assert.equal(effects.stopAllTransportsCalls, 2);
  assert.equal(effects.statuses.length, statusesBeforeDispose);

  scheduler.advanceBy(MARKDOWN_INACTIVITY_MS + WEBSOCKET_UPGRADE_INTERVAL_MS);
  lifecycle.setDialogOpen(false);
  lifecycle.setVisibility(false);
  lifecycle.recordActivity();
  lifecycle.socketOpened();
  lifecycle.initialSyncReady();
  lifecycle.fallbackReady();
  lifecycle.connectionFailed();
  lifecycle.reconnectNow();

  assert.equal(effects.connectWebSocketCalls, 1);
  assert.equal(effects.startCrossDeploySyncCalls, 0);
  assert.equal(effects.statuses.length, statusesBeforeDispose);
});
