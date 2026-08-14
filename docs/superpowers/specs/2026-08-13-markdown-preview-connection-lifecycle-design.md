# Markdown Preview Connection Lifecycle Design

## Problem

The intro page opens its markdown synchronization WebSocket as soon as the page
loads, even when the preview dialog is closed. The connection has no heartbeat.
When a proxy or network path closes an idle socket, the client immediately enters
HTTP fallback and sets a sticky fallback flag that prevents later WebSocket
reconnection. Refreshing the page clears that flag, which explains why the
indicator returns from blue to green only after refresh.

Unused dialogs and hidden tabs also retain WebSocket, SSE, local polling, and
cross-deployment polling resources. Multiple browsers therefore keep background
connections alive even when nobody is using their preview.

## Goals

- Hibernate markdown synchronization when the dialog closes, the browser tab is
  hidden, or a visible open dialog receives no activity for five minutes.
- Wake synchronization when the dialog opens, its tab becomes visible, or the
  user interacts with an idle visible dialog.
- Attempt WebSocket first on every wake so a browser does not carry blue fallback
  state across hibernation.
- Keep active WebSockets alive with server-side protocol ping/pong.
- Recover active clients from transient WebSocket failures without requiring a
  page refresh.
- Preserve queued local edits and converge with authoritative remote content
  after wake, including changes made from another machine.
- Let every browser hibernate and wake independently.

## Non-goals

- Waking a hidden browser because another machine becomes active.
- Keeping background connections alive solely to preserve a green indicator.
- Replacing WebSocket, SSE, browser storage, backend mirror, or existing markdown
  persistence mechanisms.
- General refactoring of the intro page outside markdown connection lifecycle.
- Cross-device presence, active-user indicators, or collaborative cursors.

## Chosen approach

Add a small lifecycle controller or hook around the existing markdown transports.
It owns desired activity, lifecycle status, inactivity timing, reconnection timing,
and transport cleanup. Existing content synchronization functions remain the data
plane and are called by the lifecycle controller.

This is preferred over adding more independent refs and effects directly to the
large intro page because central ownership makes intentional shutdown distinct
from network failure. It is preferred over heartbeat-only handling because
heartbeat does not release unused connections or fix sticky fallback state.

## Lifecycle states

The UI exposes these states:

- `idle`: synchronization intentionally hibernated;
- `connecting`: WebSocket connection in progress;
- `connected`: WebSocket active and indicator green;
- `reconnecting`: active client retrying WebSocket after an unexpected close;
- `fallback`: SSE/HTTP synchronization active and indicator blue;
- `disconnected`: terminal or initialization state when synchronization cannot
  currently run.

The existing badge adds a neutral gray `IDLE` presentation. `RECONNECTING` uses
the current amber connecting treatment. Intentional hibernation must never appear
as failure or fallback.

## Activity and hibernation policy

A browser is eligible to stay active only when its markdown dialog is open and
`document.visibilityState` is `visible`.

Hibernate immediately when either condition becomes false:

- dialog closes;
- browser tab becomes hidden, including page-hide navigation behavior.

While dialog remains open and visible, reset a five-minute inactivity deadline on
meaningful dialog interaction: keyboard input, pointer or click interaction,
scroll or wheel, and touch. Do not use continuous mouse movement because it is
noisy and can keep an unattended client alive.

When deadline expires, enter `idle`. The next meaningful interaction wakes client.
Opening dialog or returning its tab to foreground also wakes client without
waiting for another gesture, but only when both eligibility conditions are true:
dialog open and tab visible. Returning to a visible tab does not wake a closed
dialog, and opening dialog in a hidden tab does not start transport.

Entering `idle` closes WebSocket and EventSource intentionally, stops fallback
polling, cross-deployment polling, inactivity timers, reconnect timers, and
fallback-to-WebSocket upgrade timers. Cleanup marks socket close as intentional
before closing it so close/error handlers cannot start fallback.

## Wake and synchronization data flow

Each machine wakes independently. A hidden or closed browser remains asleep even
when another machine edits same markdown thread.

Wake performs this sequence:

1. Clear prior sticky fallback and retry state.
2. Start authoritative synchronization and attempt WebSocket first.
3. Send existing WebSocket `init` message and accept server-resolved content.
4. Restart cross-deployment synchronization with an immediate read before normal
   polling cadence.
5. Move to green `connected` after WebSocket opens.

Content resolution keeps current server-authoritative behavior: persisted server
state wins; browser cache seeds only a thread that has never existed. Content
changed by another machine while this browser slept therefore arrives during
wake.

