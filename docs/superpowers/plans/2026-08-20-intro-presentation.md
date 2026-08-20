# Intro Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert existing intro into six-slide, BMO-inspired presentation with keyboard, wheel, touch, hash, progress, and fullscreen navigation while preserving copy, animations, and Collab Thread behavior.

**Architecture:** Keep Markdown sync and dialog logic inside existing intro page, but isolate presentation behavior into pure navigation helpers, one React hook, and one chrome component. Wrap existing content in six stable slide sections and drive its current reveal classes from active-slide state. Use existing React 19, Next.js 16, Tailwind 3, and browser APIs; add no dependencies.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Tailwind CSS 3, Node test runner, Testing Library/JSDOM.

---

## File map

- Create `src/app/intro/presentation-navigation.ts`: slide IDs, labels, key mapping, boundary selection, overflow checks, editable-target checks.
- Create `src/app/intro/use-intro-presentation.ts`: browser event lifecycle, active-slide observation, direct navigation, hash restoration, fullscreen state.
- Create `src/app/intro/presentation-chrome.tsx`: progress bar, dots, slide count, keyboard hint, fullscreen control, live status.
- Modify `src/app/intro/page.tsx`: wire hook/chrome, split hero and preview, wrap six slides, preserve dialog/sync/content, apply BMO-inspired visual tokens and active-slide motion.
- Keep `src/app/intro/phase-navigation.ts`: preserve existing direct phase-link semantics and compatibility tests.
- Create `tests/intro-presentation-navigation.test.ts`: pure navigation and overflow behavior.
- Create `tests/use-intro-presentation.test.tsx`: browser interaction and cleanup behavior.
- Create `tests/intro-presentation-chrome.test.tsx`: accessible chrome rendering and actions.
- Modify `tests/intro-scroll-story.test.mjs`: replace old sticky-story assertions with six-slide and animation assertions.
- Modify `tests/intro-content.test.mjs`: assert content order/preservation and excluded reference-only editing/export features.

## Task 1: Build pure presentation navigation model

Use `@test-driven-development`.

**Files:**
- Create: `tests/intro-presentation-navigation.test.ts`
- Create: `src/app/intro/presentation-navigation.ts`

- [ ] **Step 1: Write failing tests for six-slide order and boundaries**

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  INTRO_SLIDES,
  adjacentIntroSlide,
  directionForPresentationKey,
  isPresentationEditableTarget,
  isPresentationInteractiveTarget,
  shouldLeaveOverflowingSlide,
} from "../src/app/intro/presentation-navigation";

test("intro presentation has six stable slides in content order", () => {
  assert.deepEqual(
    INTRO_SLIDES.map(({ id }) => id),
    ["hero", "preview", "phase1", "phase2", "phase3", "launch"]
  );
});

test("adjacent slide selection clamps at deck boundaries", () => {
  assert.equal(adjacentIntroSlide("hero", -1), "hero");
  assert.equal(adjacentIntroSlide("hero", 1), "preview");
  assert.equal(adjacentIntroSlide("phase2", 1), "phase3");
  assert.equal(adjacentIntroSlide("launch", 1), "launch");
});

test("presentation keys map to forward and backward directions", () => {
  for (const key of ["ArrowRight", "ArrowDown", "PageDown", " "]) {
    assert.equal(directionForPresentationKey(key, false), 1);
  }
  for (const key of ["ArrowLeft", "ArrowUp", "PageUp"]) {
    assert.equal(directionForPresentationKey(key, false), -1);
  }
  assert.equal(directionForPresentationKey(" ", true), -1);
  assert.equal(directionForPresentationKey("Enter", false), null);
});

test("overflowing slides retain native reading movement until a boundary", () => {
  const middle = { top: -120, bottom: 1180, viewportHeight: 900 };
  assert.equal(shouldLeaveOverflowingSlide(middle, 1), false);
  assert.equal(shouldLeaveOverflowingSlide(middle, -1), false);
  assert.equal(
    shouldLeaveOverflowingSlide({ ...middle, bottom: 899 }, 1),
    true
  );
  assert.equal(
    shouldLeaveOverflowingSlide({ ...middle, top: 64 }, -1, 64),
    true
  );
});

