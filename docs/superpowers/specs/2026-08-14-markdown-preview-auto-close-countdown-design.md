# Markdown Preview Auto-Close Countdown Design

## Goal

Close the intro-page markdown preview after prolonged visible inactivity so an unused dialog does not retain a live transport. Give the user a five-second warning and a simple opportunity to keep working.

## Behavior

- Inactivity accrues only while the markdown preview dialog is open and the browser tab is visible.
- Locally originated preview activity resets the inactivity window: pointer, keyboard, scroll, wheel, touch, direct text input, paste, drop, and destructive removal. Inbound WebSocket, SSE, backend-poll, cache, or other reconciliation updates never count as local activity.
- After five minutes without activity, the connection lifecycle hibernates all transports immediately and starts a five-second auto-close countdown.
- The dialog displays an accessible warning with the whole seconds remaining, from 5 through 1, plus a `Keep open` action.
- Any ordinary dialog activity or `Keep open` cancels the countdown, wakes the lifecycle, and starts a fresh five-minute inactivity window.
- When the countdown reaches zero, the lifecycle requests one dialog close. Closing keeps transports hibernated and clears all countdown state.
- Manually closing the dialog cancels the inactivity and countdown timers without a later stale close.
- Hiding the tab hibernates transports and cancels the countdown, but does not close the dialog. Returning to a visible tab starts a fresh five-minute window.
- Activity and visibility in another browser or machine cannot wake or close this local dialog.

## Architecture

`MarkdownConnectionLifecycle` remains the single timer owner. Its effects contract gains callbacks for countdown presentation and timeout-driven close. The controller publishes remaining countdown seconds and requests close only after the final second. It never manipulates React state directly.

`IntroPageContent` implements those effects with local countdown presentation state and a single close helper. The helper synchronously tells the current lifecycle that the dialog is closed before calling `setIsDialogOpen(false)`. Existing local activity capture continues to call `recordActivity()`, which cancels any countdown before waking/rearming the controller. Remote content application bypasses that activity path. The close control remains excluded from activity capture so manual close does not briefly reconnect.

Each lifecycle instance owns an eligibility epoch. Starting, cancelling, or replacing an inactivity/countdown cycle increments that epoch. Every timer callback captures its epoch and proceeds only when it still matches, the controller is undisposed, and the dialog is still open and visible. The page also accepts a timeout close only from the lifecycle instance still stored in `lifecycleRef`.

Connection status remains `idle` throughout the warning because transport is already hibernated. A dedicated warning region communicates auto-close independently of the transport badge.

## Timing and State Transitions

1. Open + visible starts the existing 300,000 ms inactivity timer.
2. Activity before expiry restarts that timer.
3. Expiry hibernates transport, publishes countdown `5`, and schedules one-second ticks.
4. Ticks publish `4`, `3`, `2`, then `1`.
5. The following tick clears countdown presentation and invokes the close request once.
6. Local activity during countdown invalidates its epoch, clears its timer and presentation, wakes transport, and starts a new 300,000 ms inactivity timer. `recordActivity()` is otherwise a no-op unless the dialog is currently open and visible.
7. Manual close or hide synchronously invalidates the epoch, clears both timers and countdown presentation, and hibernates transport. Hide leaves dialog open; showing it starts a new full 300,000 ms window rather than resuming elapsed time.
8. Thread replacement disposes the old controller, rejects its effects by instance identity, initializes the new controller from current dialog/visibility eligibility, and starts a fresh 300,000 ms window when open and visible.

## Accessibility

The warning uses polite, atomic live-region semantics so remaining time is announced without repeatedly moving focus. `Keep open` is a keyboard-accessible button. Auto-close does not change focus before timeout; normal dialog-close focus restoration handles the final close.

## Error and Race Handling

- Inactivity and countdown timers are controller-owned and cleared idempotently.
- Eligibility changes, cycle changes, and disposal increment the controller epoch before clearing pending timers.
- Every callback rechecks captured epoch, controller disposal, open/visible eligibility, and its one-shot close latch.
- Page countdown and close effects are accepted only when their emitting lifecycle is still the current lifecycle for the active thread.
- Repeated activity cannot create parallel countdowns or WebSocket attempts.
- Auto-close is requested at most once per inactivity cycle.
- If local activity and the zero tick are queued together, normal JavaScript callback order determines which wins: a valid zero tick closes once; activity processed first invalidates the tick and preserves the dialog. Neither ordering may both wake and close.
- A stale timeout from a prior thread/controller cannot close the current dialog.

## Tests

- Controller fake-timer tests verify exact five-minute boundary, 5-to-1 progression, one close request at zero, and transport hibernation at countdown start.
- Tests verify activity and `Keep open` cancel countdown, wake transport, and require another full five minutes before warning.
- Tests verify hidden time never accrues: hiding at 4:59 discards elapsed time, showing starts a full five-minute window, and hiding during countdown leaves the dialog open with no later stale close.
- Tests verify manual close synchronously invalidates timers and never wakes transport; disposal and thread replacement reject stale countdown presentation/close effects, while an eligible replacement starts a fresh timer.
- Tests cover both activity-versus-zero callback orders and prove each produces one deterministic outcome without a wake-and-close combination.
- Tests prove remote sync during countdown or while hidden neither cancels countdown nor wakes transport.
- Page integration tests verify current-controller effect wiring, accessible polite/atomic warning text and `Keep open` action, close-control exclusion, and normal focus restoration after timeout close.
- Existing lifecycle, convergence, heartbeat, architecture, lint, and production-build checks remain green.

## Non-Goals

- No server-side or cross-browser countdown synchronization.
- No configurable inactivity duration.
- No countdown while the tab is hidden.
- No change to WebSocket retry, fallback, heartbeat, or markdown convergence protocols.
