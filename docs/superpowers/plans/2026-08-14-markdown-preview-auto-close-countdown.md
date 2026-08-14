# Markdown Preview Auto-Close Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hibernate the intro markdown preview after five visible/open idle minutes, show an accessible five-second warning, and close the dialog unless local activity keeps it open.

**Architecture:** `MarkdownConnectionLifecycle` remains sole owner of inactivity and countdown timers. It emits countdown presentation and close-request effects; `IntroPageContent` accepts effects only from current controller, renders warning, and synchronously marks dialog ineligible before unmounting it. Local activity cancels warning and starts a fresh five-minute cycle; remote sync never enters activity path.

**Tech Stack:** TypeScript, React 19, Next.js 16, Node test runner with `tsx`, Tailwind CSS, existing fake scheduler and source-contract tests.

---

## File Map

- Modify `src/features/markdown-sync/application/connection-lifecycle.ts`: countdown constants, effect contract, epoch-guarded timer state machine.
- Modify `tests/markdown-connection-lifecycle.test.ts`: behavioral fake-timer coverage.
- Modify `src/app/intro/page.tsx`: current-controller effects, synchronous close helper, warning UI, Keep open, focus restoration.
- Modify `tests/markdown-preview-sync.test.mjs`: page wiring, accessibility, local-only activity, and stale-controller contracts.
- Create `src/features/markdown-sync/application/preview-focus-restoration.ts`: cancelable deferred focus restoration.
- Create `tests/markdown-preview-focus-restoration.test.ts`: behavioral focus scheduling/cancellation tests.

### Task 1: Add epoch-guarded countdown to lifecycle

**Files:**
- Modify: `src/features/markdown-sync/application/connection-lifecycle.ts:1-349`
- Test: `tests/markdown-connection-lifecycle.test.ts:1-505`

- [ ] **Step 1: Write all failing lifecycle behavior tests**

Extend `EffectRecorder`:

```ts
readonly countdowns: Array<number | null> = [];
requestAutoCloseCalls = 0;

setAutoCloseCountdown(seconds: number | null): void {
  this.countdowns.push(seconds);
}

requestAutoClose(): void {
  this.requestAutoCloseCalls += 1;
}
```

Import and assert `MARKDOWN_AUTO_CLOSE_SECONDS === 5` and `MARKDOWN_COUNTDOWN_TICK_MS === 1_000`. Replace the old five-minute hibernation expectation with exact progression:

```ts
scheduler.advanceBy(MARKDOWN_INACTIVITY_MS);
assert.equal(effects.status, "idle");
assert.deepEqual(effects.countdowns, [5]);
assert.equal(effects.requestAutoCloseCalls, 0);

for (const remaining of [4, 3, 2, 1]) {
  scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);
  assert.equal(effects.countdowns.at(-1), remaining);
}
scheduler.advanceBy(MARKDOWN_COUNTDOWN_TICK_MS);
assert.equal(effects.countdowns.at(-1), null);
assert.equal(effects.requestAutoCloseCalls, 1);
```

Assert `stopAllTransports` increments at five minutes, not after the warning.

Add exact counter/timer cases for:

- activity at countdown 3 clears warning, reconnects once, and requires a new full five minutes;
- hide at 4:59, remain hidden, show, then require a new full five minutes;
- hide during warning clears it, leaves close count zero, and prevents stale close;
- manual `setDialogOpen(false)` clears warning and never reconnects;
- disposal prevents later warning/close effects;
- disposed old controller cannot affect a newly eligible controller;
- activity-before-zero cancels close; zero-before-activity closes once and does not wake;
- same-value `setDialogOpen(true)` and `setVisibility(true)` during countdown neither wake nor cancel/restart it, then the original countdown reaches one close.
- after the close effect synchronously calls `setDialogOpen(false)`, reopening the same lifecycle resets the close latch and permits a second full five-minute/countdown/close cycle.

- [ ] **Step 2: Run test to verify RED**

```bash
node --import tsx --test --test-isolation=none tests/markdown-connection-lifecycle.test.ts
```

Expected: FAIL because countdown API and behavior do not exist.

- [ ] **Step 3: Implement minimal countdown state**

Add contract:

```ts
export const MARKDOWN_AUTO_CLOSE_SECONDS = 5;
export const MARKDOWN_COUNTDOWN_TICK_MS = 1_000;

export interface MarkdownConnectionEffects {
  // existing effects
  setAutoCloseCountdown(seconds: number | null): void;
  requestAutoClose(): void;
}
```

Add controller fields:

```ts
private idleCycleEpoch = 0;
private countdownTimer: unknown;
private countdownSeconds: number | null = null;
private closeRequested = false;
```

