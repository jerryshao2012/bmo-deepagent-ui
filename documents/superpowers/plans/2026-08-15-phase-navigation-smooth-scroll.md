# Phase Navigation Smooth Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three intro-page phase links glide vertically to their anchored sections while preserving native link behavior and reduced-motion accessibility.

**Architecture:** Put phase-navigation policy in one small, dependency-injected TypeScript function so behavior can be tested without rendering the large intro page. Keep `src/app/intro/page.tsx` responsible only for adapting React anchor events and wiring the existing links; existing `IntersectionObserver`, hashes, scroll progress, layout, and content remain unchanged.

**Tech Stack:** React 19, TypeScript, Next.js App Router, browser `scrollIntoView`, Node test runner with `tsx`

---

## File structure

- Create `src/app/intro/phase-navigation.ts`: phase identifiers, navigation event/environment interfaces, browser adapter, and scoped navigation policy.
- Create `tests/intro-phase-navigation.test.ts`: direct behavioral tests for scrolling, reduced motion, history, modifiers, and missing targets.
- Modify `src/app/intro/page.tsx`: import the policy, add one React event adapter, and wire the three existing anchors.
- Modify `tests/intro-scroll-story.test.mjs`: verify semantic hashes and page wiring remain present without global scrolling or history interception.

### Task 1: Build the tested phase-navigation policy

**Files:**

- Create: `src/app/intro/phase-navigation.ts`
- Create: `tests/intro-phase-navigation.test.ts`

Use @superpowers:test-driven-development for the red-green cycle.

- [ ] **Step 1: Write failing behavioral tests**

Create `tests/intro-phase-navigation.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  navigateToIntroPhase,
  type PhaseNavigationEnvironment,
  type PhaseNavigationEvent,
} from "../src/app/intro/phase-navigation";

function createHarness({
  currentHash = "",
  hasTarget = true,
  reducedMotion = false,
}: {
  currentHash?: string;
  hasTarget?: boolean;
  reducedMotion?: boolean;
} = {}) {
  let prevented = false;
  const pushedHashes: string[] = [];
  const scrollCalls: ScrollIntoViewOptions[] = [];
  const event: PhaseNavigationEvent = {
    altKey: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  };
  const environment: PhaseNavigationEnvironment = {
    currentHash: () => currentHash,
    findTarget: () =>
      hasTarget
        ? {
            scrollIntoView: (options) => {
              scrollCalls.push(options);
            },
          }
        : null,
    prefersReducedMotion: () => reducedMotion,
    pushHash: (hash) => {
      pushedHashes.push(hash);
    },
  };

  return {
    environment,
    event,
    prevented: () => prevented,
    pushedHashes,
    scrollCalls,
  };
}

test("smoothly navigates an ordinary phase activation", () => {
  const harness = createHarness({ currentHash: "#phase1" });

  const handled = navigateToIntroPhase(
    harness.event,
    "phase2",
    harness.environment
  );

  assert.equal(handled, true);
  assert.equal(harness.prevented(), true);
  assert.deepEqual(harness.pushedHashes, ["#phase2"]);
  assert.deepEqual(harness.scrollCalls, [
    { behavior: "smooth", block: "start" },
  ]);
});

test("uses immediate scrolling and avoids duplicate history for the current hash", () => {
  const harness = createHarness({
    currentHash: "#phase2",
    reducedMotion: true,
  });

  const handled = navigateToIntroPhase(
    harness.event,
    "phase2",
    harness.environment
  );

  assert.equal(handled, true);
  assert.equal(harness.prevented(), true);
  assert.deepEqual(harness.pushedHashes, []);
  assert.deepEqual(harness.scrollCalls, [{ behavior: "auto", block: "start" }]);
});

test("leaves modified and non-primary activations native", () => {
  for (const override of [
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { button: 1 },
  ]) {
    const harness = createHarness();
    const event = { ...harness.event, ...override };

    const handled = navigateToIntroPhase(event, "phase2", harness.environment);

    assert.equal(handled, false);
    assert.equal(harness.prevented(), false);
    assert.deepEqual(harness.pushedHashes, []);
    assert.deepEqual(harness.scrollCalls, []);
  }
});

test("leaves navigation native when the destination is unavailable", () => {
  const harness = createHarness({ hasTarget: false });

  const handled = navigateToIntroPhase(
    harness.event,
    "phase2",
    harness.environment
  );

  assert.equal(handled, false);
  assert.equal(harness.prevented(), false);
  assert.deepEqual(harness.pushedHashes, []);
  assert.deepEqual(harness.scrollCalls, []);
});
```

- [ ] **Step 2: Run the new tests to verify RED**

Run:

```bash
node --import tsx --test tests/intro-phase-navigation.test.ts
```

Expected: FAIL because `src/app/intro/phase-navigation.ts` does not exist.

- [ ] **Step 3: Implement the minimal navigation policy**

Create `src/app/intro/phase-navigation.ts`:

