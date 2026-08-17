# Parallel Progress and State Noise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live parallel-research completion, stop/back off missing-thread polling, and defer document-state writes during active runs.

**Architecture:** Add two small pure/application units: a selector that derives transient parallel progress from processed tool calls, and a scheduler-driven thread snapshot poller with explicit success/missing/transient outcomes. Keep React components responsible only for rendering and wiring; extend existing document availability queue to defer before a known-busy write.

**Tech Stack:** TypeScript, React 19, Next.js 16, LangGraph SDK, Node test runner, Testing Library.

---

## File map

- Create `src/app/utils/parallel-research-progress.ts`: pure latest-batch progress selector.
- Create `tests/parallel-research-progress.test.ts`: selector status and precedence tests.
- Modify `src/app/utils/processMessages.ts`: preserve error status from failed tool-result messages.
- Modify `tests/process-messages.test.ts`: production-pipeline failed task normalization coverage.
- Modify `src/app/components/ChatInterface.tsx`: render transient parallel label before root-task label.
- Modify `tests/chat-interface-document-state.test.tsx`: UI-level label and fallback coverage using existing chat harness.
- Create `src/features/chat/application/thread-snapshot-poller.ts`: cancellable, scheduler-driven polling lifecycle and HTTP status classifier.
- Create `tests/thread-snapshot-poller.test.ts`: deterministic cadence, backoff, 404, cancellation, and stale-completion tests.
- Modify `src/app/hooks/useChat.ts`: wire one poller per selected thread and read live stream facts through refs.
- Modify `tests/chat-thread-boundaries.test.mjs`: assert chat hook delegates polling lifecycle instead of owning a fixed interval.
- Modify `src/app/hooks/useThreadDocumentAvailability.ts`: preflight known-busy writes into existing deferred queue.
- Modify `tests/thread-document-availability.test.tsx`: prove busy runs make no write attempt and flush latest state once idle.

### Task 1: Derive and render parallel research progress

**Files:**
- Create: `tests/parallel-research-progress.test.ts`
- Create: `src/app/utils/parallel-research-progress.ts`
- Modify: `tests/process-messages.test.ts`
- Modify: `src/app/utils/processMessages.ts:165-181`
- Modify: `tests/chat-interface-document-state.test.tsx`
- Modify: `src/app/components/ChatInterface.tsx:942-983,1291-1388`

- [ ] **Step 1: Write failing selector tests**

Cover latest qualifying batch, `2/3` success count, fully completed fallback, `error`/`interrupted` terminal handling, and single/non-research exclusion.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessedMessage } from "../src/app/utils/processMessages";
import type { ToolCall } from "../src/app/types/types";
import { selectParallelResearchProgress } from "../src/app/utils/parallel-research-progress";

const batch = (calls: ToolCall[]): ProcessedMessage => ({
  message: { id: "ai-batch", type: "ai", content: "" },
  toolCalls: calls,
  showAvatar: true,
}) as ProcessedMessage;

const research = (id: string, status: ToolCall["status"]): ToolCall => ({
  id,
  name: "task",
  args: { subagent_type: "research-agent" },
  status,
});

test("reports completed research calls in latest active parallel batch", () => {
  assert.deepEqual(
    selectParallelResearchProgress([
      batch([
        research("one", "completed"),
        research("two", "completed"),
        research("three", "pending"),
      ]),
    ]),
    { completed: 2, total: 3 },
  );
});

test("returns root progress after every parallel call is terminal", () => {
  assert.equal(
    selectParallelResearchProgress([
      batch([
        research("one", "completed"),
        research("two", "error"),
        research("three", "interrupted"),
      ]),
    ]),
    null,
  );
});
```

- [ ] **Step 2: Run selector test and verify RED**

Run: `node --import tsx --test tests/parallel-research-progress.test.ts`

Expected: FAIL because `src/app/utils/parallel-research-progress.ts` does not exist.

- [ ] **Step 3: Implement minimal selector**

```ts
import type { ToolCall } from "@/app/types/types";
import type { ProcessedMessage } from "@/app/utils/processMessages";

export interface ParallelResearchProgress {
  completed: number;
  total: number;
}

const isResearchTask = (call: ToolCall) =>
  call.name === "task" && call.args.subagent_type === "research-agent";

