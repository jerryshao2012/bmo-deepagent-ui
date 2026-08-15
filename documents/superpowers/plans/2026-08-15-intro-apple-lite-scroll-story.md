# Intro Apple-Lite Scroll Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restrained, Apple-inspired sticky chapter motion to existing intro page without changing its content or visual system.

**Architecture:** Keep existing hero and three phase layouts. Add one CSS-first scroll-story layer: desktop phase wrappers pin their existing inner grids while a passive, requestAnimationFrame-throttled listener writes normalized progress to CSS custom properties. Mobile and reduced-motion modes fall back to normal document flow and fully visible content.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, component-scoped CSS, Node test runner.

---

### Task 1: Lock motion contract

**Files:**

- Create: `tests/intro-scroll-story.test.mjs`

- [x] Assert three phase wrappers expose scroll-story hooks.
- [x] Assert sticky scenes and staggered reveal hooks exist.
- [x] Assert reduced-motion and small-screen fallbacks exist.
- [x] Run test and verify it fails before implementation.

### Task 2: Add scroll progress and chapter scenes

**Files:**

- Modify: `src/app/intro/page.tsx`

- [x] Add requestAnimationFrame-throttled CSS-variable progress updates.
- [x] Preserve active phase navigation behavior.
- [x] Wrap each existing phase grid in a desktop-only sticky chapter.
- [x] Add restrained copy, visual, graph-path, and comparison-row reveals.
- [x] Keep existing copy and component styling unchanged.

### Task 3: Verify behavior

**Files:**

- Test: `tests/intro-scroll-story.test.mjs`
- Test: `tests/intro-content.test.mjs`

- [x] Run targeted tests.
- [x] Run `yarn lint`.
- [x] Run `yarn build`.
- [x] Inspect desktop scroll states and mobile fallback CSS in browser.
- [x] Inspect `threadroot score latest` (no score recorded).
