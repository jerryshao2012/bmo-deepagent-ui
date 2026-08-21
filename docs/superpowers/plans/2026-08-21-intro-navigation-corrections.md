# Intro Presentation Navigation Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated horizontal navigation, single-press vertical navigation, and fullscreen return alignment deterministic while preserving tall-slide reading and Markdown-dialog suspension.

**Architecture:** Keep pure fit/boundary decisions in `presentation-navigation.ts`, and DOM scrolling/event scheduling in `use-intro-presentation.ts`. Ordinary navigation and fullscreen realignment share one fit-aware alignment helper; fullscreen events coalesce into one two-frame job and never touch history.

**Tech Stack:** React 19 hook, TypeScript, DOM Fullscreen/scroll APIs, Node test runner, Testing Library/JSDOM.

---

### Task 1: Fit-aware slide boundaries and ordinary navigation

**Files:**
- Modify: `src/app/intro/presentation-navigation.ts:49-67`
- Modify: `src/app/intro/use-intro-presentation.ts:78-267`
- Test: `tests/intro-presentation-navigation.test.ts:48-87`
- Test: `tests/use-intro-presentation.test.tsx:490-721`

- [ ] **Step 1: Write failing pure-boundary tests**

Add cases proving a slide at `top: 64, bottom: 864, viewportHeight: 800` fits and may leave forward, and a fitting `top: 0, bottom: 800` slide may leave backward. Exercise the tall forward threshold directly with `top: -10, bottom: 866` returning true and `top: -10, bottom: 867` returning false for viewport `800`, header `64`, epsilon `2`.

Update conflicting legacy fixtures so they remain genuinely tall under the new fit rule: replace the backward cases using `bottom: 700/800` with `bottom: 900`, preserving their intended `top: 70` pass and `top: 69` fail around the header boundary.

- [ ] **Step 2: Write failing controller regressions**

Add a test that sets preview to overflowing geometry, presses Right twice, and expects hero → preview → Phase 1. Before pressing Left, set Phase 1 to genuinely tall geometry away from its backward boundary; expect preview anyway. Add a test that gives hero bounds `64..864`, presses Down once, and expects preview. Assert fitting targets scroll with `{ behavior: "smooth", block: "center" }`, tall targets use `block: "start"`, and reduced motion keeps `behavior: "auto"`.

- [ ] **Step 3: Run tests and verify RED**

Run: `node --import tsx --test --test-isolation=none tests/intro-presentation-navigation.test.ts tests/use-intro-presentation.test.tsx`

Expected: failures show fixed-header fitting slide rejected, second Right rejected by overflow geometry, and fitting destinations using `block: "start"`.

- [ ] **Step 4: Implement minimal fit/boundary behavior**

In `presentation-navigation.ts`, return true in either direction when `bottom - top <= viewportHeight + epsilon`. For taller slides, use forward boundary `bottom <= viewportHeight + headerOffset + epsilon` and backward boundary `top >= headerOffset - epsilon`.

In `use-intro-presentation.ts`, add a helper that calls `scrollIntoView` with `block: "center"` for a fitting rect and `block: "start"` for a taller rect. Use it from `navigateToSlide`. Pass `HEADER_OFFSET` for both directions. Handle Left/Right before the reading-aware key branch: prevent default and call `navigateAdjacent` directly. Keep modifiers, editable/interactive targets, suspension, Home/End, and endpoint behavior unchanged.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Task 1 command again. Expected: all navigation/controller tests pass.

- [ ] **Step 6: Commit Task 1**

Stage the two production files and two tests. Commit: `fix: make slide keys deterministic`.

### Task 2: Fullscreen viewport-settlement alignment

**Files:**
- Modify: `src/app/intro/use-intro-presentation.ts:327-400`
- Test: `tests/use-intro-presentation.test.tsx:845-974`

- [ ] **Step 1: Write failing fullscreen alignment tests**

Dispatch `fullscreenchange`, flush one frame and assert no new scroll, then change the active slide, its bounds, and `window.innerHeight` before the second frame. Flush again and assert the callback uses those current values, aligning with `{ behavior: "auto", block: "center" }` when fitting and `block: "start"` when tall. Assert no history/hash mutation.

Add prefixed/duplicate coverage in both timing windows: standard then WebKit events before the first frame cancel the pending outer frame; dispatch WebKit after the standard outer frame runs and assert the pending inner frame is cancelled. In both cases only the replacement job aligns. Add separate cleanup cases for unmount with an outer frame pending and with an inner frame pending.

- [ ] **Step 2: Run test and verify RED**

Run: `node --import tsx --test --test-isolation=none tests/use-intro-presentation.test.tsx`

Expected: no fullscreen-triggered alignment or settle/coalescing frames exist.

- [ ] **Step 3: Implement two-frame coalesced alignment**

Inside the effect, track outer and inner fullscreen frame IDs. Each fullscreen event synchronizes state, cancels pending alignment, then schedules two nested animation frames. The second reads `activeSlideIdRef.current`, resolves its element, and uses the shared alignment helper with `behavior: "auto"`. Do not navigate, activate, or touch history. Cancel pending frames during cleanup.

- [ ] **Step 4: Run test and verify GREEN**

Run the Task 2 command again. Expected: all hook tests pass.

- [ ] **Step 5: Commit Task 2**

Stage hook and test. Commit: `fix: realign slides after fullscreen`.

### Task 3: Regression and browser verification

**Files:**
- Modify only if verification exposes a reproduced defect.

- [ ] **Step 1: Run the full presentation and Markdown regressions**

Run:

`node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs`

`node --import tsx --test --test-isolation=none tests/intro-phase-navigation.test.ts tests/intro-presentation-navigation.test.ts tests/use-intro-presentation.test.tsx tests/intro-presentation-chrome.test.tsx`

`node --test tests/markdown-preview-sync.test.mjs`

`node --import tsx --test --test-isolation=none tests/markdown-preview-focus-restoration.test.ts tests/markdown-preview-activity.test.ts tests/markdown-connection-lifecycle.test.ts tests/markdown-pending-edit-coordinator.test.ts tests/markdown-sync-state.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Run static verification**

Run: `yarn lint` and `yarn build`.

Expected: both exit 0.

- [ ] **Step 3: Browser-check on canonical origin**

Run `yarn dev`, then at `http://localhost:3000/?thread_id=256905` verify repeated Right/Left, one-press Down centering, tall-slide native reading, fullscreen enter/exit alignment, dialog input suspension, and synchronized hash/count/progress/dot state.

- [ ] **Step 4: Inspect optimizer and repository state**

Run: `threadroot score latest --json`, `git diff --check`, and `git status --short`.

Expected: repository clean; report if recorded run has no optimizer score.
