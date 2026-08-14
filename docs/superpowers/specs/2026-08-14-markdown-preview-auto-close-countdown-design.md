# Markdown Preview Auto-Close Countdown Design

## Goal

Close the intro-page markdown preview after prolonged visible inactivity so an unused dialog does not retain a live transport. Give the user a five-second warning and a simple opportunity to keep working.

## Behavior

- Inactivity accrues only while the markdown preview dialog is open and the browser tab is visible.
- Existing preview activity signals reset the inactivity window: pointer, keyboard, scroll, wheel, touch, text change, paste, drop, and destructive removal.
- After five minutes without activity, the connection lifecycle hibernates all transports immediately and starts a five-second auto-close countdown.
- The dialog displays an accessible warning with the whole seconds remaining, from 5 through 1, plus a `Keep open` action.
- Any ordinary dialog activity or `Keep open` cancels the countdown, wakes the lifecycle, and starts a fresh five-minute inactivity window.
- When the countdown reaches zero, the lifecycle requests one dialog close. Closing keeps transports hibernated and clears all countdown state.
- Manually closing the dialog cancels the inactivity and countdown timers without a later stale close.
- Hiding the tab hibernates transports and cancels the countdown, but does not close the dialog. Returning to a visible tab starts a fresh five-minute window.
- Activity and visibility in another browser or machine cannot wake or close this local dialog.

## Architecture

`MarkdownConnectionLifecycle` remains the single timer owner. Its effects contract gains callbacks for countdown presentation and timeout-driven close. The controller publishes remaining countdown seconds and requests close only after the final second. It never manipulates React state directly.

`IntroPageContent` implements those effects with local countdown presentation state and `setIsDialogOpen(false)`. Existing activity capture continues to call `recordActivity()`, which cancels any countdown before waking/rearming the controller. The close control remains excluded from activity capture so manual close does not briefly reconnect.

Connection status remains `idle` throughout the warning because transport is already hibernated. A dedicated warning region communicates auto-close independently of the transport badge.

## Timing and State Transitions

1. Open + visible starts the existing 300,000 ms inactivity timer.
2. Activity before expiry restarts that timer.
3. Expiry hibernates transport, publishes countdown `5`, and schedules one-second ticks.
4. Ticks publish `4`, `3`, `2`, then `1`.
5. The following tick clears countdown presentation and invokes the close request once.
6. Activity during countdown clears its timer and presentation, wakes transport, and starts a new 300,000 ms inactivity timer.
7. Close, hide, thread replacement, or disposal clears both timers and presentation. Stale callbacks are ignored.

## Accessibility

The warning uses polite, atomic live-region semantics so remaining time is announced without repeatedly moving focus. `Keep open` is a keyboard-accessible button. Auto-close does not change focus before timeout; normal dialog-close focus restoration handles the final close.

## Error and Race Handling

- Countdown timers are controller-owned and cleared idempotently.
- Eligibility changes and disposal invalidate pending ticks.
- Repeated activity cannot create parallel countdowns or WebSocket attempts.
- Auto-close is requested at most once per inactivity cycle.
- A stale timeout from a prior thread/controller cannot close the current dialog.

## Tests

- Controller fake-timer tests verify exact five-minute boundary, 5-to-1 progression, one close request at zero, and transport hibernation at countdown start.
- Tests verify activity and `Keep open` cancel countdown, wake transport, and require another full five minutes before warning.
- Tests verify manual close, tab hide, disposal, and thread replacement cancel stale countdown callbacks.
- Page integration tests verify effect wiring, accessible warning text/action, and close-control exclusion.
- Existing lifecycle, convergence, heartbeat, architecture, lint, and production-build checks remain green.

## Non-Goals

- No server-side or cross-browser countdown synchronization.
- No configurable inactivity duration.
- No countdown while the tab is hidden.
- No change to WebSocket retry, fallback, heartbeat, or markdown convergence protocols.