test("typing and interactive targets suppress presentation shortcuts", () => {
  assert.equal(isPresentationEditableTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isPresentationEditableTarget({ tagName: "BUTTON" }), false);
  assert.equal(isPresentationInteractiveTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isPresentationInteractiveTarget({ tagName: "INPUT" }), true);
  assert.equal(isPresentationInteractiveTarget({ tagName: "BUTTON" }), true);
  assert.equal(isPresentationInteractiveTarget({ tagName: "A" }), true);
  assert.equal(isPresentationInteractiveTarget({ isContentEditable: true }), true);
  assert.equal(isPresentationInteractiveTarget({ tagName: "DIV" }), false);
});
```

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `node --import tsx --test tests/intro-presentation-navigation.test.ts`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `presentation-navigation`.

- [ ] **Step 3: Implement pure model**

```ts
export const INTRO_SLIDES = [
  { id: "hero", label: "Overview" },
  { id: "preview", label: "Workspace preview" },
  { id: "phase1", label: "Phase 1: Ground" },
  { id: "phase2", label: "Phase 2: Research" },
  { id: "phase3", label: "Phase 3: Review" },
  { id: "launch", label: "Launch" },
] as const;

export type IntroSlideId = (typeof INTRO_SLIDES)[number]["id"];
export type PresentationDirection = -1 | 1;

export interface SlideViewport {
  top: number;
  bottom: number;
  viewportHeight: number;
}

export interface PresentationInputTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export function adjacentIntroSlide(
  current: IntroSlideId,
  direction: PresentationDirection
): IntroSlideId {
  const index = INTRO_SLIDES.findIndex(({ id }) => id === current);
  const next = Math.max(0, Math.min(INTRO_SLIDES.length - 1, index + direction));
  return INTRO_SLIDES[next].id;
}

export function directionForPresentationKey(
  key: string,
  shiftKey: boolean
): PresentationDirection | null {
  if (key === " " && shiftKey) return -1;
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(key)) return 1;
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(key)) return -1;
  return null;
}

export function shouldLeaveOverflowingSlide(
  viewport: SlideViewport,
  direction: PresentationDirection,
  headerOffset = 0,
  epsilon = 2
): boolean {
  return direction === 1
    ? viewport.bottom <= viewport.viewportHeight + epsilon
    : viewport.top >= headerOffset - epsilon;
}

export function isPresentationEditableTarget(
  target: PresentationInputTarget | null
): boolean {
  if (!target) return false;
  return (
    Boolean(target.isContentEditable) ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? "")
  );
}