Implement an idempotent `publishCountdown`, countdown timer cleanup, and an idle-cycle invalidator. Split transport timer/transport state cleanup from idle-cycle cleanup: the five-minute callback hibernates transport without cancelling its new warning, while genuine eligibility loss cancels the idle cycle before transport-effect deduplication. `armInactivityTimer()` must capture a new epoch. At a valid five-minute callback: hibernate transport first, create a new countdown epoch, publish `5`, then schedule one-second ticks. Ticks publish `4`, `3`, `2`, `1`; the next tick latches close, publishes `null`, and calls `requestAutoClose()` once.

Every inactivity/countdown callback must require matching epoch, undisposed controller, open dialog, visible tab, and an unset close latch. `recordActivity()` is a no-op when ineligible or after `closeRequested` is latched; during countdown it invalidates/clears warning before `wake()`. A changed eligibility setter that makes the controller ineligible must increment epoch and clear countdown even when transport is already sleeping/reconciled. Preserve existing one-time reconciliation for a fresh, initially ineligible controller even when its first setter receives the same value. Only same-value setters while already eligible/counting down are true no-ops. Reset `closeRequested` only when starting a genuinely new eligible wake/idle cycle, so reopening after a completed auto-close works without allowing a late event from the old cycle to wake. Disposal also invalidates countdown. Avoid clearing the newly started countdown by using the transport-only hibernation path before creating its epoch.

- [ ] **Step 4: Run lifecycle test, verify GREEN, and commit**

Run Step 2 command. Expected: zero failures. Then:

```bash
git add src/features/markdown-sync/application/connection-lifecycle.ts tests/markdown-connection-lifecycle.test.ts
git commit -m "feat: add markdown preview auto-close countdown"
```

### Task 2: Wire current-controller effects and accessible warning

**Files:**
- Modify: `src/app/intro/page.tsx:65-145, 717-770, 1571, 2205-2365`
- Test: `tests/markdown-preview-sync.test.mjs:315-385`
- Create: `src/features/markdown-sync/application/preview-focus-restoration.ts`
- Test: `tests/markdown-preview-focus-restoration.test.ts`

- [ ] **Step 1: Write failing page contract test**

Require bounded source sections for:

- `autoCloseSeconds: number | null` state and preview-trigger ref;
- one `closeMarkdownPreview` helper calling `lifecycle.setDialogOpen(false)` before `setIsDialogOpen(false)`;
- countdown and close effects guarded by `lifecycleRef.current === lifecycle`;
- manual close using helper instead of direct state mutation;
- warning gated by non-null seconds with `role="status"`, `aria-live="polite"`, `aria-atomic="true"`, countdown text, and `Keep open` button;
- Keep open calling `noteMarkdownActivity()`;
- semantic `<button type="button">` preview opener and focus restored after unmount;
- rapid reopen cancels pending focus restoration so focus never moves behind an open dialog;
- focus scheduling occurs in a React effect after `isDialogOpen === false` has committed, not directly in the close event;
- remote `applyContent`, WebSocket, SSE, and backend reconciliation sections not calling `noteMarkdownActivity()`.

In `tests/markdown-preview-focus-restoration.test.ts`, use a fake animation-frame scheduler and fake focus counter to prove scheduled restoration runs once, cancellation prevents it, rescheduling replaces prior work, and `shouldRestore() === false` prevents focus.

- [ ] **Step 2: Run page test to verify RED**

```bash
node --import tsx --test --test-isolation=none tests/markdown-preview-focus-restoration.test.ts tests/markdown-preview-sync.test.mjs
```

Expected: FAIL because focus helper and countdown wiring/UI are absent.

- [ ] **Step 3: Implement close helper and controller effects**

Create `preview-focus-restoration.ts` with this focused API:

```ts
export interface AnimationFrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export class PreviewFocusRestoration {
  private handle: number | null = null;

  constructor(private readonly scheduler: AnimationFrameScheduler) {}

  schedule(restore: () => void, shouldRestore: () => boolean): void {
    this.cancel();
    this.handle = this.scheduler.request(() => {
      this.handle = null;
      if (shouldRestore()) restore();
    });
  }

  cancel(): void {
    if (this.handle === null) return;
    this.scheduler.cancel(this.handle);
    this.handle = null;
  }
}
```

Instantiate it once in a ref with browser `requestAnimationFrame`/`cancelAnimationFrame`. Add state/ref:

```ts
const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
const markdownPreviewTriggerRef = useRef<HTMLButtonElement>(null);
const focusRestorationRef = useRef<PreviewFocusRestoration | null>(null);
const restorePreviewFocusPendingRef = useRef(false);
```

Initialize the ref once with adapters that delegate to `globalThis.requestAnimationFrame` and `globalThis.cancelAnimationFrame`. Add stable open/close helpers:

