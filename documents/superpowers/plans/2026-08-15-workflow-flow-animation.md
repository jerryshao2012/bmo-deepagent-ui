# Workflow Flow Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 2 contextual routes turn fully orange on hover/focus and show source-to-report direction with hover-only traveling dots.

**Architecture:** Keep the existing SVG and permanent gray connector tracks. Derive upper/lower route activity from `hoveredNode`, use full-length orange overlays for active routes, and conditionally render one SVG `animateMotion` particle per active route. CSS handles glow and reduced-motion suppression; no animation loop, dependency, component extraction, or layout change is needed.

**Tech Stack:** React 19, TypeScript, inline SVG/SMIL, Tailwind CSS, Node test runner

---

## File structure

- Modify `src/app/intro/page.tsx`: contextual route state, active SVG overlays, particles, keyboard focus, and reduced-motion CSS.
- Modify `tests/intro-scroll-story.test.mjs`: regression coverage for route mapping, complete hover overlays, directional particles, focus parity, and reduced motion.

### Task 1: Add failing workflow-route regression tests

**Files:**

- Modify: `tests/intro-scroll-story.test.mjs:44-60`
- Test: `tests/intro-scroll-story.test.mjs`

- [ ] **Step 1: Write the failing route-state test**

Add a source-level regression test that requires explicit contextual route booleans:

```js
test("phase 2 activates complete contextual routes", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /upperRouteActive\s*=\s*activeNode !== null &&\s*\["A",\s*"B",\s*"C"\]\.includes\(activeNode\)/
  );
  assert.match(
    source,
    /lowerRouteActive\s*=\s*activeNode !== null &&\s*\["A",\s*"B",\s*"D"\]\.includes\(activeNode\)/
  );
  assert.equal(source.match(/data-workflow-route="upper"/g)?.length, 2);
  assert.equal(source.match(/data-workflow-route="lower"/g)?.length, 2);
  assert.equal(
    source.match(/stroke=\{upperRouteActive \? "#FF8A42" : "transparent"\}/g)
      ?.length,
    2
  );
  assert.equal(
    source.match(/stroke=\{lowerRouteActive \? "#FF8A42" : "transparent"\}/g)
      ?.length,
    2
  );
});
```

- [ ] **Step 2: Write the failing particle and accessibility test**

```js
test("phase 2 shows directional particles only on active routes", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.equal(source.match(/<animateMotion/g)?.length, 2);
  assert.equal(source.match(/dur="1\.6s"/g)?.length, 2);
  assert.equal(source.match(/repeatCount="indefinite"/g)?.length, 2);
  assert.match(source, /className="workflow-particle"/);
  assert.match(
    source,
    /prefers-reduced-motion: reduce[\s\S]*\.workflow-particle\s*\{[\s\S]*display:\s*none/
  );
  assert.match(source, /const activeNode = hoveredNode \?\? focusedNode/);
  assert.equal(source.match(/onFocus=\{/g)?.length >= 4, true);
  assert.equal(source.match(/onBlur=\{/g)?.length >= 4, true);
});
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
node --test tests/intro-scroll-story.test.mjs
```

Expected: FAIL because route booleans, particles, focus handlers, and reduced-motion particle CSS do not exist.

### Task 2: Make complete contextual routes turn orange

**Files:**

- Modify: `src/app/intro/page.tsx:1451-1453`
- Modify: `src/app/intro/page.tsx:1594-1597`
- Modify: `src/app/intro/page.tsx:2147-2195`
- Test: `tests/intro-scroll-story.test.mjs`

- [ ] **Step 1: Derive upper and lower route activity**

Use independent pointer and keyboard state so one input mode cannot clear the other:

```tsx
type WorkflowNodeId = "A" | "B" | "C" | "D";

const [hoveredNode, setHoveredNode] = useState<WorkflowNodeId | null>(null);
const [focusedNode, setFocusedNode] = useState<WorkflowNodeId | null>(null);
const activeNode = hoveredNode ?? focusedNode;
const upperRouteActive =
  activeNode !== null && ["A", "B", "C"].includes(activeNode);
const lowerRouteActive =
  activeNode !== null && ["A", "B", "D"].includes(activeNode);
```

This maps Source (`A`) and Report (`B`) to both routes, Wiki (`C`) to upper route, and Plan (`D`) to lower route.

- [ ] **Step 2: Style independent active overlays**

Extend the inline styles:

```css
.workflow-route {
  transition: stroke 240ms ease;
}
```

