# Markdown Preview Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hibernate unused intro-page markdown transports, wake each browser into WebSocket-first synchronization, recover transient failures automatically, and keep active WebSockets healthy with protocol ping/pong.

**Architecture:** Add a small framework-independent lifecycle controller under markdown-sync application code. Controller owns eligibility, inactivity, connection deadlines, retry timing, fallback upgrades, and intentional shutdown; intro page continues owning transport I/O and content conflict guards. Add a separately testable CommonJS heartbeat helper to custom server.

**Tech Stack:** TypeScript, React 19, Next.js 16, browser WebSocket/EventSource APIs, Node `ws`, Node test runner, `tsx`.

---

## File map

- Create `../../../src/features/markdown-sync/application/connection-lifecycle.ts`: lifecycle states, timing constants, injected scheduler, and transport-effect controller.
- Create `../../../tests/markdown-connection-lifecycle.test.ts`: deterministic controller tests with fake scheduler and two-browser simulation.
- Create `../../../runtime/websocket-heartbeat.cjs`: protocol ping/pong installation and cleanup for `ws` server.
- Create `../../../tests/markdown-websocket-heartbeat.test.mjs`: responsive/unresponsive client and cleanup tests.
- Modify `../../../server.cjs`: install heartbeat and clear it during graceful shutdown.
- Modify `../../../tests/markdown-sync-architecture.test.mjs`: declare heartbeat as custom-runtime boundary.
- Modify `../../../src/app/intro/page.tsx`: wire controller to WebSocket, fallback, polling, dialog, visibility, activity, queued edits, and status badge.
- Modify `../../../tests/markdown-preview-sync.test.mjs`: source-level integration contracts for intentional sleep, WebSocket-first wake, and pending-edit handling.

### Task 1: Client connection lifecycle controller

**Files:**
- Create: `../../../tests/markdown-connection-lifecycle.test.ts`
- Create: `../../../src/features/markdown-sync/application/connection-lifecycle.ts`

- [ ] **Step 1: Write failing timing and eligibility tests**

Create test-local fake scheduler implementing `setTimeout`, `clearTimeout`, and `advanceBy`. Test exact exported constants and these transitions:

```ts
test("closed dialog and hidden tab remain idle", () => {
  const harness = createHarness();
  harness.lifecycle.setDialogOpen(true);
  assert.equal(harness.connectCalls, 1);

  harness.lifecycle.setVisibility(false);
  assert.equal(harness.status, "idle");
  assert.equal(harness.stopAllCalls, 1);

  harness.lifecycle.setDialogOpen(false);
  harness.lifecycle.setVisibility(true);
  assert.equal(harness.connectCalls, 1);
});

test("visible open dialog hibernates after five minutes", () => {
  const harness = createHarness();
  harness.lifecycle.setDialogOpen(true);
  harness.lifecycle.socketOpened();
  harness.scheduler.advanceBy(MARKDOWN_INACTIVITY_MS - 1);
  assert.equal(harness.status, "connected");
  harness.scheduler.advanceBy(1);
  assert.equal(harness.status, "idle");
});

test("meaningful activity resets inactivity and wakes idle client", () => {
  const harness = createHarness();
  harness.lifecycle.setDialogOpen(true);
  harness.lifecycle.socketOpened();
  harness.scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
  harness.lifecycle.recordActivity();
  assert.equal(harness.connectCalls, 2);
  assert.equal(harness.status, "connecting");
});
```

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
node --import tsx --test --test-isolation=none tests/markdown-connection-lifecycle.test.ts
```

Expected: FAIL because `connection-lifecycle.ts` does not exist.

- [ ] **Step 3: Add lifecycle types, constants, scheduler, and eligibility logic**

Implement these exact public boundaries:

```ts
export type MarkdownConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "fallback"
  | "disconnected";

export const MARKDOWN_INACTIVITY_MS = 5 * 60 * 1000;
export const WEBSOCKET_ATTEMPT_TIMEOUT_MS = 10_000;
export const WEBSOCKET_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const WEBSOCKET_UPGRADE_INTERVAL_MS = 60_000;