```ts
export type IntroPhaseId = "phase1" | "phase2" | "phase3";

export interface PhaseNavigationEvent {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
}

export interface PhaseNavigationTarget {
  scrollIntoView(options: ScrollIntoViewOptions): void;
}

export interface PhaseNavigationEnvironment {
  currentHash(): string;
  findTarget(id: IntroPhaseId): PhaseNavigationTarget | null;
  prefersReducedMotion(): boolean;
  pushHash(hash: string): void;
}

function createBrowserEnvironment(): PhaseNavigationEnvironment {
  return {
    currentHash: () => window.location.hash,
    findTarget: (id) => document.getElementById(id),
    prefersReducedMotion: () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    pushHash: (hash) => window.history.pushState(null, "", hash),
  };
}

export function navigateToIntroPhase(
  event: PhaseNavigationEvent,
  phaseId: IntroPhaseId,
  environment: PhaseNavigationEnvironment = createBrowserEnvironment()
): boolean {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  const target = environment.findTarget(phaseId);
  if (!target) return false;

  event.preventDefault();

  const hash = `#${phaseId}`;
  if (environment.currentHash() !== hash) {
    environment.pushHash(hash);
  }

  target.scrollIntoView({
    behavior: environment.prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  return true;
}
```

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run:

```bash
node --import tsx --test tests/intro-phase-navigation.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the policy and tests**

```bash
git add src/app/intro/phase-navigation.ts tests/intro-phase-navigation.test.ts
git commit -m "feat(intro): add phase navigation policy"
```

### Task 2: Wire the three semantic phase links

**Files:**

- Modify: `src/app/intro/page.tsx:22-45,1460-1485,1813-1839`
- Modify: `tests/intro-scroll-story.test.mjs:1-190`

- [ ] **Step 1: Add a failing page-wiring regression test**

Append to `tests/intro-scroll-story.test.mjs`:

```js
test("phase navigation keeps semantic anchors and uses scoped scrolling", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /import \{[\s\S]*navigateToIntroPhase[\s\S]*IntroPhaseId/
  );
  assert.match(
    source,
    /const handlePhaseNavigation = \([\s\S]*navigateToIntroPhase\(event, phaseId\)/
  );
  for (const phaseId of ["phase1", "phase2", "phase3"]) {
    assert.match(source, new RegExp(`href="#${phaseId}"`));
    assert.match(
      source,
      new RegExp(
        `onClick=\\{\\(event\\) => handlePhaseNavigation\\(event, "${phaseId}"\\)\\}`
      )
    );
  }
  assert.doesNotMatch(source, /scroll-behavior:\s*smooth/);
  assert.doesNotMatch(source, /addEventListener\("popstate"/);
});
```

- [ ] **Step 2: Run the intro tests to verify RED**

Run:

```bash
node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
```

Expected: one new assertion FAILS because page wiring is absent; existing intro tests remain green.

- [ ] **Step 3: Import the policy and add the React adapter**

In `src/app/intro/page.tsx`, import:

```ts
import { navigateToIntroPhase, type IntroPhaseId } from "./phase-navigation";
```

Near `activePhase`, add:

```ts
const handlePhaseNavigation = (
  event: React.MouseEvent<HTMLAnchorElement>,
  phaseId: IntroPhaseId
) => {
  navigateToIntroPhase(event, phaseId);
};
```

Do not add phase-transition state, a `popstate` listener, a global `scroll-behavior` rule, or changes to the existing observer.

- [ ] **Step 4: Wire all three existing anchors**

Keep each `href` unchanged and add:

```tsx
onClick={(event) => handlePhaseNavigation(event, "phase1")}
```

Use the corresponding phase id for Phase 2 and Phase 3. Do not change link text, classes, header layout, or section markup.

- [ ] **Step 5: Run all focused tests**

Run:

```bash
node --import tsx --test tests/intro-phase-navigation.test.ts
node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
```

Expected: 4 navigation-policy tests and all intro regression tests PASS.

- [ ] **Step 6: Run focused formatting and lint**

Run:

```bash
yarn prettier --check src/app/intro/phase-navigation.ts src/app/intro/page.tsx tests/intro-phase-navigation.test.ts tests/intro-scroll-story.test.mjs
yarn lint
```

Expected: both commands exit 0. Existing warnings from unrelated worktrees may remain, but no errors are allowed.

- [ ] **Step 7: Commit page wiring**

```bash
git add src/app/intro/page.tsx tests/intro-scroll-story.test.mjs
git commit -m "feat(intro): animate phase navigation"
```

### Task 3: Verify browser behavior and production build

**Files:**

- Verify: `src/app/intro/phase-navigation.ts`
- Verify: `src/app/intro/page.tsx`
- Verify: `tests/intro-phase-navigation.test.ts`
- Verify: `tests/intro-scroll-story.test.mjs`

Use @superpowers:verification-before-completion before reporting completion.

- [ ] **Step 1: Run the complete focused test set**

```bash
node --import tsx --test tests/intro-phase-navigation.test.ts
node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
```

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Start the local app and verify ordinary navigation**

Run `yarn dev`, open the intro page, and verify:

- Phase 1 → Phase 2 changes hash to `#phase2`, glides vertically, and aligns Phase 2 below the fixed header.
- Phase 2 → Phase 3 changes hash to `#phase3` with the same behavior.
- Phase 3 → Phase 1 changes hash to `#phase1` with the same behavior.
- Re-selecting the active phase realigns it without adding a duplicate browser-history entry.
- Keyboard activation behaves like pointer activation.
- A modifier-assisted click retains native anchor behavior.
- Browser Back and Forward restore prior same-document positions without a custom `popstate` transition.

- [ ] **Step 3: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce`, activate each phase link, and confirm the target aligns immediately while its hash still updates.

- [ ] **Step 4: Run project verification**

```bash
yarn lint
yarn build
git diff --check
```

Expected: lint exits with zero errors, build succeeds, and `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Request final code review**

Use @superpowers:requesting-code-review with the spec, this plan, and the full implementation commit range. Fix Critical and Important findings before integration.
