# Task List Vertical Centering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visually center the expanded Tasks list with equal outer vertical spacing while leaving other metadata panels unchanged.

**Architecture:** Keep existing shared metadata content wrapper and conditionally add task-only vertical padding. Preserve inter-group spacing while removing final group's trailing margin.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 3, Node.js test runner

---

### Task 1: Center Expanded Task List

**Files:**
- Create: `tests/task-list-layout.test.mjs`
- Modify: `src/app/components/ChatInterface.tsx:1555-1585`

- [ ] **Step 1: Write failing source-level regression test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/app/components/ChatInterface.tsx", import.meta.url),
  "utf8"
);

test("centers expanded task list without changing other metadata panels", () => {
  assert.match(
    source,
    /className=\{cn\(\s*"px-\[18px\]",\s*metaOpen === "tasks" && "py-2"\s*\)\}/
  );
  assert.match(source, /className="mb-4 last:mb-0"/);
});
```

- [ ] **Step 2: Run test and verify expected failure**

Run: `node --test tests/task-list-layout.test.mjs`

Expected: FAIL because `ChatInterface` has unconditional `className="px-[18px]"` and final task group still has `mb-4`.

- [ ] **Step 3: Implement minimal task-only spacing change**

Change shared content wrapper:

```tsx
<div
  ref={tasksContainerRef}
  className={cn(
    "px-[18px]",
    metaOpen === "tasks" && "py-2"
  )}
>
```

Change visible status group:

```tsx
<div
  key={status}
  className="mb-4 last:mb-0"
>
```

- [ ] **Step 4: Run focused regression test**

Run: `node --test tests/task-list-layout.test.mjs`

Expected: PASS, 1 test and 0 failures.

- [ ] **Step 5: Run repository verification**

Run: `yarn lint`

Expected: exit code 0 with no ESLint errors.

- [ ] **Step 6: Inspect final diff and commit scoped files**

Run: `git diff --check && git diff -- src/app/components/ChatInterface.tsx tests/task-list-layout.test.mjs docs/superpowers/plans/2026-08-16-task-list-vertical-centering.md`

Then:

```bash
git add src/app/components/ChatInterface.tsx tests/task-list-layout.test.mjs docs/superpowers/plans/2026-08-16-task-list-vertical-centering.md
git commit -m "fix: center expanded task list"
```
