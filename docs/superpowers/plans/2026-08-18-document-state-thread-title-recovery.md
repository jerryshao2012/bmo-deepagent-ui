# Document State and Thread Title Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ambiguous passive LangGraph state writes while preserving document context at send time, and recover useful titles for completed threads from checkpoint state.

**Architecture:** Treat document availability as thread-owned local evidence plus
a per-thread unsent-positive map; only run submission writes document fields
into graph input. Every availability event carries its owning thread ID so a
stale render during navigation cannot mutate another thread's evidence. Make
thread search request state values explicitly and use `getState` only for
nonbusy threads missing both manual and message-derived titles, with a stable
ID fallback on every result page.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16, `@langchain/langgraph-sdk` 1.9, Node test runner, Testing Library, ESLint, Prettier.

---

## File map

- Modify `src/app/hooks/useThreadDocumentAvailability.ts`: thread-owned local availability only; remove graph-state persistence queue/status coupling.
- Modify `src/app/components/ChatInterface.tsx`: per-thread positive-evidence map; remove document `updateState` call.
- Modify `src/app/utils/submit-research-message.ts`: exact four-row document payload contract, including false/null clearing.
- Modify `src/features/threads/infrastructure/langgraph-thread-repository.ts`: explicit values selection, checkpoint fallback, and stable title.
- Rewrite focused expectations in `tests/thread-document-availability.test.tsx`, `tests/chat-interface-document-state.test.tsx`, and `tests/submit-research-message.test.ts`.
- Create `tests/langgraph-thread-repository.test.ts`: repository title behavior with injected fake client.

### Task 1: Make run submission the document-state boundary

**Files:**

- Modify: `tests/submit-research-message.test.ts`
- Modify: `src/app/utils/submit-research-message.ts:19-40`

- [ ] **Step 1: Add/adjust failing four-row payload tests**

Assert exact calls:

```ts
const cases = [
  {
    availability: true,
    threadId: "thread-a",
    expected: {
      no_web: false,
      has_documents: true,
      doc_folder: "docs/threads/thread-a",
    },
  },
  {
    availability: false,
    threadId: "thread-a",
    expected: { no_web: false, has_documents: false, doc_folder: null },
  },
  {
    availability: null,
    threadId: "thread-a",
    pendingDocument: {
      threadId: "thread-a",
      docFolder: "docs/threads/thread-a",
    },
    expected: {
      no_web: false,
      has_documents: true,
      doc_folder: "docs/threads/thread-a",
    },
  },
  {
    availability: null,
    threadId: "thread-a",
    expected: { no_web: false },
  },
];
```

Retain cross-thread pending and confirmed-false-overrides-pending tests.

- [ ] **Step 2: Run test and verify RED**

```bash
yarn node --import tsx --test tests/submit-research-message.test.ts
```

Expected: confirmed-false case fails because `doc_folder: null` is missing.

- [ ] **Step 3: Implement minimal false/null clearing**

```ts
if (availability === false) {
  stateUpdates.has_documents = false;
  stateUpdates.doc_folder = null;
} else if (availability === true && threadId) {
  stateUpdates.has_documents = true;
  stateUpdates.doc_folder = `docs/threads/${threadId}`;
} else if (pendingDocument?.threadId === threadId) {
  stateUpdates.has_documents = true;
  stateUpdates.doc_folder = pendingDocument.docFolder;
}
```

Unknown without matching pending leaves both fields absent.

- [ ] **Step 4: Run test and verify GREEN**

```bash
yarn node --import tsx --test tests/submit-research-message.test.ts
```

Expected: all submit helper tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/app/utils/submit-research-message.ts \
  tests/submit-research-message.test.ts
git commit -m "fix: clear stale document folder on submit"
```

### Task 2: Remove passive document `updateState` writes without breaking callers

**Files:**

- Modify: `tests/thread-document-availability.test.tsx`
- Modify: `tests/chat-interface-document-state.test.tsx`
- Modify: `src/app/hooks/useThreadDocumentAvailability.ts:14-405`
- Modify: `src/app/components/ChatInterface.tsx:130-177`

- [ ] **Step 1: Replace persistence expectations with local-state regressions**

Keep tests for 404, empty/nonempty list, network/server/malformed responses,
upload, cumulative deletion, stale same/cross-thread responses, navigation,
unmount, and StrictMode. Remove tests whose only behavior is queue ordering,
busy deferral, or 409 retry. Since `updateThreadState` is removed from the hook
API, do not retain an impossible hook-level persistence spy. Instead, add a
ChatInterface boundary assertion with a fake LangGraph client and prove
`client.threads.updateState` receives zero calls through refresh, upload, and
delete flows.

Add explicit API expectations:

```ts
assert.equal(result.current.availability, true);
assert.deepEqual(result.current.availabilityEvidence, {
  threadId: "thread-a",
  available: true,
});
assert.deepEqual(result.current.documents, uploadedDocuments);
```

- [ ] **Step 2: Run focused hook test and verify RED**

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/thread-document-availability.test.tsx \
  tests/chat-interface-document-state.test.tsx
```