export function isPresentationInteractiveTarget(
  target: PresentationInputTarget | null
): boolean {
  return (
    isPresentationEditableTarget(target) ||
    ["BUTTON", "A"].includes(target?.tagName ?? "")
  );
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `node --import tsx --test tests/intro-presentation-navigation.test.ts`

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/intro/presentation-navigation.ts tests/intro-presentation-navigation.test.ts
git commit -m "test: define intro presentation navigation"
```

## Task 2: Add browser presentation controller hook

Use `@test-driven-development`. Keep all browser APIs behind hook effects so server rendering remains safe.

**Files:**
- Create: `tests/use-intro-presentation.test.tsx`
- Create: `src/app/intro/use-intro-presentation.ts`

- [ ] **Step 1: Write failing hook interaction tests**

Set up JSDOM with `tests/setup-dom.ts`, stub `matchMedia`, `IntersectionObserver`, `Element.prototype.scrollIntoView`, `document.fullscreenElement`, `document.documentElement.requestFullscreen`, and `document.exitFullscreen`. Render hook with props so suspension can be changed:

```ts
const { result, rerender } = renderHook(
  ({ suspended }) => useIntroPresentation({ suspended }),
  { initialProps: { suspended: false } }
);
```

Required assertions:

```ts
assert.equal(result.current.activeSlideId, "hero");
window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
assert.deepEqual(scrollCalls.at(-1), { id: "preview", behavior: "smooth" });

rerender({ suspended: true });
window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
assert.equal(scrollCalls.length, previousCount);

rerender({ suspended: false });
const resumedCount = scrollCalls.length;

textarea.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
assert.equal(scrollCalls.length, resumedCount);

fullscreenButton.dispatchEvent(
  new KeyboardEvent("keydown", { key: " ", bubbles: true })
);
assert.equal(scrollCalls.length, resumedCount);

fullscreenButton.dispatchEvent(
  new KeyboardEvent("keydown", { key: "f", bubbles: true })
);
assert.equal(requestFullscreenCalls, 1);

window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
assert.equal(requestFullscreenCalls, 2);
```

Also test:

- hash restoration for `#phase2` with reduced motion uses `behavior: "auto"`;
- `Home`/`End` navigate immediately;
- Arrow/Page/Space do not prevent native scrolling while active slide overflows away from boundary;
- wheel input advances once at boundary and ignores a second event during cooldown;
- touch swipe below threshold does nothing; qualifying swipe advances at boundary;
- center-band observation activates a slide taller than two viewports and updates hash/progress state;
- cleanup removes listeners, disconnects observer, and removes `intro-presentation-ready` from the document root;
- fullscreen rejection sets `Fullscreen is unavailable in this browser context`.
- invalid or missing hash scrolls to `hero` with reduced-motion-aware behavior and replaces the URL with `#hero`.

- [ ] **Step 2: Run tests and verify missing-hook failure**

Run: `node --import tsx --test --test-isolation=none tests/use-intro-presentation.test.tsx`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `use-intro-presentation`.

- [ ] **Step 3: Implement hook API and lifecycle**

Export this interface:

```ts
export interface IntroPresentationState {
  activeSlideId: IntroSlideId;
  activeSlideIndex: number;
  isFullscreen: boolean;
  fullscreenStatus: string;
  goToSlide(id: IntroSlideId, historyMode?: "push" | "replace"): void;
  toggleFullscreen(): Promise<void>;
}

export function useIntroPresentation({
  suspended,
}: {
  suspended: boolean;
}): IntroPresentationState;
```

Implementation requirements:

```ts
const goToSlide = useCallback((id, historyMode = "replace") => {
  const target = document.getElementById(id);
  if (!target) return;
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  target.scrollIntoView({ behavior, block: "start" });
  window.history[historyMode === "push" ? "pushState" : "replaceState"](
    null,
    "",
    `#${id}`
  );
  setActiveSlideId(id);
}, []);
```

Use one `IntersectionObserver` over `[data-intro-slide]` with `{ rootMargin: "-49% 0px -49% 0px", threshold: 0 }`. The narrow center band activates a slide whenever that slide crosses viewport center, including slides taller than two viewports. On `entry.isIntersecting`, update active slide, replace hash, remove `is-active` from other slides, and add it to active slide. On mount, add `intro-presentation-ready` to `document.documentElement`; remove it on cleanup. Restore a valid hash. For an invalid or missing hash, call `goToSlide("hero", "replace")` so viewport and URL both fall back explicitly.

Keyboard handler order:

1. Return when `suspended`, modifier keys are active, or target is editable (`input`, `textarea`, `select`, or contenteditable).
2. Handle `f` before the general interactive-target guard so fullscreen still works when a button or link has focus.
3. Return for remaining keys when target is a button or link. This preserves native Space activation for dots and fullscreen controls.
4. Handle `Home`/`End` directly.
5. Resolve direction from `directionForPresentationKey`.
6. If active slide rect has unread overflow in that direction, do not prevent default.
7. Otherwise prevent default and navigate to clamped adjacent slide.

Wheel handler uses `{ passive: false }`, a `24px` delta threshold, and `620ms` lock only after slide navigation. Touch uses `changedTouches[0].clientY`, a `48px` threshold, and the same overflow-boundary rule.

Fullscreen implementation supports standard and WebKit-prefixed methods, listens for `fullscreenchange` and `webkitfullscreenchange`, updates `isFullscreen`, and reports failure via `fullscreenStatus` without throwing.

- [ ] **Step 4: Run hook tests and verify pass**

Run: `node --import tsx --test --test-isolation=none tests/use-intro-presentation.test.tsx`

Expected: all hook tests PASS with no leaked event listeners.

- [ ] **Step 5: Commit**

```bash
git add src/app/intro/use-intro-presentation.ts tests/use-intro-presentation.test.tsx
git commit -m "feat: add intro presentation controller"
```

## Task 3: Build accessible presentation chrome

Use `@test-driven-development` and `@redesign-existing-projects`.

**Files:**
- Create: `tests/intro-presentation-chrome.test.tsx`
- Create: `src/app/intro/presentation-chrome.tsx`

- [ ] **Step 1: Write failing component test**

Render `PresentationChrome` at active index `2` with spies. Assert:

```ts
assert.equal(screen.getByRole("progressbar").getAttribute("aria-valuenow"), "3");
assert.equal(screen.getByText("03 / 06").textContent, "03 / 06");
assert.equal(screen.getAllByRole("button", { name: /Go to slide/ }).length, 6);
assert.equal(
  screen.getByRole("button", { name: "Go to slide 3: Phase 1: Ground" })
    .getAttribute("aria-current"),
  "step"
);
fireEvent.click(screen.getByRole("button", { name: "Enter fullscreen" }));
assert.equal(toggleFullscreenCalls, 1);
fireEvent.click(screen.getByRole("button", { name: "Go to slide 6: Launch" }));
assert.deepEqual(navigateCalls, ["launch"]);
```

Also assert keyboard hint includes arrows and `F`. Assert live region renders `Slide 3 of 6: Phase 1: Ground` and appends provided fullscreen status when non-empty. Rerender at slide 4 and assert the live text updates.

- [ ] **Step 2: Run test and verify missing-component failure**

Run: `node --import tsx --test --test-isolation=none tests/intro-presentation-chrome.test.tsx`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `presentation-chrome`.

- [ ] **Step 3: Implement focused chrome component**

Props:

```ts
interface PresentationChromeProps {
  activeSlideId: IntroSlideId;
  isFullscreen: boolean;
  fullscreenStatus: string;
  onNavigate(id: IntroSlideId): void;
  onToggleFullscreen(): void;
}
```

Render:

- fixed `3px` progress track using `scaleX((activeIndex + 1) / 6)`;
- right-side vertical dot navigation hidden below `sm`;
- bottom-left `03 / 06` counter and keyboard hint hidden below `md`;
- bottom-right fullscreen button with `Expand`/`Minimize` icon and accessible label;
- `role="status"`, `aria-live="polite"`, `aria-atomic="true"` screen-reader region containing current slide number/label plus fullscreen status when present.

Use BMO-inspired tokens directly in Tailwind arbitrary values: `#0075BE` blue, `#001928` navy, `#E31837` red, `#F3F7FA` surface. Include visible `focus-visible:ring-2 focus-visible:ring-[#0075BE]` and pressed feedback.