```ts
const openMarkdownPreview = useCallback(() => {
  focusRestorationRef.current?.cancel();
  restorePreviewFocusPendingRef.current = false;
  isDialogOpenRef.current = true;
  setIsDialogOpen(true);
}, []);

const closeMarkdownPreview = useCallback(
  (sourceLifecycle?: MarkdownConnectionLifecycle) => {
    const lifecycle = lifecycleRef.current;
    if (sourceLifecycle && lifecycle !== sourceLifecycle) return;
    isDialogOpenRef.current = false;
    lifecycle?.setDialogOpen(false);
    setAutoCloseSeconds(null);
    restorePreviewFocusPendingRef.current = true;
    setIsDialogOpen(false);
  },
  [],
);
```

Schedule restoration from an effect that runs only after the closed render commits:

```ts
useEffect(() => {
  if (isDialogOpen || !restorePreviewFocusPendingRef.current) return;
  restorePreviewFocusPendingRef.current = false;
  focusRestorationRef.current?.schedule(
    () => markdownPreviewTriggerRef.current?.focus(),
    () => !isDialogOpenRef.current,
  );
}, [isDialogOpen]);
```

In lifecycle setup, use a closure guarded by current controller identity:

```ts
let lifecycle: MarkdownConnectionLifecycle;
lifecycle = new MarkdownConnectionLifecycle({
  // existing effects
  setAutoCloseCountdown: (seconds) => {
    if (lifecycleRef.current !== lifecycle) return;
    setAutoCloseSeconds(seconds);
  },
  requestAutoClose: () => closeMarkdownPreview(lifecycle),
});
```

Dispose old lifecycle before clearing its ref. Clear warning only if cleanup owns current lifecycle. Add `closeMarkdownPreview` to lifecycle effect dependencies. Convert the current clickable `<span>` opener to a semantic `<button type="button">` and attach trigger ref. Its open helper synchronously sets `isDialogOpenRef.current = true`, cancels pending focus restoration and its pending flag, and opens state. Route manual close through `closeMarkdownPreview()`; it synchronously sets the ref false before lifecycle/state changes and marks focus pending. Cancel pending focus restoration and clear its flag on component cleanup. The source integration test must locate focus scheduling inside the `[isDialogOpen]` post-commit effect and assert it is absent from `closeMarkdownPreview`.

- [ ] **Step 4: Render warning and Keep open**

Place below modal header:

```tsx
{autoCloseSeconds !== null && (
  <div
    role="status"
    aria-live="polite"
    aria-atomic="true"
    className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
  >
    <span>
      Closing in {autoCloseSeconds} {autoCloseSeconds === 1 ? "second" : "seconds"} due to inactivity.
    </span>
    <button
      type="button"
      onClick={() => noteMarkdownActivity()}
      className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
    >
      Keep open
    </button>
  </div>
)}
```

Do not change server, WebSocket, fallback, or pending-edit protocols.

- [ ] **Step 5: Run focused tests and commit**

```bash
node --import tsx --test --test-isolation=none tests/markdown-connection-lifecycle.test.ts tests/markdown-preview-activity.test.ts tests/markdown-preview-focus-restoration.test.ts tests/markdown-preview-sync.test.mjs
git add src/app/intro/page.tsx src/features/markdown-sync/application/preview-focus-restoration.ts tests/markdown-preview-focus-restoration.test.ts tests/markdown-preview-sync.test.mjs
git commit -m "feat: auto-close idle markdown preview"
```

Expected: zero failures before commit.

### Task 3: Full regression verification

**Files:** Verify only; no planned production changes.

- [ ] **Step 1: Run all markdown tests**

```bash
node --import tsx --test --test-isolation=none tests/markdown-attachment-types.test.ts tests/markdown-backend-sync-store.test.ts tests/markdown-connection-lifecycle.test.ts tests/markdown-connection-status.test.ts tests/markdown-images.test.ts tests/markdown-pending-edit-coordinator.test.ts tests/markdown-preview-activity.test.ts tests/markdown-preview-focus-restoration.test.ts tests/markdown-preview-sync.test.mjs tests/markdown-server-state.test.mjs tests/markdown-sync-architecture.test.mjs tests/markdown-sync-state.test.ts tests/markdown-websocket-heartbeat.test.mjs tests/synced-markdown-attachment.test.tsx
```

Expected: zero failures.

- [ ] **Step 2: Run repository gates**

```bash
yarn test:architecture
yarn lint
yarn build
```

Expected: every command exits 0. If Turbopack cannot bind inside sandbox, rerun build with approved unsandboxed execution.

- [ ] **Step 3: Inspect optimizer and repository hygiene**

```bash
threadroot score latest --json
git diff --check
git status --short
```

Expected: score or explicit no-score result, clean diff, and only intentional changes.

- [ ] **Step 4: Final review**

Review timer ownership, exact 5-to-1 timing, local-only activity, eligibility epoch, controller identity, focus restoration, and protocol non-regression. Any fix gets a regression test and separate commit, followed by every gate above.
