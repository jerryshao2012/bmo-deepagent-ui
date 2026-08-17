# Task List Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore persisted root task lists after reload while keeping live run tasks authoritative and collapsing metadata only when thread changes.

**Architecture:** Decouple todo source selection from message-count reconciliation through pure selectors used by `useChat`. Scope snapshots by thread, reject out-of-order same-thread responses, and require post-run idle confirmation before persisted todos replace final live todos. Keep persisted nested history disabled, preserve live subgraph streaming, and add a thread-ID-scoped panel reset in `ChatInterface` without reacting to run loading changes.

**Tech Stack:** TypeScript, React 19, Next.js 16, LangGraph SDK, Node test runner, Testing Library, ESLint, Prettier

---

## File Structure

- Create `src/app/hooks/chat-state-selection.ts`: pure todo-source, ownership, ordering, and run-freshness policies with no React or SDK side effects.
- Create `tests/chat-state-selection.test.ts`: direct tests for idle hydration, live-run precedence, no-snapshot fallback, thread ownership, out-of-order responses, and post-run freshness.
- Modify `src/app/hooks/useChat.ts`: use the todo selector independently from message reconciliation.
- Modify `src/app/components/ChatInterface.tsx`: close metadata panel on thread ID changes only.
- Modify `tests/chat-interface-document-state.test.tsx`: verify task panel closes on thread switch while task data remains available.

### Task 1: Restore Persisted Root Todos While Idle

**Files:**

- Create: `tests/chat-state-selection.test.ts`
- Create: `src/app/hooks/chat-state-selection.ts`
- Modify: `src/app/hooks/useChat.ts:516-528`

- [ ] **Step 1: Write the selector tests before creating the module**

Create `tests/chat-state-selection.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import type { TodoItem } from "../src/app/types/types";

type SelectEffectiveTodos = (input: {
  isLoading: boolean;
  streamTodos?: TodoItem[];
  serverTodos?: TodoItem[];
}) => TodoItem[];

async function loadSelector(): Promise<SelectEffectiveTodos | undefined> {
  try {
    const module = await import("../src/app/hooks/chat-state-selection");
    return module.selectEffectiveTodos;
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

const persistedTodo = {
  id: "persisted-task",
  content: "Write final report",
  status: "completed",
} satisfies TodoItem;

test("idle chat prefers confirmed server todos even when stream todos are empty", async () => {
  const selectEffectiveTodos = await loadSelector();
  assert.equal(typeof selectEffectiveTodos, "function");

  assert.deepEqual(
    selectEffectiveTodos!({
      isLoading: false,
      streamTodos: [],
      serverTodos: [persistedTodo],
    }),
    [persistedTodo]
  );
});

test("active run keeps intentionally empty live todos authoritative", async () => {
  const selectEffectiveTodos = await loadSelector();
  assert.equal(typeof selectEffectiveTodos, "function");

  assert.deepEqual(
    selectEffectiveTodos!({
      isLoading: true,
      streamTodos: [],
      serverTodos: [persistedTodo],
    }),
    []
  );
});

test("idle chat falls back to stream todos before a snapshot exists", async () => {
  const selectEffectiveTodos = await loadSelector();
  assert.equal(typeof selectEffectiveTodos, "function");

  assert.deepEqual(
    selectEffectiveTodos!({
      isLoading: false,
      streamTodos: [persistedTodo],
      serverTodos: undefined,
    }),
    [persistedTodo]
  );
});
```

- [ ] **Step 2: Run selector tests and verify RED**

Run:

```bash
yarn node --import tsx --test tests/chat-state-selection.test.ts
```

Expected: three assertion failures because `selectEffectiveTodos` is undefined;
the missing module is converted into the intended assertion failure.

- [ ] **Step 3: Add the pure selector**

Create `src/app/hooks/chat-state-selection.ts`:

```typescript
import type { TodoItem } from "@/app/types/types";

export function selectEffectiveTodos({
  isLoading,
  streamTodos,
  serverTodos,
}: {
  isLoading: boolean;
  streamTodos?: TodoItem[];
  serverTodos?: TodoItem[];
}): TodoItem[] {
  if (isLoading || serverTodos === undefined) {
    return streamTodos ?? [];
  }

  return serverTodos;
}
```