- [ ] **Step 4: Run component test and verify pass**

Run: `node --import tsx --test --test-isolation=none tests/intro-presentation-chrome.test.tsx`

Expected: component test PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/intro/presentation-chrome.tsx tests/intro-presentation-chrome.test.tsx
git commit -m "feat: add intro presentation chrome"
```

## Task 4: Restructure existing content into six slides

Use `@test-driven-development`. Do not alter user-facing copy.

**Files:**
- Modify: `tests/intro-scroll-story.test.mjs`
- Modify: `tests/intro-content.test.mjs`
- Modify: `src/app/intro/page.tsx:1-45, 1368-1493, 1789-2625`

- [ ] **Step 1: Replace obsolete scroll-story tests with failing deck tests**

In `tests/intro-scroll-story.test.mjs`, replace the old `145vh`/sticky chapter assertions with:

```js
test("intro renders six ordered presentation slides", async () => {
  const source = await readFile(introPagePath, "utf8");
  assert.equal(source.match(/data-intro-slide/g)?.length, 6);
  const ids = ["hero", "preview", "phase1", "phase2", "phase3", "launch"];
  let previous = -1;
  for (const id of ids) {
    const index = source.indexOf(`id="${id}"`);
    assert.ok(index > previous, `${id} must follow prior slide`);
    previous = index;
  }
  assert.match(source, /min-h-\[100dvh\]/);
  assert.doesNotMatch(source, /min-height:\s*145vh/);
});

