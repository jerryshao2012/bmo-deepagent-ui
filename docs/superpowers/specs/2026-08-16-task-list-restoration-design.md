# Task List Restoration and Thread-Scoped Collapse

## Problem

Persisted root tasks can disappear after a thread reload even though LangGraph's
latest thread state still contains `todos`. Persisted nested checkpoint history
is intentionally disabled because dynamic nested tool namespaces cause backend
`Subgraph tools not found` errors. The frontend therefore polls the latest root
thread snapshot separately.

`useChat` currently selects all snapshot-backed fields through a message-count
condition. When SDK-restored messages and server-snapshot messages have equal
lengths, empty `stream.values.todos` wins over populated
`serverSnapshot.todos`. Task visibility is incorrectly coupled to message
completeness.

The metadata panel also initializes collapsed only on the first component mount.
Because `ChatInterface` remains mounted during thread navigation, a panel opened
on one thread can remain open on the next thread.

## Requirements

- Restore root `todos` from the latest server snapshot whenever the thread is
  idle and a snapshot is available.
- During an active run, use live stream todos, including an intentionally empty
  list, so stale persisted tasks never replace current run state.
- Before any root snapshot has been obtained, including an initial retrieval
  failure, fall back to stream todos. After a valid snapshot exists, retain it
  across transient polling failures, matching current snapshot behavior.
- Associate each snapshot with its owning thread and never use it for another
  thread.
- Reject older same-thread polling responses so overlapping requests cannot
  roll task state backward.
- After a run starts, keep final live todos authoritative until a snapshot
  request started after that run became idle confirms persisted state.
- Keep `fetchStateHistory: false`; do not restore persisted nested subagent
  history.
- Keep live nested subagent events and tool calls unchanged.
- Collapse the metadata panel when opening or switching threads.
- Do not collapse the panel merely because a new run starts or finishes within
  the same thread.
- Preserve existing task rendering, ordering, status labels, files, documents,
  wiki state, and message-selection behavior.

## Design

### Todo Source Selection

Add small pure selectors near chat hook state-selection code. Inputs include
live stream todos, optional server-snapshot todos, thread ownership, snapshot
timestamp, run generation, request-time idle state, and stream loading state.

- `isLoading === true`: return live stream todos.
- idle with a current-thread snapshot confirmed after the latest run: return
  server-snapshot todos.
- idle without a server snapshot: return live stream todos.

Snapshot replacement rejects older responses for the same thread. A snapshot
requested before or during a run remains ineligible after completion; only a
request started while idle in the current run generation can restore persisted
todos. This prevents stale or intermediate task lists from replacing the final
live list.

`useChat` will use this selector for `effectiveTodos` independently of
`shouldPreferServerSnapshot`, which remains unchanged for messages and other
fields.

### Metadata Panel Lifecycle

`ChatInterface` will reset `metaOpen` to `null` when `currentThreadId` changes.
No loading-state dependency will be added, so a run in the same thread does not
alter the user's panel choice.

## Data Flow

1. SDK stream continues restoring latest supported state without checkpoint
   history and continues receiving live nested events.
2. Existing polling retrieves the latest root thread snapshot and stores its
   `todos`.
3. Todo selector chooses live todos during a run and snapshot todos while idle.
4. `ChatInterface` renders selected tasks in its existing collapsed trigger and
   expanded list.
5. Thread ID change closes any open metadata panel; tasks remain available behind
   the collapsed trigger.

## Error Handling

Snapshot polling errors remain non-fatal. When no confirmed snapshot is
available, task selection falls back to stream state. A transient error after a
confirmed snapshot does not clear that snapshot. No new retries,
nested-history requests, or backend changes are added.

## Testing

- Pure selector test: idle equal-message scenario chooses populated snapshot
  todos over empty stream todos.
- Pure selector test: loading state chooses intentionally empty live todos even
  when snapshot todos exist.
- Pure selector test: missing snapshot falls back to stream todos.
- Component test: opening Tasks on thread A and switching to thread B collapses
  the metadata panel.
- Component test or retained behavior assertion: loading changes within the same
  thread do not force the panel closed.
- Retain stream-policy assertions that persisted history is disabled while live
  nested subgraph streaming remains enabled.
- Run focused Node tests, ESLint, Prettier check, and TypeScript/Next.js build as
  appropriate for changed files.