- [ ] **Step 4: Wire selector into `useChat`**

Add import:

```typescript
import { selectEffectiveTodos } from "./chat-state-selection";
```

Replace message-coupled todo selection. Before passing persisted todos to this
selector, require matching thread ownership, matching run generation, and a
snapshot request that started while idle. Reject older same-thread snapshot
responses before updating stored snapshot state:

```typescript
const effectiveTodos = selectEffectiveTodos({
  isLoading: stream.isLoading,
  streamTodos: stream.values.todos,
  serverTodos: selectServerTodosForThread({
    currentThreadId: threadId,
    serverThreadId: serverSnapshot?.threadId,
    serverTodos: selectFreshServerTodosForRun({
      currentRunGeneration: runGenerationRef.current,
      serverSnapshotRunGeneration: serverSnapshot?.runGeneration,
      requestStartedIdle: serverSnapshot?.requestStartedIdle,
      serverTodos: serverSnapshot?.todos,
    }),
  }),
});
```

Leave `shouldPreferServerSnapshot`, `effectiveMessages`, other state fields,
`CHAT_STREAM_OPTIONS`, polling cadence/error handling, and stream submission
behavior unchanged.

- [ ] **Step 5: Run selector tests and verify GREEN**

Run:

```bash
yarn node --import tsx --test tests/chat-state-selection.test.ts
```

Expected: selector policy tests pass, including ownership, stale-response, and
post-run freshness cases.

- [ ] **Step 6: Confirm nested-history policy remains intact**

Run both policy tests:

```bash
yarn node --import tsx --test tests/use-chat-stream-options.test.ts
yarn node --import tsx --test tests/use-agent-chat-run-executor.test.ts
```

Expected: pass with `fetchStateHistory: false`,
`filterSubagentMessages: true`, and executor submission retaining
`streamSubgraphs: true` for live nested events.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/app/hooks/chat-state-selection.ts src/app/hooks/useChat.ts tests/chat-state-selection.test.ts
git commit -m "fix: restore persisted root tasks"
```

### Task 2: Collapse Metadata on Thread Switch Only

**Files:**

- Modify: `tests/chat-interface-document-state.test.tsx`
- Modify: `src/app/components/ChatInterface.tsx:98-106`

- [ ] **Step 1: Extend the test harness with a same-thread loading toggle**

Add `canToggleLoading = false` to `Harness` and `renderChat` options. Inside
`Harness`, derive the provider value without changing the query-state thread:

```typescript
const [isLoading, setIsLoading] = React.useState(false);
const providedChat = canToggleLoading
  ? ({ ...(chat as object), isLoading } as never)
  : chat;
```

Use `providedChat` as `ChatContext.Provider` value and render this control next
to existing thread-switch controls when enabled:

```tsx
{
  canToggleLoading && (
    <button
      type="button"
      onClick={() => setIsLoading((value) => !value)}
    >
      Toggle loading
    </button>
  );
}
```

- [ ] **Step 2: Add thread-switch and same-thread regression tests**

Append tests using existing `configure`, `installFetch`, `renderChat`,
`makeClient`, and `baseChat` helpers:

```typescript
test("tasks panel collapses when switching threads", async () => {
  configure();
  const restoreFetch = installFetch({ uploadFolders: [] });
  const chat = {
    ...baseChat(() => {}),
    todos: [
      {
        id: "task-1",
        content: "Restored task",
        status: "pending",
      },
    ],
  } as never;

  try {
    renderChat({
      client: makeClient([]),
      chat,
      canSwitch: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /Task 0 of 1/ }));
    assert.equal(
      screen
        .getByRole("button", { name: "Tasks" })
        .getAttribute("aria-expanded"),
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));

    await waitFor(() =>
      assert.equal(screen.queryByRole("button", { name: "Tasks" }), null)
    );
    assert.equal(
      screen
        .getByRole("button", { name: /Task 0 of 1/ })
        .getAttribute("aria-expanded"),
      "false"
    );
  } finally {
    restoreFetch();
  }
});