test("intro wires presentation controller without replacing Collab Thread", async () => {
  const source = await readFile(introPagePath, "utf8");
  assert.match(source, /useIntroPresentation\(\{\s*suspended:\s*isDialogOpen/);
  assert.match(source, /<PresentationChrome/);
  assert.match(source, /ref=\{markdownPreviewTriggerRef\}/);
  assert.match(source, />\s*Collab Thread\s*</);
});
```

Keep existing Phase 2 connector, particle, focus, and reduced-motion tests, but update expected animation color from orange to BMO blue in Task 5.

In `tests/intro-content.test.mjs`, add assertions that hero, preview marker (`BUILDING THREAD KNOWLEDGE`), three phase headings, and final heading occur in slide order. Add:

```js
assert.doesNotMatch(source, /data-editable|InlineEditor|exportFile/);
```

Do not assert absence of Markdown textarea/copy actions; those belong to retained Collab Thread functionality.

- [ ] **Step 2: Run source tests and verify failure against current page**

Run: `node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs`

Expected: FAIL because current page has no `preview`/`launch` slide IDs and no presentation hook/chrome.

- [ ] **Step 3: Wire controller and chrome in page**

Add imports:

```ts
import { PresentationChrome } from "./presentation-chrome";
import { useIntroPresentation } from "./use-intro-presentation";
```

Inside `IntroPageContent`, after `isDialogOpen` state exists:

```ts
const presentation = useIntroPresentation({ suspended: isDialogOpen });
```

Remove `scrollY`, old scroll-progress effect, `activePhase` state, and phase-only `IntersectionObserver`. Replace the header's `scrollY > 40` conditional classes with a stable white translucent BMO-style surface (`border-[#D6E2EA] bg-white/95 shadow-sm backdrop-blur-xl`) so no removed state remains referenced. Keep `navigateToIntroPhase` for existing header anchor click semantics, and use `presentation.activeSlideId` for active-link styling.

Render `<PresentationChrome {...}` immediately after inline styles and before header:

```tsx
<PresentationChrome
  activeSlideId={presentation.activeSlideId}
  isFullscreen={presentation.isFullscreen}
  fullscreenStatus={presentation.fullscreenStatus}
  onNavigate={(id) => presentation.goToSlide(id, "push")}
  onToggleFullscreen={() => void presentation.toggleFullscreen()}
/>
```

- [ ] **Step 4: Split hero copy and preview without changing their markup content**

Keep current `hero-copy` block inside `section#hero`, add `data-intro-slide`, and close the section before current `hero-preview` block. Wrap the existing preview block in:

```tsx
<section
  id="preview"
  data-intro-slide
  aria-label="Workspace preview"
  className="intro-slide relative flex min-h-[100dvh] items-center justify-center px-6 pb-16 pt-24"
>
  <div className="hero-preview flex w-full max-w-5xl justify-center">
    {/* existing preview content, unchanged */}
  </div>
</section>
```

Keep hero text, CTA, preview terminal copy, thread number, pointer tilt handlers, and visual content unchanged.

- [ ] **Step 5: Promote phases and final CTA to slides**

Change each phase wrapper to semantic `<section id="phaseN" data-intro-slide className="intro-slide ...">`. Remove the shared phases container that prevents each phase from being a direct slide. Preserve all current phase JSX, connector SVG, hover/focus handlers, lists, and copy.

Change final CTA to:

```tsx
<section
  id="launch"
  data-intro-slide
  className="intro-slide relative flex min-h-[100dvh] flex-col items-center justify-center ..."
>
  <div className="launch-content relative z-10 max-w-3xl">
    {/* existing final heading, paragraph, CTA, and article links unchanged */}
  </div>
</section>
```

Remove old negative margin/sticky-tail layout classes. Add only the `launch-content` class to the existing inner wrapper; preserve final heading, paragraph, launch link, and two Medium links exactly.

- [ ] **Step 6: Keep header behavior and add active-state compatibility**

Retain `markdownPreviewTriggerRef`, `openMarkdownPreview`, thread display, and `/chat` link. Phase link active style becomes:

```ts
presentation.activeSlideId === "phase1" && "text-[#0075BE]"
```

Use the corresponding ID for phases 2 and 3. Header click handler remains `navigateToIntroPhase` so existing modifier-click behavior and tests stay intact.

- [ ] **Step 7: Run focused tests**

Run: `node --import tsx --test tests/intro-phase-navigation.test.ts tests/intro-presentation-navigation.test.ts && node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs`

Expected: all focused tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/intro/page.tsx tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
git commit -m "feat: arrange intro content as six slides"
```

## Task 5: Preserve motion and apply BMO-inspired visual system

Use `@redesign-existing-projects` and keep current motion affordances.

**Files:**
- Modify: `tests/intro-scroll-story.test.mjs`
- Modify: `src/app/intro/page.tsx:1495-1786, 1789-2625`

- [ ] **Step 1: Add failing visual and motion contract assertions**

Add source-contract tests for:

```js
assert.match(source, /--bmo-blue:\s*#0075be/i);
assert.match(source, /--bmo-navy:\s*#001928/i);
assert.match(source, /--bmo-red:\s*#e31837/i);
assert.match(source, /\.intro-slide\.is-active[\s\S]*\.chapter-copy/);
assert.match(source, /\.intro-slide\.is-active[\s\S]*\.chapter-visual/);
assert.match(source, /\.intro-slide\.is-active[\s\S]*\.hero-copy/);
assert.match(source, /\.intro-slide\.is-active[\s\S]*\.launch-content/);
assert.match(source, /id="launch"[\s\S]{0,500}className="launch-content/);
assert.match(source, /\.intro-presentation-ready[\s\S]*\.intro-slide/);
assert.match(source, /prefers-reduced-motion:\s*reduce/);
assert.match(source, /hero-preview/);
assert.match(source, /handleMouseMove/);
```

Update connector assertions from `#ff8a42`/orange rgba to `#0075be`/BMO-blue rgba. Preserve assertion counts for four route paths, two particles, four focusable workflow nodes, and the SVG reduced-motion fallback.

- [ ] **Step 2: Run test and verify palette/motion contract failure**

Run: `node --test tests/intro-scroll-story.test.mjs`

Expected: FAIL on missing BMO CSS variables and old orange route colors.

- [ ] **Step 3: Replace scroll-progress CSS with active-slide reveal CSS**

Define variables on the page root:

```css
--bmo-blue: #0075be;
--bmo-navy: #001928;
--bmo-red: #e31837;
--bmo-surface: #f3f7fa;
--bmo-line: #d6e2ea;
```

Use:

```css
.intro-slide {
  min-height: 100dvh;
  scroll-margin-top: 4rem;
  scroll-snap-align: start;
  position: relative;
}
.intro-presentation-ready .intro-slide .hero-copy,
.intro-presentation-ready .intro-slide .chapter-copy,
.intro-presentation-ready .intro-slide .chapter-visual,
.intro-presentation-ready .intro-slide .chapter-reveal,
.intro-presentation-ready .intro-slide .hero-preview,
.intro-presentation-ready .intro-slide .launch-content {
  opacity: 0;
  transform: translate3d(0, 28px, 0) scale(.985);
}
.intro-slide.is-active .hero-copy,
.intro-slide.is-active .chapter-copy,
.intro-slide.is-active .chapter-visual,
.intro-slide.is-active .chapter-reveal,
.intro-slide.is-active .hero-preview,
.intro-slide.is-active .launch-content {
  opacity: 1;
  transform: none;
  transition: opacity 700ms cubic-bezier(.16,1,.3,1),
    transform 700ms cubic-bezier(.16,1,.3,1);
}
.intro-slide.is-active .chapter-reveal[data-reveal="2"] { transition-delay: 120ms; }
.intro-slide.is-active .chapter-reveal[data-reveal="3"] { transition-delay: 220ms; }
```

The hook's center-band observer must toggle `is-active` on the observed slide as it becomes active. Hiding rules are gated by the hook-added `intro-presentation-ready` class; without JavaScript, all content remains visible and native scrolling remains usable. Reduced-motion CSS forces opacity `1`, transform `none`, transition `none`, hides workflow particles, and disables node/route transitions.

- [ ] **Step 4: Apply BMO-inspired colors without changing copy**

- Page/header surfaces: white and `var(--bmo-surface)`.
- Display/body text: `var(--bmo-navy)` and cool blue-gray.
- Active phase links, progress, dots, labels, focus rings, workflow routes/particles: `var(--bmo-blue)`.
- Launch CTAs only: `var(--bmo-red)` with a darker red hover.
- Final slide: deep navy, not neutral black; keep all final content.
- Keep existing Applied AI mark; recolor its container to BMO blue rather than adding/copied BMO assets.
- Remove orange ambient glow and orange selection rules from intro presentation surfaces. Do not recolor status semantics inside retained Collab Thread dialog.

- [ ] **Step 5: Run source, navigation, hook, and chrome tests**

Run:

```bash
node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
node --import tsx --test --test-isolation=none tests/intro-phase-navigation.test.ts tests/intro-presentation-navigation.test.ts tests/use-intro-presentation.test.tsx tests/intro-presentation-chrome.test.tsx
node --test tests/markdown-preview-sync.test.mjs
node --import tsx --test --test-isolation=none tests/markdown-preview-focus-restoration.test.ts tests/markdown-preview-activity.test.ts tests/markdown-connection-lifecycle.test.ts tests/markdown-pending-edit-coordinator.test.ts tests/markdown-sync-state.test.ts
```

Expected: all intro and Markdown regression tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/intro/page.tsx tests/intro-scroll-story.test.mjs
git commit -m "style: apply BMO presentation system"
```

## Task 6: Integration verification and handoff

Use `@verification-before-completion`.

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run complete intro-focused suite**

```bash
node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
node --import tsx --test --test-isolation=none tests/intro-phase-navigation.test.ts tests/intro-presentation-navigation.test.ts tests/use-intro-presentation.test.tsx tests/intro-presentation-chrome.test.tsx
node --test tests/markdown-preview-sync.test.mjs
node --import tsx --test --test-isolation=none tests/markdown-preview-focus-restoration.test.ts tests/markdown-preview-activity.test.ts tests/markdown-connection-lifecycle.test.ts tests/markdown-pending-edit-coordinator.test.ts tests/markdown-sync-state.test.ts
```

Expected: all intro and retained Markdown sync/dialog tests PASS.

- [ ] **Step 2: Run project lint**

Run: `yarn lint`

Expected: exit 0 with no ESLint errors.

- [ ] **Step 3: Run production build**

Run: `yarn build`

Expected: exit 0; Next.js compiles `/` and existing routes successfully.

- [ ] **Step 4: Browser-check presentation behavior**

Run `yarn dev`, open `/?thread_id=256905`, and verify:

- six slides appear in approved order with unchanged copy;
- first and second slides match supplied content composition, and final slide retains supplied content;
- `#phase1`, `#phase2`, and `#phase3` load the correct slide;
- Arrow/Page/Space/Home/End navigation works;
- wheel and touch retain native reading scroll on overflowing mobile slides, then advance at boundaries;
- `F` and fullscreen button enter/exit fullscreen; unsupported/rejected calls announce status;
- progress, count, and dots update;
- Collab Thread opens, accepts Markdown edits, previews content, closes, and returns focus to its header trigger;
- presentation shortcuts remain paused while Collab Thread is open or textarea is focused;
- preview tilt, phase workflow hover/focus animation, and reduced-motion behavior remain intact;
- desktop widths `1440px` and `1024px`, mobile width `390px`, and keyboard-only focus order are usable.

- [ ] **Step 5: Record a narrow Threadroot verification run**

Run: `threadroot prep "Verify six-slide intro presentation navigation, animation, accessibility, and Collab Thread regression coverage" --memory tiny --json`

Expected: JSON brief recorded under `.codex/threadroot/`. If command returns `EPERM` for `.codex/threadroot/index/latest.json`, request elevated sandbox permission for exact `threadroot prep` prefix and rerun. If approval is declined, do not bypass sandbox; record Threadroot score as unavailable and continue with completed test/lint/build evidence.

- [ ] **Step 6: Inspect Threadroot score**

Run only when Step 5 recorded a run: `threadroot score latest --json`

Expected: score output available for recorded run; inspect failures or context warnings before claiming completion. If Step 5 could not record because elevation was declined, skip this command and report that constraint explicitly.

- [ ] **Step 7: Commit any verification-only fixes**

Run `git status --short` and `git diff -- src/app/intro tests` first. If fixes exist, stage only the explicitly reviewed intro files:

```bash
git add src/app/intro/page.tsx src/app/intro/presentation-navigation.ts src/app/intro/use-intro-presentation.ts src/app/intro/presentation-chrome.tsx tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs tests/intro-presentation-navigation.test.ts tests/use-intro-presentation.test.tsx tests/intro-presentation-chrome.test.tsx
git commit -m "fix: polish intro presentation behavior"
```

Skip this commit when no files changed.