export interface ConnectionScheduler {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

export interface MarkdownConnectionEffects {
  connectWebSocket(): void;
  abortWebSocketAttempt(): void;
  startFallback(): void;
  stopFallback(): void;
  startCrossDeploySync(): void;
  stopAllTransports(): void;
  setStatus(status: MarkdownConnectionStatus): void;
}
```

Add `MarkdownConnectionLifecycle` with these methods:

```ts
export class MarkdownConnectionLifecycle {
  setDialogOpen(open: boolean): void;
  setVisibility(visible: boolean): void;
  recordActivity(): void;
  socketOpened(): void;
  initialSyncReady(): void;
  fallbackReady(): void;
  connectionFailed(): void;
  reconnectNow(): void;
  isEligible(): boolean;
  dispose(): void;
}
```

Controller rules:

```ts
private reconcileEligibility() {
  if (!this.isEligible()) {
    this.hibernate();
    return;
  }
  if (this.status === "idle" || this.status === "disconnected") {
    this.wake();
  }
}

private wake() {
  this.clearAllTimers();
  this.retryIndex = 0;
  this.fallbackActive = false;
  this.effects.stopFallback();
  this.armInactivity();
  this.beginWebSocketAttempt(false);
}

private hibernate() {
  this.clearAllTimers();
  this.retryIndex = 0;
  this.fallbackActive = false;
  this.effects.stopAllTransports();
  this.setStatus("idle");
}
```

`dispose()` clears timers and calls `stopAllTransports()` without publishing new React state after unmount.

- [ ] **Step 4: Run lifecycle tests and verify eligibility tests pass**

Run same command. Expected: PASS for eligibility/inactivity tests.

- [ ] **Step 5: Add failing bounded-retry, timeout, fallback-upgrade, and independence tests**

Cover initial attempt timeout, retries after `1_000`, `2_000`, and `4_000`, fallback after final failed retry, upgrade after `60_000`, cancellation on hide, and two independent controller instances:

```ts
test("connection deadline drives bounded retry then fallback", () => {
  const harness = createHarness();
  harness.lifecycle.setDialogOpen(true);

  for (const retryDelay of WEBSOCKET_RETRY_DELAYS_MS) {
    harness.scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS);
    assert.equal(harness.abortCalls > 0, true);
    harness.scheduler.advanceBy(retryDelay);
  }

  harness.scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS);
  assert.equal(harness.status, "fallback");
  assert.equal(harness.fallbackCalls, 1);
});

test("early failure clears old connection deadline", () => {
  const harness = createHarness();
  harness.lifecycle.setDialogOpen(true);
  harness.lifecycle.connectionFailed();
  harness.scheduler.advanceBy(WEBSOCKET_ATTEMPT_TIMEOUT_MS);
  assert.equal(harness.abortCalls, 0);
});

test("cross-deployment sync waits for authoritative transport init", () => {
  const harness = createHarness();
  harness.lifecycle.setDialogOpen(true);
  assert.equal(harness.crossDeployCalls, 0);
  harness.lifecycle.socketOpened();
  assert.equal(harness.status, "connected");
  assert.equal(harness.crossDeployCalls, 0);
  harness.lifecycle.initialSyncReady();
  assert.equal(harness.crossDeployCalls, 1);
});

test("fallback retries WebSocket upgrade every minute", () => {
  const harness = createHarnessInFallback();
  const attempts = harness.connectCalls;
  harness.scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  assert.equal(harness.connectCalls, attempts + 1);
  assert.equal(harness.status, "fallback");
});

test("successful fallback upgrade restores normal retry path", () => {
  const harness = createHarnessInFallback();
  harness.scheduler.advanceBy(WEBSOCKET_UPGRADE_INTERVAL_MS);
  harness.lifecycle.socketOpened();
  assert.equal(harness.status, "connected");

  harness.lifecycle.connectionFailed();
  assert.equal(harness.status, "reconnecting");
  assert.equal(harness.fallbackCalls, 1);
});