test("same-thread loading changes keep an open tasks panel", async () => {
  configure();
  const restoreFetch = installFetch({ uploadFolders: [] });
  const chat = {
    ...baseChat(() => {}),
    todos: [
      {
        id: "task-1",
        content: "Live task",
        status: "in_progress",
      },
    ],
  } as never;

  try {
    renderChat({
      client: makeClient([]),
      chat,
      canToggleLoading: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /Task 1 of 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle loading" }));

    await waitFor(() =>
      assert.equal(
        screen
          .getByRole("button", { name: "Tasks" })
          .getAttribute("aria-expanded"),
        "true"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle loading" }));

    await waitFor(() =>
      assert.equal(
        screen
          .getByRole("button", { name: "Tasks" })
          .getAttribute("aria-expanded"),
        "true"
      )
    );
  } finally {
    restoreFetch();
  }
});
```

The same task remains in context after switching, proving collapse does not erase
task data. The loading-toggle test covers both run start (`false` to `true`) and
run finish (`true` to `false`) and proves neither closes an open panel.

- [ ] **Step 3: Run component test and verify RED**

Run:

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/chat-interface-document-state.test.tsx
```

Expected: thread-switch test fails because the exact `Tasks` tab remains rendered
and expanded after switching to thread B; same-thread loading test passes.

- [ ] **Step 4: Reset panel only when thread ID changes**

After `metaOpen` state initialization in `ChatInterface`, add:

```typescript
useEffect(() => {
  setMetaOpen(null);
}, [currentThreadId]);
```

Do not add `isLoading`, `todos`, message count, or run state dependencies. This
preserves the user's panel choice throughout runs in the same thread.

- [ ] **Step 5: Run component test and verify GREEN**

Run:

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/chat-interface-document-state.test.tsx
```

Expected: all tests pass, including thread-switch collapse.

- [ ] **Step 6: Run existing task layout test**

Run:

```bash
yarn node --test tests/task-list-layout.test.mjs
```

Expected: pass; expanded task layout remains unchanged.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/app/components/ChatInterface.tsx tests/chat-interface-document-state.test.tsx
git commit -m "fix: collapse task panel on thread switch"
```

### Task 3: Final Frontend Verification

**Files:**

- Verify: `src/app/hooks/chat-state-selection.ts`
- Verify: `src/app/hooks/useChat.ts`
- Verify: `src/app/components/ChatInterface.tsx`
- Verify: `tests/chat-state-selection.test.ts`
- Verify: `tests/chat-interface-document-state.test.tsx`

- [ ] **Step 1: Run focused regression suite**

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/chat-state-selection.test.ts \
  tests/chat-interface-document-state.test.tsx \
  tests/use-chat-stream-options.test.ts \
  tests/use-agent-chat-run-executor.test.ts \
  tests/task-list-layout.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run lint and formatting checks**

```bash
yarn eslint \
  src/app/hooks/chat-state-selection.ts \
  src/app/hooks/useChat.ts \
  src/app/components/ChatInterface.tsx \
  tests/chat-state-selection.test.ts \
  tests/chat-interface-document-state.test.tsx
yarn prettier --check \
  src/app/hooks/chat-state-selection.ts \
  src/app/hooks/useChat.ts \
  src/app/components/ChatInterface.tsx \
  tests/chat-state-selection.test.ts \
  tests/chat-interface-document-state.test.tsx
```

Expected: no ESLint or Prettier findings.

- [ ] **Step 3: Run production build**

```bash
yarn build
```

Expected: Next.js build completes successfully.

- [ ] **Step 4: Inspect final scope**

```bash
git status --short
git diff main...HEAD --stat
git diff main...HEAD --check
git log --oneline main..HEAD
```

Expected: only approved spec, plan, selector, hook/component changes, and focused
tests. Worktree clean; diff check clean.

- [ ] **Step 5: Inspect Threadroot score**

```bash
threadroot score latest --json
```

Record score evidence when available; absence of a score does not replace test,
lint, format, or build verification.
