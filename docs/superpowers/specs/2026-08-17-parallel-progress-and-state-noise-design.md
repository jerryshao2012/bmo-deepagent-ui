# Parallel Progress and State Noise Design

## Goal

Show truthful progress while research subagents run, stop useless polling for missing threads, and avoid expected document-state conflicts during active runs.

## Scope

- Change chat task summary for parallel `research-agent` task calls.
- Change thread snapshot polling behavior after HTTP failures.
- Change document-availability persistence scheduling while a selected thread is busy.
- Add focused frontend regression tests.
- Keep backend APIs and persisted state schema unchanged.

## Parallel research progress

`ChatInterface` will derive a transient parallel-research summary from processed assistant-message tool calls, which already contain the live task-call statuses used by subagent cards.

A parallel batch is the latest assistant message containing at least two `task` tool calls whose `subagent_type` is `research-agent`. The batch is active while at least one call has the non-terminal `pending` status. While active, the collapsed task trigger will show:

`Parallel research: <completed>/<total> complete`

Completed count comes only from task calls with status `completed`; total count comes from all research-agent task calls in that batch. `error` and `interrupted` are terminal but do not increase completed count. Existing task icon and elapsed-time treatment remain unchanged. Parallel summary takes precedence only while batch is active. As soon as every call is terminal, whether successful, failed, or interrupted, UI immediately returns to existing root-task progress, including its completion behavior. A single research agent never replaces root-task progress.

Progress derivation will live in a small pure utility so status selection and transition behavior can be unit tested without rendering full chat interface.

## Thread snapshot polling

Current fixed `setInterval` retries every 2.5 seconds, silently catches every error, and restarts after message/loading dependency changes. Polling will become one self-scheduling timeout per selected thread.

- First snapshot request remains immediate.
- Successful request resets delay to normal 2.5-second cadence.
- HTTP 404 marks selected thread missing and stops further snapshot requests for that thread.
- Other failures use deterministic capped exponential delays of 5, 10, 20, then 30 seconds for subsequent failures.
- Selecting a different thread cancels prior timeout and starts a fresh polling lifecycle.
- Live stream state is read through refs so message or loading updates do not recreate polling lifecycle or cause extra immediate requests.

HTTP status detection will accept SDK errors exposing a numeric `status` or `statusCode`; unclassified failures remain transient and back off.

## Document-state persistence

`useThreadDocumentAvailability` already retains latest deferred write after a 409. It will additionally check known selected-thread status before making request:

- If status is `busy`, store latest desired values in existing pending-persistence map and do not call `updateThreadState`.
- When thread status is confirmed non-busy, flush latest pending values once.
- If status is unknown, keep current attempt behavior so new/unrendered thread uploads are not stranded.
- Keep 409 handling as race-condition fallback when run starts between status check and write.
- Preserve current stale-thread, thread-switch, unmount, serialization, and upload-result semantics.

## Error handling

Expected missing-thread 404s and busy-thread deferrals do not log errors. Unexpected polling failures remain silent as today but occur with backoff. Unexpected persistence failures retain current error reporting.

## Testing

Regression tests will be written before production changes and must cover:

- Two of three research task calls produce `Parallel research: 2/3 complete`.
- A fully completed parallel batch yields immediately to root-task progress.
- Single-agent and non-research task calls leave root-task progress unchanged.
- Snapshot polling stops after 404 and cancels when thread changes.
- Transient snapshot failures back off and success resets cadence.
- Busy status defers document-state write without first producing 409.
- Deferred values flush once after confirmed idle status.
- Existing 409 race fallback and stale-thread protections still pass.

Verification uses focused Node/React tests, then `yarn lint` and `yarn build`.

## Non-goals

- Backend progress events or API changes.
- Persisting parallel progress.
- Changing expanded task-list contents.
- Retrying a thread that remains selected after confirmed 404; selecting another thread or remounting/reloading chat starts a new lifecycle, while an in-place history refresh does not.