export function selectParallelResearchProgress(
  messages: ProcessedMessage[],
): ParallelResearchProgress | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const calls = messages[index].toolCalls.filter(isResearchTask);
    if (calls.length < 2) continue;
    if (!calls.some((call) => call.status === "pending")) return null;
    return {
      completed: calls.filter((call) => call.status === "completed").length,
      total: calls.length,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run selector tests and verify GREEN**

Run: `node --import tsx --test tests/parallel-research-progress.test.ts`

Expected: all selector tests pass.

- [ ] **Step 5: Add failing production-pipeline error normalization test**

Extend `tests/process-messages.test.ts` so a correlated tool result with LangChain message status `error` produces a root task `ToolCall` with status `error`, while successful results remain `completed`.

```ts
function tool(
  id: string,
  content: string,
  toolCallId = "missing",
  fields: Record<string, unknown> = {},
): Message {
  return {
    id,
    type: "tool",
    content,
    tool_call_id: toolCallId,
    ...fields,
  } as Message;
}

test("preserves failed task result status", () => {
  const processed = processMessages(
    [
      ai("tasks", "", {
        tool_calls: [
          {
            id: "failed-task",
            name: "task",
            args: { subagent_type: "research-agent" },
          },
        ],
      }),
      tool("failed-result", "subagent failed", "failed-task", {
        status: "error",
      }),
    ],
    false,
  );
  assert.equal(processed[0].toolCalls[0].status, "error");
});
```

- [ ] **Step 6: Run process-message test and verify RED**

Run: `node --import tsx --test tests/process-messages.test.ts`

Expected: new assertion fails because correlated tool results are always marked `completed`.

- [ ] **Step 7: Preserve tool-result error status**

When correlating a tool message, read its optional LangChain `status`; map only `error` to `ToolCall.status = "error"` and keep all other results `completed`.

```ts
const resultStatus = (
  message as Message & { status?: "success" | "error" }
).status;
data.toolCalls[toolCallIndex] = {
  ...data.toolCalls[toolCallIndex],
  status: resultStatus === "error" ? "error" : "completed",
  result: extractMessageText(message),
};
```

- [ ] **Step 8: Run process-message and selector tests**

Run: `node --import tsx --test tests/process-messages.test.ts tests/parallel-research-progress.test.ts`

Expected: both suites pass, proving failed calls are terminal without increasing completed count.

- [ ] **Step 9: Add failing UI-level tests**

Extend existing `ChatInterface` harness with processed messages containing three research task calls. Assert collapsed task button accessible name includes `Parallel research: 2/3 complete`. Render a fully terminal batch and assert root label `Task 1 of 5` returns immediately and parallel label is absent.

- [ ] **Step 10: Run UI-level tests and verify RED**

Run: `node --import tsx --test --test-isolation=none tests/chat-interface-document-state.test.tsx`

Expected: new parallel-label assertion fails because component still renders root todo count.

- [ ] **Step 11: Wire selector into task trigger**

Memoize selector from `processedMessages`. In task-trigger branch, check parallel progress before `isCompleted` and `activeTask`, render clock icon plus exact label, and retain existing elapsed-time/content area. Do not change expanded todo grouping.

```tsx
const parallelResearchProgress = useMemo(
  () => selectParallelResearchProgress(processedMessages),
  [processedMessages],
);

if (parallelResearchProgress) {
  return [
    <Clock key="icon" size={16} className="text-warning/80" />,
    <span key="label" className="ml-[1px] min-w-0 truncate text-sm">
      Parallel research: {parallelResearchProgress.completed}/
      {parallelResearchProgress.total} complete
    </span>,
    // Existing active-task content and elapsed-time cell.
  ];
}
```

- [ ] **Step 12: Run selector, normalization, and UI tests**

Run: `node --import tsx --test --test-isolation=none tests/process-messages.test.ts tests/parallel-research-progress.test.ts tests/chat-interface-document-state.test.tsx`

Expected: all tests pass with no warnings.

- [ ] **Step 13: Commit only Task 1 files**

Run: `git commit --only src/app/utils/parallel-research-progress.ts src/app/utils/processMessages.ts src/app/components/ChatInterface.tsx tests/parallel-research-progress.test.ts tests/process-messages.test.ts tests/chat-interface-document-state.test.tsx -m "fix: show parallel research progress"`

### Task 2: Replace fixed thread polling with cancellable backoff

**Files:**
- Create: `tests/thread-snapshot-poller.test.ts`
- Create: `src/features/chat/application/thread-snapshot-poller.ts`
- Modify: `tests/chat-thread-boundaries.test.mjs`
- Modify: `src/app/hooks/useChat.ts:135-165,269-329`

- [ ] **Step 1: Write failing poller lifecycle tests**

Use a fake scheduler modeled after `tests/markdown-connection-lifecycle.test.ts`. Cover immediate first request, gated successful delivery, 2.5-second success cadence, 5/10/20/30-second transient sequence, success reset to 2.5 seconds, no timer after 404, `status` and `statusCode` classification, `stop()` cancellation, and ignored late async completion/delivery after stop.

```ts
test("confirmed missing thread stops polling", async () => {
  const { poller, scheduler, requests, deliveries } = createPoller([
    Promise.reject(Object.assign(new Error("missing"), { status: 404 })),
  ]);
  poller.start();
  await flushPromises();
  assert.equal(requests.value, 1);
  assert.equal(deliveries.length, 0);
  assert.equal(scheduler.pendingTimerCount, 0);
});

test("transient failures back off and success resets cadence", async () => {
  const { poller, scheduler, requests, deliveries } = createPoller([
    Promise.reject(new Error("offline")),
    Promise.reject(new Error("still offline")),
    Promise.resolve({ updatedAt: 3 }),
  ]);
  poller.start();
  await flushPromises();
  scheduler.advanceBy(5_000);
  await flushPromises();
  scheduler.advanceBy(10_000);
  await flushPromises();
  assert.equal(requests.value, 3);
  assert.deepEqual(deliveries, [{ updatedAt: 3 }]);
  assert.equal(scheduler.nextDelay, 2_500);
});

test("late old-thread response is not delivered after stop", async () => {
  const request = deferred<{ updatedAt: number }>();
  const { poller, deliveries } = createPoller([request.promise]);
  poller.start();
  poller.stop();
  request.resolve({ updatedAt: 1 });
  await flushPromises();
  assert.deepEqual(deliveries, []);
});
```

- [ ] **Step 2: Run poller tests and verify RED**

Run: `node --import tsx --test tests/thread-snapshot-poller.test.ts`

Expected: FAIL because poller module does not exist.

- [ ] **Step 3: Implement scheduler-driven poller**

Export constants `THREAD_SNAPSHOT_POLL_MS = 2_500` and `THREAD_SNAPSHOT_RETRY_MS = [5_000, 10_000, 20_000, 30_000]`. Implement generic `ThreadSnapshotPoller<T>` with separate async `request(): Promise<T>` and synchronous `deliver(value: T)` callbacks, `start`, `stop`, one timeout handle, and an epoch checked after every await and before delivery or rescheduling. Catch request errors inside poller; `classifyThreadSnapshotError` accepts numeric `status`, `statusCode`, or `response.status`, stops only on 404, and treats other errors as transient.

- [ ] **Step 4: Run poller tests and verify GREEN**

Run: `node --import tsx --test tests/thread-snapshot-poller.test.ts`

Expected: all lifecycle tests pass.

- [ ] **Step 5: Add failing chat-boundary delegation assertion**

Update `tests/chat-thread-boundaries.test.mjs` to require `useChat.ts` to instantiate `ThreadSnapshotPoller` and reject `setInterval(syncFromServer, 2500)`.

- [ ] **Step 6: Run boundary test and verify RED**

Run: `node --test tests/chat-thread-boundaries.test.mjs`

Expected: FAIL because `useChat.ts` still owns fixed interval polling.

- [ ] **Step 7: Wire poller into `useChat`**

Add a ref updated every render with current `stream.isLoading` and `stream.messages.length`. Keep effect dependencies to `[chatGateway, threadId]`. Poller request callback captures request-start generation/idle state, fetches and normalizes a snapshot candidate, but performs no React state writes. Poller delivery callback applies `shouldReplaceServerSnapshot` using latest ref values and calls `setServerSnapshot`. Construct/start poller in effect and call `stop()` in cleanup. Poller epoch gate ensures a response from a stopped old-thread lifecycle never reaches delivery.

```ts
const streamSnapshotRef = useRef({ isLoading: false, messageCount: 0 });
streamSnapshotRef.current = {
  isLoading: stream.isLoading,
  messageCount: stream.messages.length,
};

useEffect(() => {
  if (!threadId) {
    setServerSnapshot(null);
    return;
  }
  const poller = new ThreadSnapshotPoller(
    async () => {
      // Fetch and return normalized candidate plus request metadata only.
      return loadSnapshotCandidate(threadId);
    },
    (candidate) => {
      // Existing replacement logic and setServerSnapshot live here.
      deliverSnapshotCandidate(candidate, streamSnapshotRef.current);
    },
  );
  poller.start();
  return () => poller.stop();
}, [chatGateway, threadId]);
```

- [ ] **Step 8: Run poller and architecture tests**

Run: `node --import tsx --test tests/thread-snapshot-poller.test.ts`

Run: `node --test tests/chat-thread-boundaries.test.mjs`

Expected: both commands pass.

- [ ] **Step 9: Commit only Task 2 files**

Run: `git commit --only src/features/chat/application/thread-snapshot-poller.ts src/app/hooks/useChat.ts tests/thread-snapshot-poller.test.ts tests/chat-thread-boundaries.test.mjs -m "fix: back off thread snapshot polling"`

### Task 3: Defer known-busy document-state writes before request

**Files:**
- Modify: `tests/thread-document-availability.test.tsx:256-538`
- Modify: `src/app/hooks/useThreadDocumentAvailability.ts:118-169`

- [ ] **Step 1: Write failing known-busy tests**

Replace the current 409-first expectation with explicit attempt counting. Verify initial refresh plus upload while status is `busy` make zero `updateThreadState` calls, latest upload state replaces earlier deferred refresh state, rerender to `idle` flushes exactly once, and upload returns `deferred`. Keep existing 409 race test using initially unknown/idle status.

```ts
test("known busy status defers latest state without attempting a write", async () => {
  let attempts = 0;
  const updates: StateUpdate[] = [];
  const { result, rerender } = renderHook(
    ({ status }) => useThreadDocumentAvailability({
      threadId: "thread-1",
      selectedThreadStatus: status,
      listDocuments: async () => listResponse([]),
      updateThreadState: async (threadId, values) => {
        attempts += 1;
        updates.push({ threadId, values });
      },
    }),
    { initialProps: { status: "busy" as "busy" | "idle" } },
  );
  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  let persisted: unknown;
  await act(async () => {
    persisted = await result.current.recordUploadSuccess({
      activeThreadId: "thread-1",
      documents: [{ name: "new.pdf", size: 9, type: "file" }],
      docFolder: "docs/threads/thread-1",
    });
  });
  assert.equal(persisted, "deferred");
  assert.equal(attempts, 0);
  rerender({ status: "idle" });
  await waitFor(() => assert.equal(attempts, 1));
  assert.deepEqual(updates[0].values, {
    has_documents: true,
    doc_folder: "docs/threads/thread-1",
  });
});
```

- [ ] **Step 2: Run document hook tests and verify RED**

Run: `node --import tsx --test --test-isolation=none tests/thread-document-availability.test.tsx`

Expected: FAIL because current code calls `updateThreadState` and only defers after 409.

- [ ] **Step 3: Add known-busy preflight to existing queue**

Inside queued `persist`, after `isCurrent` and before `updateThreadState`, check `selectedThreadStatusRef.current === "busy"`. Store values through `deferPersistence` and return `deferred` only when caller accepts deferral. Leave catch-path 409 behavior unchanged for races and unknown status.

```ts
if (selectedThreadStatusRef.current === "busy") {
  deferPersistence(targetThreadId, values, epoch, allowUnrendered);
  return acceptDeferred ? "deferred" : false;
}
```

- [ ] **Step 4: Run document hook tests and verify GREEN**

Run: `node --import tsx --test --test-isolation=none tests/thread-document-availability.test.tsx`

Expected: all known-busy, 409 fallback, thread-switch, and unmount tests pass.

- [ ] **Step 5: Run ChatInterface document integration tests**

Run: `node --import tsx --test --test-isolation=none tests/chat-interface-document-state.test.tsx`

Expected: integration suite passes, including upload deferral behavior.

- [ ] **Step 6: Commit only Task 3 files**

Run: `git commit --only src/app/hooks/useThreadDocumentAvailability.ts tests/thread-document-availability.test.tsx -m "fix: defer busy document state writes"`

### Task 4: Full verification and optimizer evidence

**Files:**
- Verify only; no planned production edits.

- [ ] **Step 1: Run focused regression suite together**

Run: `node --import tsx --test --test-isolation=none tests/process-messages.test.ts tests/parallel-research-progress.test.ts tests/thread-snapshot-poller.test.ts tests/thread-document-availability.test.tsx tests/chat-interface-document-state.test.tsx`

Expected: zero failures and no unexpected console warnings/errors.

- [ ] **Step 2: Run architecture boundary test**

Run: `node --test tests/chat-thread-boundaries.test.mjs`

Expected: zero failures.

- [ ] **Step 3: Run lint**

Run: `yarn lint`

Expected: exit 0 with zero ESLint errors.

- [ ] **Step 4: Run production build**

Run: `yarn build`

Expected: exit 0 and successful Next.js production compilation.

- [ ] **Step 5: Inspect final diff and unrelated workspace state**

Run: `git status --short`

Run: `git diff --check`

Expected: no whitespace errors; pre-existing staged document moves and `next-env.d.ts` edit remain untouched.

- [ ] **Step 6: Inspect Threadroot score**

Run: `threadroot score latest --json`

Expected: report recorded preflight score; use only evidence-backed feedback.