test("two browsers sleep and wake independently", () => {
  const first = createHarness();
  const second = createHarness();
  first.lifecycle.setDialogOpen(true);
  second.lifecycle.setDialogOpen(true);
  second.lifecycle.setVisibility(false);
  assert.equal(first.lifecycle.isEligible(), true);
  assert.equal(second.status, "idle");
  second.lifecycle.setVisibility(true);
  assert.equal(second.connectCalls, 2);
});
```

- [ ] **Step 6: Implement connection attempts and recovery**

`beginWebSocketAttempt(isUpgrade)` must call `connectWebSocket()`, arm a 10-second attempt timer, and preserve blue fallback status during upgrade. Timer callback calls `abortWebSocketAttempt()` then `connectionFailed()`.

`connectionFailed()` must:

```ts
this.clearAttemptTimer();
if (!this.isEligible()) {
  this.hibernate();
  return;
}
if (this.upgradeAttempt || this.fallbackActive) {
  this.setStatus("fallback");
  this.armUpgrade();
  return;
}
const delay = WEBSOCKET_RETRY_DELAYS_MS[this.retryIndex];
if (delay !== undefined) {
  this.retryIndex += 1;
  this.setStatus("reconnecting");
  this.retryTimer = this.scheduler.setTimeout(
    () => this.beginWebSocketAttempt(false),
    delay
  );
  return;
}
this.fallbackActive = true;
this.effects.startFallback();
this.setStatus("fallback");
this.armUpgrade();
```

`socketOpened()` immediately clears attempt/retry/upgrade timers, resets retry
index, explicitly sets both `fallbackActive` and `upgradeAttempt` false, stops
fallback, and sets green `connected`. `initialSyncReady()` starts cross-deployment
sync only after WebSocket authoritative initial sync has been processed.
`fallbackReady()` starts cross-deployment sync only after fallback initial sync has
been processed. `recordActivity()` wakes only when eligible and idle; otherwise it
only rearms inactivity. `reconnectNow()` performs immediate upgrade/retry only
while eligible. Every failure path calls `clearAttemptTimer()` before scheduling
anything else, so a stale connection deadline cannot abort a later socket.

- [ ] **Step 7: Run lifecycle tests**

Expected: all lifecycle tests PASS.

- [ ] **Step 8: Commit controller**

```bash
git add src/features/markdown-sync/application/connection-lifecycle.ts tests/markdown-connection-lifecycle.test.ts
git commit -m "feat: add markdown connection lifecycle controller"
```

### Task 2: Server WebSocket heartbeat

**Files:**
- Create: `../../../runtime/websocket-heartbeat.cjs`
- Create: `../../../tests/markdown-websocket-heartbeat.test.mjs`
- Modify: `server.cjs:1-10,254-258,301-319`
- Modify: `tests/markdown-sync-architecture.test.mjs:21-33`

- [ ] **Step 1: Write failing heartbeat tests**

Use `EventEmitter` fakes for server and clients. Verify connection initializes `isAlive`, pong restores it, first tick sends ping, next missed tick terminates, responsive client survives, and cleanup clears interval/listener.

```js
test("heartbeat terminates only clients that miss pong", () => {
  const scheduler = createIntervalHarness();
  const wss = createFakeServer();
  const stop = installWebSocketHeartbeat(wss, scheduler);
  const responsive = createFakeClient();
  const stale = createFakeClient();
  wss.connect(responsive);
  wss.connect(stale);

  scheduler.tick();
  responsive.emit("pong");
  scheduler.tick();

  assert.equal(responsive.terminateCalls, 0);
  assert.equal(stale.terminateCalls, 1);
  stop();
  assert.equal(scheduler.clearCalls, 1);
});
```

- [ ] **Step 2: Run test and verify expected failure**

```bash
node --test tests/markdown-websocket-heartbeat.test.mjs
```

Expected: FAIL because heartbeat module does not exist.

- [ ] **Step 3: Implement isolated heartbeat helper**

Create CommonJS module with dependency injection:

```js
const WEBSOCKET_HEARTBEAT_MS = 25_000;