If user edits while wake is still connecting, apply edit locally and retain latest
pending value. Do not overwrite it with an older asynchronous response. Publish
queued value once active transport is ready, using existing content-version and
pending-update guards. Only latest pending content needs delivery.

## Active WebSocket heartbeat

The custom `ws` server sends protocol-level ping frames to connected clients every
25 seconds. Browser WebSocket implementation automatically replies with pong; no
client application message or browser timer is required.

For each interval, server marks client unresponsive before ping. Receipt of pong
marks it responsive. A client still unresponsive at next heartbeat is terminated,
allowing existing close handling and room cleanup to run. Heartbeat interval is
cleared during graceful server shutdown.

Hibernated browsers have already closed their sockets and therefore consume no
heartbeat work.

## Failure recovery

Each WebSocket connection attempt has a 10-second deadline. If socket has not
opened by deadline, detach its handlers, close it intentionally, and treat attempt
as failed. This prevents browser from remaining in `CONNECTING` indefinitely.

Unexpected close, error, or connection-attempt timeout while client should be
active logs close code and reason when available, then retries WebSocket after 1,
2, and 4 seconds. Retry remains suppressed when dialog closes or tab becomes
hidden during backoff.

After three failed attempts, start existing SSE/HTTP fallback and show blue
`FALLBACK`. While fallback remains active and client remains eligible, attempt a
WebSocket upgrade every 60 seconds. Successful upgrade closes EventSource and
fallback polling, clears retry state, initializes WebSocket, and returns indicator
to green.

Intentional hibernation clears fallback state. Next local wake always begins with
WebSocket rather than resuming blue fallback.

SSE auto-reconnection remains responsible for transient fallback stream failures.
If all transports are unavailable, preserve local content and pending latest update;
status remains fallback or disconnected according to whether fallback initialized.

## Components and ownership

- Intro page supplies `threadId`, dialog-open state, activity events, and existing
  synchronization callbacks to lifecycle controller.
- Lifecycle controller owns status, desired-active calculation, five-minute timer,
  WebSocket retry sequence, 60-second upgrade timer, and intentional-close guard.
- Existing WebSocket, fallback, and cross-deployment functions own transport data
  handling but expose explicit start/stop operations to controller.
- Custom server owns protocol heartbeat and dead-client termination.

Only one owner may create or dispose each transport timer. React unmount and thread
ID change use same hibernation cleanup path, preventing leaked sockets or stale
callbacks from old thread.

## Testing

Lifecycle tests use fake timers and controlled transport doubles to prove:

- dialog close and hidden-tab transitions hibernate immediately;
- five minutes of meaningful inactivity hibernates visible open dialog;
- supported activity resets deadline while mouse movement alone does not;
- reopening dialog, returning tab to visibility, and interacting while idle wake
  client and attempt WebSocket first;
- intentional close never starts fallback;
- unexpected close retries at 1, 2, and 4 seconds, then enters fallback;
- a WebSocket still connecting after 10 seconds is closed and advances bounded
  retry sequence;
- active fallback attempts WebSocket upgrade after 60 seconds and returns green on
  success;
- hiding or closing during retry cancels retry and upgrade timers;
- local edits made during wake remain pending and are not overwritten by stale
  remote responses;
- two simulated browsers sleep independently, and sleeping second browser receives
  first browser's latest authoritative content when locally reactivated.

Server tests prove responsive clients survive ping/pong, unresponsive clients are
terminated, rooms clean up after termination, and heartbeat interval stops during
shutdown.

Existing markdown preview synchronization tests remain green. Verification runs
narrow lifecycle and server tests first, then `yarn lint` and `yarn build`.

## Rollout and observability

WebSocket close logs include thread-safe context, close code, close reason, current
lifecycle state, and whether close was intentional. Logs must not include markdown
content, session tokens, or credentials.

Manual verification uses two machines on same markdown ID:

1. Open both dialogs and verify both become green.
2. Hide or close second browser and verify it becomes gray idle and releases its
   connection without changing first browser.
3. Edit on first browser.
4. Return to second browser and verify it attempts WebSocket, becomes green, and
   receives latest content.
5. Leave visible second dialog untouched for five minutes, verify idle, interact,
   and verify green wake.
6. Simulate an active WebSocket failure, verify bounded retry then blue fallback,
   and verify automatic return to green when WebSocket becomes available.

Rollback restores previous client lifecycle and removes heartbeat interval. Stored
markdown format and persistence are unchanged, so no data migration or cleanup is
required.