Keep the permanent gray connector group unchanged. Remove `.chapter-path` from the four interactive overlays so scroll progress cannot shorten an active route. Remove now-unused `.chapter-path` CSS and its source-test assertion.

- [ ] **Step 3: Apply route activity to both segments of each route**

For upper segments, use `upperRouteActive`; for lower segments, use `lowerRouteActive`. Inactive overlays are transparent so the permanent gray tracks remain the sole neutral layer:

```tsx
<path
  data-workflow-route="upper"
  d="M 120 180 Q 220 180 320 120"
  stroke={upperRouteActive ? "#FF8A42" : "transparent"}
  strokeWidth="2.5"
  strokeLinecap="round"
  fill="none"
  className="workflow-route"
/>
```

Use the equivalent lower-route expression for both lower segments.

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test tests/intro-scroll-story.test.mjs
```

Expected: route-state assertions PASS; particle/accessibility assertions still FAIL.

### Task 3: Add traveling particles and focus parity

**Files:**

- Modify: `src/app/intro/page.tsx:1636-1663`
- Modify: `src/app/intro/page.tsx:1742-1753`
- Modify: `src/app/intro/page.tsx:2195-2295`
- Test: `tests/intro-scroll-story.test.mjs`

- [ ] **Step 1: Render the upper route particle conditionally**

After the four route overlays and before `</svg>`, add:

```tsx
{
  upperRouteActive && (
    <circle
      className="workflow-particle"
      r="4.5"
      aria-hidden="true"
    >
      <animateMotion
        dur="1.6s"
        repeatCount="indefinite"
        path="M 120 180 Q 220 180 320 120 Q 420 120 520 180"
      />
    </circle>
  );
}
```

- [ ] **Step 2: Render the lower route particle with contextual stagger**

```tsx
{
  lowerRouteActive && (
    <circle
      className="workflow-particle"
      r="4.5"
      aria-hidden="true"
    >
      <animateMotion
        begin={upperRouteActive ? "0.18s" : "0s"}
        dur="1.6s"
        repeatCount="indefinite"
        path="M 120 180 Q 220 180 320 240 Q 420 240 520 180"
      />
    </circle>
  );
}
```

- [ ] **Step 3: Style the particle and reduced-motion fallback**

Add:

```css
.workflow-particle {
  fill: #ff8a42;
  filter: drop-shadow(0 0 4px rgba(255, 138, 66, 0.72));
  pointer-events: none;
}
```

Inside `@media (prefers-reduced-motion: reduce)` add:

```css
.workflow-particle {
  display: none;
}
```

Do not disable full orange route highlighting in reduced-motion mode.

- [ ] **Step 4: Give all four cards keyboard-equivalent behavior**

For each node card add matching focus handlers and label. Pointer handlers update only `hoveredNode`; focus handlers update only `focusedNode`:

```tsx
tabIndex={0}
onMouseEnter={() => setHoveredNode("A")}
onMouseLeave={() => setHoveredNode(null)}
onFocus={() => setFocusedNode("A")}
onBlur={() => setFocusedNode(null)}
aria-label="Source Material workflow node"
```

Use node IDs `A`, `C`, `D`, and `B` and matching visible card names. Replace `hoveredNode` with `activeNode` in card highlighting and status-helper rendering so keyboard focus receives identical presentation.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run:

```bash
node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
```

Expected: all intro tests PASS.

### Task 4: Verify motion, accessibility, and build

**Files:**

- Verify: `src/app/intro/page.tsx`
- Verify: `tests/intro-scroll-story.test.mjs`

- [ ] **Step 1: Browser-check all contextual routes**

At the Phase 2 chapter around 50% scroll progress, verify:

- Source hover/focus: all four segments orange; two particles travel toward Report.
- Living Wiki hover/focus: upper two segments orange; one upper particle.
- Research Plan hover/focus: lower two segments orange; one lower particle.
- Report hover/focus: all four segments orange; two staggered particles.
- Mouse leave/focus loss: all routes gray; no particles.

- [ ] **Step 2: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce` or inspect the media rule. Confirm route highlighting remains, particles are hidden, and no new continuous motion runs.

- [ ] **Step 3: Run complete verification**

```bash
node --test tests/intro-scroll-story.test.mjs tests/intro-content.test.mjs
yarn lint
yarn build
git diff --check
```

Expected: tests and build exit 0; lint reports 0 errors. Existing unrelated worktree warnings may remain.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/app/intro/page.tsx tests/intro-scroll-story.test.mjs
git commit -m "feat(intro): animate workflow route direction"
```