function installWebSocketHeartbeat(
  wss,
  {
    intervalMs = WEBSOCKET_HEARTBEAT_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = {}
) {
  const markAlive = function () {
    this.isAlive = true;
  };
  const initializeClient = (ws) => {
    ws.isAlive = true;
    ws.on("pong", markAlive);
  };

  wss.on("connection", initializeClient);
  const interval = setIntervalFn(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, intervalMs);

  return () => {
    clearIntervalFn(interval);
    wss.off("connection", initializeClient);
    for (const ws of wss.clients) ws.off("pong", markAlive);
  };
}

module.exports = { WEBSOCKET_HEARTBEAT_MS, installWebSocketHeartbeat };
```

- [ ] **Step 4: Run heartbeat tests**

Expected: PASS.

- [ ] **Step 5: Add failing server integration/architecture assertions**

Extend source tests to require `../../../runtime/websocket-heartbeat.cjs`, `installWebSocketHeartbeat(wss)`, and `stopWebSocketHeartbeat()` in shutdown.

- [ ] **Step 6: Install and clean up heartbeat in custom server**

Import helper near other runtime imports. Immediately after `wss` creation:

```js
const stopWebSocketHeartbeat = installWebSocketHeartbeat(wss);
```

Call `stopWebSocketHeartbeat()` during shutdown before closing clients/WSS. No heartbeat content or thread IDs enter logs.

- [ ] **Step 7: Run heartbeat, architecture, and server-state tests**

```bash
node --test tests/markdown-websocket-heartbeat.test.mjs tests/markdown-sync-architecture.test.mjs tests/markdown-server-state.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit heartbeat**

```bash
git add runtime/websocket-heartbeat.cjs server.cjs tests/markdown-websocket-heartbeat.test.mjs tests/markdown-sync-architecture.test.mjs
git commit -m "feat: keep active markdown websockets healthy"
```

### Task 3: Intro-page transport lifecycle integration

**Files:**
- Modify: `src/app/intro/page.tsx:1-578`
- Modify: `../../../tests/markdown-preview-sync.test.mjs`

- [ ] **Step 1: Add failing source integration contracts**

Assert intro page imports and instantiates `MarkdownConnectionLifecycle`, listens
to `visibilitychange`/`pagehide`/`pageshow`, contains explicit stop helpers, does
not retain sticky `hasFallenBackRef`, and delegates failure to controller.

```js
assert.match(introPage, /new MarkdownConnectionLifecycle\(\{/);
assert.match(introPage, /document\.addEventListener\("visibilitychange"/);
assert.match(introPage, /window\.addEventListener\("pagehide"/);
assert.match(introPage, /window\.addEventListener\("pageshow"/);
assert.match(introPage, /lifecycleRef\.current\?\.connectionFailed\(\)/);
assert.match(introPage, /lifecycleRef\.current\?\.socketOpened\(\)/);
assert.match(introPage, /lifecycleRef\.current\?\.initialSyncReady\(\)/);
assert.match(introPage, /code:\s*1000[\s\S]*reason:\s*"hibernate"/);
assert.match(introPage, /code:\s*4000[\s\S]*reason:\s*"attempt timeout"/);
assert.match(introPage, /intentional:\s*true/);
assert.doesNotMatch(introPage, /hasFallenBackRef/);
```

- [ ] **Step 2: Run preview sync tests and verify failure**

```bash
node --test tests/markdown-preview-sync.test.mjs
```

Expected: FAIL on lifecycle contracts.

- [ ] **Step 3: Replace status type and sticky fallback refs**

Import controller and status type. Change `wsStatus` to `MarkdownConnectionStatus`. Remove `reconnectTimeoutRef` and `hasFallenBackRef`. Add:

```ts
const lifecycleRef = useRef<MarkdownConnectionLifecycle | null>(null);
const failedSocketRef = useRef<WebSocket | null>(null);
```

Keep existing content-version and pending-content refs.

- [ ] **Step 4: Add idempotent transport stop helpers**

Create `closeWebSocket(code, reason)`, `abortWebSocketAttempt`, `stopFallback`,
`stopCrossDeployPolling`, and `stopAllTransports`. Every helper clears its ref
before closing. `closeWebSocket` logs safe context `{ threadId, code, reason,
status, intentional: true }`, then detaches `onopen`, `onmessage`, `onerror`, and
`onclose` before close so intentional shutdown cannot report failure.
`abortWebSocketAttempt` uses custom code `4000` and reason `attempt timeout`;
hibernation uses normal code `1000` and reason `hibernate`. Fallback helper closes
EventSource, clears fallback polling, and resets initialization.
`stopAllTransports` closes WebSocket with hibernation reason and composes remaining
stops. Logs never include markdown content, tokens, or credentials.

- [ ] **Step 5: Make cross-deployment polling start with immediate read**

Extract interval body into `pollBackendOnce`. `startCrossDeployPolling` clears old interval, resets last sync, invokes `void pollBackendOnce()`, then schedules same function every four seconds. Stop helper clears interval. Preserve existing version/pending guards.

- [ ] **Step 6: Make fallback start/stop status-neutral**

Remove direct sticky flag and status writes from `startFallbackSSE`. Controller owns status. Keep EventSource auto-reconnection and three-second read-only polling. On fatal EventSource close, clear ref and call `lifecycleRef.current?.connectionFailed()` only if controller remains eligible.

- [ ] **Step 7: Refactor WebSocket callbacks around controller**

`connectWS` creates one socket but does not close active fallback before opening.
On open, clear `failedSocketRef`, set socket state, and immediately call
`lifecycleRef.current?.socketOpened()` so 10-second connection deadline is cleared,
fallback stops, and badge turns green. Then load cached content and send `init`.
On first valid initial `sync`, resolve content/pending edit, then call
`lifecycleRef.current?.initialSyncReady()` so immediate cross-deployment read starts
only after authoritative initialization barrier.

On close, log `{ code, reason, intentional: false, status: wsStatus }` without content or credentials. Ignore stale sockets (`wsRef.current !== ws`) and duplicate failures (`failedSocketRef.current === ws`). Clear current socket and call `connectionFailed()`.

On error, detach handlers, close socket, clear current refs, and call `connectionFailed()` once. Controller effect `abortWebSocketAttempt` performs same detach/close without calling failure because controller timeout callback already advances state.

- [ ] **Step 8: Instantiate controller and wire visibility**

Replace unconditional connection effect with one controller instance per `threadId`:

```ts
useEffect(() => {
  if (!threadId) return;
  const lifecycle = new MarkdownConnectionLifecycle({
    connectWebSocket: connectWS,
    abortWebSocketAttempt,
    startFallback: startFallbackSSE,
    stopFallback,
    startCrossDeploySync: startCrossDeployPolling,
    stopAllTransports,
    setStatus: setWsStatus,
  });
  lifecycleRef.current = lifecycle;
  lifecycle.setVisibility(document.visibilityState === "visible");
  lifecycle.setDialogOpen(isDialogOpen);

  const handleVisibility = () =>
    lifecycle.setVisibility(document.visibilityState === "visible");
  const handlePageHide = () => lifecycle.setVisibility(false);
  const handlePageShow = () =>
    lifecycle.setVisibility(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    lifecycle.dispose();
    if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
  };
}, [threadId, connectWS, startFallbackSSE, startCrossDeployPolling, stopAllTransports]);
```

Use a separate effect to call `lifecycleRef.current?.setDialogOpen(isDialogOpen)` so dialog toggles do not recreate controller.

- [ ] **Step 9: Run lifecycle and preview integration tests**

```bash
node --import tsx --test --test-isolation=none tests/markdown-connection-lifecycle.test.ts tests/markdown-preview-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit transport integration**

```bash
git add src/app/intro/page.tsx tests/markdown-preview-sync.test.mjs
git commit -m "feat: hibernate inactive markdown transports"
```

### Task 4: Preserve pending edits and cross-machine wake convergence

**Files:**
- Modify: `src/app/intro/page.tsx:150-606`
- Modify: `../../../tests/markdown-preview-sync.test.mjs`

- [ ] **Step 1: Add failing pending-edit and WebSocket-first wake contracts**

Add source assertions requiring non-fallback edits to set `pendingWebSocketContentRef`, initial sync to flush pending content, and fallback start to flush pending content. Retain existing stale-response guards.

```js
assert.match(
  introPage,
  /data\.initial[\s\S]*pendingWebSocketContentRef\.current[\s\S]*type:\s*"update"/
);
assert.match(
  introPage,
  /wsStatusRef\.current === "fallback"[\s\S]*sendFallbackUpdate/
);
```

- [ ] **Step 2: Run preview sync test and verify failure**

Expected: FAIL on new queued-edit assertions.

- [ ] **Step 3: Track current status without stale callback closures**

Add `wsStatusRef`; update it whenever controller calls `setStatus`:

```ts
const updateWsStatus = useCallback((status: MarkdownConnectionStatus) => {
  wsStatusRef.current = status;
  setWsStatus(status);
}, []);
```

Use ref for logs and publish routing.

- [ ] **Step 4: Queue edits during wake instead of starting fallback POST**

Update `publishContent`:

```ts
const activeSocket = wsRef.current;
if (activeSocket?.readyState === WebSocket.OPEN) {
  pendingWebSocketContentRef.current = value;
  activeSocket.send(JSON.stringify({ type: "update", content: value, immediate }));
} else if (wsStatusRef.current === "fallback") {
  void sendFallbackUpdate(value, immediate);
} else {
  pendingWebSocketContentRef.current = value;
}
void syncContentToBackend(value);
```

Calling backend mirror remains allowed after user activity wakes client; idle clients perform no periodic network work.

- [ ] **Step 5: Flush queued edit after authoritative WebSocket init**

In WebSocket message handler, when initial `sync` differs from pending local content, do not apply stale initial content. Send pending value as `update` on same open socket and retain pending ref until matching sync acknowledgement arrives. When incoming content equals pending value, clear pending ref and apply it.

- [ ] **Step 6: Flush queued edit if retries reach fallback**

After fallback EventSource receives initial authoritative sync, if pending
WebSocket content exists, copy it into fallback pending update and call
`sendFallbackUpdate`. Do not apply differing initial content over pending local
edit. Clear WebSocket pending ref only after fallback update is accepted or
matching sync arrives. After resolving initial sync, call
`lifecycleRef.current?.fallbackReady()` so immediate cross-deployment read cannot
race ahead of authoritative fallback initialization.

- [ ] **Step 7: Add two-client convergence regression contract**

Extend existing cross-machine test to assert wake uses server `init` and immediate backend read, and no remote signal directly wakes hidden browser. Controller unit test already proves independent eligibility; integration test proves content guards remain intact.

- [ ] **Step 8: Run markdown sync tests**

```bash
node --import tsx --test --test-isolation=none tests/markdown-connection-lifecycle.test.ts tests/markdown-sync-state.test.ts tests/markdown-preview-sync.test.mjs tests/markdown-server-state.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit convergence handling**

```bash
git add src/app/intro/page.tsx tests/markdown-preview-sync.test.mjs
git commit -m "fix: preserve markdown edits across transport wake"
```

### Task 5: Activity capture and lifecycle status UI

**Files:**
- Modify: `src/app/intro/page.tsx:2008-2140`
- Modify: `../../../tests/markdown-preview-sync.test.mjs`

- [ ] **Step 1: Write failing status/activity contracts**

Assert dialog panel captures `onPointerDownCapture`, `onKeyDownCapture`, `onScrollCapture`, `onWheelCapture`, and `onTouchStartCapture`, contains no mouse-move wake, and renders idle/reconnecting styles.

- [ ] **Step 2: Run preview sync test and verify failure**

Expected: FAIL on activity/UI assertions.

- [ ] **Step 3: Add one stable activity callback**

```ts
const noteMarkdownActivity = useCallback(() => {
  lifecycleRef.current?.recordActivity();
}, []);
```

Attach callback to capture handlers on inner dialog panel, not full-page backdrop. Call it explicitly at start of text change, paste, drop, and destructive remove handlers so first mutation after inactivity is queued during wake.

- [ ] **Step 4: Render idle and reconnecting states**

Add gray badge/dot/title for `idle`, amber treatment for both `connecting` and `reconnecting`, existing green for connected, blue for fallback, and rose for disconnected. Replace sticky fallback click logic with `lifecycleRef.current?.reconnectNow()` only for active fallback/disconnected state. Clicking idle dialog badge counts as normal dialog activity and wakes through capture handler.

- [ ] **Step 5: Run preview and controller tests**

```bash
node --import tsx --test --test-isolation=none tests/markdown-connection-lifecycle.test.ts tests/markdown-preview-sync.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit UI lifecycle states**

```bash
git add src/app/intro/page.tsx tests/markdown-preview-sync.test.mjs
git commit -m "feat: show markdown transport hibernation state"
```

### Task 6: Full verification and handoff

**Files:**
- Modify only if verification exposes an in-scope defect.

- [ ] **Step 1: Run focused markdown and heartbeat suite**

```bash
node --import tsx --test --test-isolation=none tests/markdown-connection-lifecycle.test.ts tests/markdown-websocket-heartbeat.test.mjs tests/markdown-preview-sync.test.mjs tests/markdown-sync-state.test.ts tests/markdown-server-state.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run architecture checks**

```bash
yarn test:architecture
```

Expected: PASS.

- [ ] **Step 3: Run lint**

```bash
yarn lint
```

Expected: exit 0 with no ESLint errors.

- [ ] **Step 4: Run production build**

```bash
yarn build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 5: Inspect Threadroot score when available**

```bash
threadroot score latest --json
```

Expected: score output available for recorded run; do not tune without evidence.

- [ ] **Step 6: Perform manual two-machine verification**

Use same six-digit markdown ID on two machines:

1. Open both dialogs; verify both green.
2. Hide/close second; verify gray idle and first stays green.
3. Edit first.
4. Return second; verify WebSocket-first green wake and latest content.
5. Leave visible dialog untouched five minutes; verify idle, interact, verify green.
6. Block WebSocket temporarily; verify amber retries, blue fallback, then automatic green upgrade after WebSocket returns.

- [ ] **Step 7: Handle verification failures without bundling unrelated work**

If verification fails, return to failing task, add regression test there, apply
smallest in-scope fix, rerun that task's checks, and use that task's exact commit
scope. If no fix is needed, do not create empty commit.