Expected: hook expectations fail because current hook still invokes
`updateThreadState`, and the component boundary observes at least one forbidden
`client.threads.updateState` call.

- [ ] **Step 3: Simplify hook to local evidence only**

Remove from options and implementation:

- `selectedThreadStatus`
- `selectedThreadStatusIsValidating`
- `updateThreadState`
- persistence tails/pending maps
- busy/409 classification and retry effects
- persistence success booleans

`refreshThread`, `recordUploadSuccess`, and `recordDeleteSuccess` update only
epoch-protected local documents/availability. Keep current race guards and
exact thread ownership. Return both display state and a tagged signal:

```ts
interface ThreadDocumentAvailabilityEvidence {
  threadId: string;
  available: boolean;
}
```

`availabilityEvidence` changes only when evidence for its named thread is
confirmed. It may remain tagged A for the render before a thread-switch effect
resets display state; consumers must compare the owner before applying it.
Return `Promise<void>` from upload. Preserve delete's caller-needed
`{ hasDocuments: boolean | null }` result while removing only its `persisted`
field.

- [ ] **Step 4: Remove ChatInterface state-write adapter**

Delete `useThreadStatus` use that exists solely for persistence, delete
`updateThreadDocumentState`, and stop passing removed hook options. Update all
current consumers in the same task so the tree remains type-correct:

- after upload, await `recordUploadSuccess` and unconditionally store the
  thread-owned folder in the existing pending ref;
- after delete, consume only `deleteResult.hasDocuments`;
- never branch on a persistence boolean.

Do not add `asNode`.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/thread-document-availability.test.tsx \
  tests/chat-interface-document-state.test.tsx
yarn build
```

Expected: local-state/race and component suites pass, fake client observes zero
graph writes, and production TypeScript compilation succeeds before commit.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/app/hooks/useThreadDocumentAvailability.ts \
  src/app/components/ChatInterface.tsx \
  tests/thread-document-availability.test.tsx \
  tests/chat-interface-document-state.test.tsx
git commit -m "fix: keep document availability out of graph checkpoints"
```

### Task 3: Preserve thread-owned unsent positive evidence across navigation

**Files:**

- Modify: `tests/chat-interface-document-state.test.tsx`
- Modify: `src/app/components/ChatInterface.tsx:338-350,640-681,890-915`

- [ ] **Step 1: Add failing navigation and multi-thread regressions**

Cover these exact sequences:

1. upload on A -> nonempty refresh -> navigate B -> navigate A -> refresh fails
   -> submit A includes `has_documents: true` and `docs/threads/A`;
2. upload on A -> upload on B -> submit each thread uses only its own folder;
3. confirmed empty/delete-to-empty removes only that thread's entry;
4. accepted positive submit clears only that thread's entry.
5. confirmed positive A -> navigate B -> B refresh remains pending/fails ->
   submit B omits both document fields (A evidence cannot leak into B);
6. confirmed empty A -> navigate B with unsent positive evidence -> the stale A
   render/effect cannot clear B, and B submit still carries B's folder.

Assert no `client.threads.updateState` call occurs anywhere in these sequences.

- [ ] **Step 2: Run tests and verify RED**

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/chat-interface-document-state.test.tsx
```

Expected: new navigation/multi-thread tests fail because current code stores one
conditional pending ref and depends on persistence outcome.

- [ ] **Step 3: Implement per-thread map**

Replace `pendingDocFolderRef` with:

```ts
const pendingDocFoldersRef = useRef(new Map<string, string>());
```

Rules:

- successful upload: `set(activeThreadId, docFolder)` unconditionally;
- confirmed `availabilityEvidence.available === true`: set the canonical folder
  for `availabilityEvidence.threadId` only when that owner equals the active
  thread at the consumer boundary;
- confirmed false: delete only the evidence owner's entry, again only after
  owner/active-thread match;
- unknown: leave map unchanged;
- submit: pass current entry as `pendingDocument`; after accepted positive send,
  delete current entry only;
- navigation: no clearing and no cross-thread lookup.

Update comments to describe unsent positive evidence, not failed persistence.

- [ ] **Step 4: Run component and submit tests and verify GREEN**

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/chat-interface-document-state.test.tsx \
  tests/submit-research-message.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/app/components/ChatInterface.tsx \
  tests/chat-interface-document-state.test.tsx
git commit -m "fix: retain thread-owned document evidence"
```

### Task 4: Recover titles from checkpoint state

**Files:**

- Create: `tests/langgraph-thread-repository.test.ts`
- Modify: `src/features/threads/infrastructure/langgraph-thread-repository.ts:11-109`

- [ ] **Step 1: Add failing repository tests with an injected fake client**

Cover:

- search options select `thread_id`, `created_at`, `updated_at`, `status`,
  `metadata`, and `values`;
- selected values already contain first human -> no `getState` call;
- later page (`pageIndex: 1`) missing both custom and human title -> `getState`
  is required and its first human message becomes the recovered title;
- custom title -> no `getState` call and manual title wins;
- idle/interrupted/error without both title sources -> `getState` supplies first
  human title;
- busy without title -> no `getState`, stable `Thread <id-prefix>`;
- fallback lookup failure/no human -> stable ID title;
- array content block and string content keep existing truncation behavior.

Inject a structurally typed fake client through an optional constructor
parameter rather than patching SDK internals. Define a narrow internal client
interface covering only `threads.search`, `threads.getState`, `threads.get`,
`threads.delete`, and `threads.update`; do not require tests to emulate the SDK
`Client` class.

- [ ] **Step 2: Run test and verify RED**

```bash
yarn node --import tsx --test tests/langgraph-thread-repository.test.ts
```

Expected: compile/test fails because constructor injection and fallback do not
exist and search does not request `values` explicitly.

- [ ] **Step 3: Add client injection and preview signal**

Extend the internal preview result with `hasHumanTitle`. Add optional narrow
client injection while preserving production construction:

```ts
constructor(
  private readonly options: LangGraphThreadRepositoryOptions,
  client?: LangGraphThreadClient
) {
  this.client =
    client ??
    new Client(createLangGraphClientConfig({
      deploymentUrl: options.deploymentUrl,
      apiKey: options.apiKey,
    }));
}
```

`extractThreadPreview` must distinguish custom title, human title, and fallback.
Use `Thread ${thread.thread_id.slice(0, 8)}` when neither source exists.

- [ ] **Step 4: Request values and add bounded fallback lookup**

Add the exact `select` list to `threads.search`. Remove the existing
`pageIndex > 0` early return so the same bounded fallback policy applies on
every page. Before producing `ThreadItem`, call `getState` only when:

```ts
thread.status !== "busy" &&
  !preview.isUserDefinedTitle &&
  !preview.hasHumanTitle;
```

Merge only `state.values` into the candidate thread and recompute preview. Catch
lookup failure and keep stable ID fallback. Do not call `threads.get`.

- [ ] **Step 5: Run repository test and verify GREEN**

```bash
yarn node --import tsx --test tests/langgraph-thread-repository.test.ts
```

Expected: all repository tests pass.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/features/threads/infrastructure/langgraph-thread-repository.ts \
  tests/langgraph-thread-repository.test.ts
git commit -m "fix: recover completed thread titles from state"
```

### Task 5: Verify frontend integration

**Files:**

- Verify all frontend files changed in Tasks 1-4.

- [ ] **Step 1: Run complete focused suite**

```bash
yarn node --import tsx --test --test-isolation=none \
  tests/thread-document-availability.test.tsx \
  tests/submit-research-message.test.ts \
  tests/chat-interface-document-state.test.tsx \
  tests/langgraph-thread-repository.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run lint and formatting checks**

```bash
yarn lint
yarn format:check
```

Expected: both commands exit 0. If repository-wide pre-existing findings occur,
prove changed-file checks separately and report baseline-equivalent failures.

- [ ] **Step 3: Run production build**

```bash
yarn build
```

Expected: Next.js compilation, TypeScript checking, and static generation exit 0.

- [ ] **Step 4: Inspect final scope**

```bash
git diff --check main...HEAD
git status --short
git diff --stat main...HEAD
```

Expected: diff check exits 0; worktree clean; only planned frontend files and
this plan are changed.

- [ ] **Step 5: Record code-area memory**

Record the document availability hook/submit boundary and thread repository
title fallback for future sessions.
