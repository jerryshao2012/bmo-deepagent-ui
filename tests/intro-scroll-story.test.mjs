import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const introPagePath = new URL("../src/app/intro/page.tsx", import.meta.url);

test("intro page renders exactly six ordered semantic presentation slides", async () => {
  const source = await readFile(introPagePath, "utf8");
  const slideSections = [...source.matchAll(/<section\b[\s\S]*?>/g)]
    .map(([openingTag]) => openingTag)
    .filter((openingTag) => openingTag.includes("data-intro-slide"));

  assert.equal(source.match(/\bdata-intro-slide\b/g)?.length, 6);
  assert.deepEqual(
    slideSections.map((openingTag) => openingTag.match(/id="([^"]+)"/)?.[1]),
    ["hero", "preview", "phase1", "phase2", "phase3", "launch"]
  );
  for (const openingTag of slideSections) {
    assert.match(openingTag, /className="[^"]*\bintro-slide\b[^"]*"/);
    assert.match(openingTag, /min-h-\[100dvh\]/);
  }
  assert.doesNotMatch(
    source,
    /<section className="border-t border-stone-200\/40 bg-white">/
  );
});

test("intro page removes obsolete sticky story and negative launch tail", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /scroll-margin-top/);
  assert.doesNotMatch(source, /min-height:\s*145vh/);
  assert.doesNotMatch(source, /lg:-mt-\[calc\(40vh-3rem\)\]/);
  assert.doesNotMatch(source, /lg:min-h-\[calc\(100vh-3rem\)\]/);
  assert.doesNotMatch(source, /data-scroll-chapter/);
  assert.doesNotMatch(source, /data-scroll-reveal/);
});

test("intro page keeps document as the only vertical scroll container", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /min-h-screen overflow-x-clip/);
  assert.doesNotMatch(source, /min-h-screen overflow-x-hidden/);
});

test("hero and workspace preview are separate sibling slides", async () => {
  const source = await readFile(introPagePath, "utf8");
  const heroStart = source.indexOf('id="hero"');
  const heroEnd = source.indexOf("</section>", heroStart);
  const previewStart = source.indexOf('id="preview"', heroEnd);
  const previewEnd = source.indexOf("</section>", previewStart);

  assert.notEqual(heroStart, -1);
  assert.notEqual(heroEnd, -1);
  assert.ok(previewStart > heroEnd);
  assert.ok(previewEnd > previewStart);
  assert.match(source.slice(heroStart, heroEnd), /hero-copy/);
  assert.doesNotMatch(source.slice(heroStart, heroEnd), /hero-preview/);
  assert.match(source.slice(previewStart, previewEnd), /hero-preview/);
  assert.match(
    source.slice(previewStart, previewEnd),
    /aria-label="Workspace preview"/
  );
  assert.match(source.slice(previewStart, previewEnd), /ref=\{stackRef\}/);
  assert.match(
    source.slice(previewStart, previewEnd),
    /Active Thread: #\{threadId\}/
  );
});

test("intro page integrates suspended presentation control and chrome", async () => {
  const source = await readFile(introPagePath, "utf8");
  const chromeStart = source.indexOf("<PresentationChrome");
  const inlineStyleEnd = source.indexOf("/>", source.indexOf("<style"));
  const headerStart = source.indexOf("<header", inlineStyleEnd);

  assert.match(
    source,
    /import \{ PresentationChrome \} from "\.\/presentation-chrome";/
  );
  assert.match(
    source,
    /import \{ useIntroPresentation \} from "\.\/use-intro-presentation";/
  );
  assert.equal(
    source.match(/useIntroPresentation\(\{ suspended: isDialogOpen \}\)/g)
      ?.length,
    1
  );
  assert.match(source, /activeSlideId=\{presentation\.activeSlideId\}/);
  assert.match(source, /isFullscreen=\{presentation\.isFullscreen\}/);
  assert.match(source, /fullscreenStatus=\{presentation\.fullscreenStatus\}/);
  assert.match(
    source,
    /onNavigate=\{\(id\) => presentation\.goToSlide\(id, "push"\)\}/
  );
  assert.match(
    source,
    /onToggleFullscreen=\{\(\) => void presentation\.toggleFullscreen\(\)\}/
  );
  assert.ok(inlineStyleEnd < chromeStart && chromeStart < headerStart);
});

test("intro header retains product actions and follows active presentation slide", async () => {
  const source = await readFile(introPagePath, "utf8");
  const header = source.slice(
    source.indexOf("<header"),
    source.indexOf("</header>")
  );

  assert.doesNotMatch(source, /\bscrollY\b/);
  for (const stableHeaderClass of [
    "border-[#D6E2EA]",
    "bg-white/95",
    "shadow-sm",
    "backdrop-blur-xl",
  ]) {
    assert.ok(header.includes(stableHeaderClass));
  }
  assert.match(header, /Applied AI Deep Agent/);
  assert.match(header, /ref=\{markdownPreviewTriggerRef\}/);
  assert.match(header, /Collab Thread/);
  assert.match(header, /: #\{threadId\}/);
  assert.match(header, /Launch Workspace/);
  for (const phaseId of ["phase1", "phase2", "phase3"]) {
    assert.match(
      header,
      new RegExp(
        `presentation\\.activeSlideId === "${phaseId}" && "text-\\[#0075BE\\]"`
      )
    );
  }
});

test("phase 2 keeps complete connector tracks beneath animated paths", async () => {
  const source = await readFile(introPagePath, "utf8");
  const connectorPaths = [
    "M 120 180 Q 220 180 320 120",
    "M 120 180 Q 220 180 320 240",
    "M 320 120 Q 420 120 520 180",
    "M 320 240 Q 420 240 520 180",
  ];

  assert.match(source, /data-connector-track[\s\S]{0,220}stroke="#e2e8f0"/);
  for (const path of connectorPaths) {
    assert.equal(source.split(`d="${path}"`).length - 1, 2);
  }
});

test("phase 2 activates complete contextual workflow routes", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /type WorkflowNodeId = "A" \| "B" \| "C" \| "D";/);
  assert.match(source, /useState<WorkflowNodeId \| null>\(null\)/);
  assert.match(source, /const activeNode = hoveredNode \?\? focusedNode;/);
  assert.match(
    source,
    /upperRouteActive\s*=\s*activeNode !== null &&\s*\["A", "B", "C"\]\.includes\(activeNode\)/
  );
  assert.match(
    source,
    /lowerRouteActive\s*=\s*activeNode !== null &&\s*\["A", "B", "D"\]\.includes\(activeNode\)/
  );
  assert.equal(source.match(/data-workflow-route="upper"/g)?.length, 2);
  assert.equal(source.match(/data-workflow-route="lower"/g)?.length, 2);
  assert.equal(
    source.match(/stroke=\{upperRouteActive \? "#ff8a42" : "transparent"\}/g)
      ?.length,
    2
  );
  assert.equal(
    source.match(/stroke=\{lowerRouteActive \? "#ff8a42" : "transparent"\}/g)
      ?.length,
    2
  );
  assert.equal(source.match(/className="workflow-route"/g)?.length, 4);
  assert.match(
    source,
    /\.workflow-route\s*\{\s*transition:\s*stroke 240ms ease;\s*\}/
  );
  assert.doesNotMatch(source, /chapter-path/);
});

test("phase 2 shows directional particles only on active routes", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.equal(
    source.match(/<circle\s+className="workflow-particle"/g)?.length,
    2
  );
  assert.equal(source.match(/<animateMotion/g)?.length, 2);
  assert.equal(source.match(/dur="1\.6s"/g)?.length, 2);
  assert.equal(source.match(/repeatCount="indefinite"/g)?.length, 2);
  assert.match(
    source,
    /\{upperRouteActive && \([\s\S]*path="M 120 180 Q 220 180 320 120 Q 420 120 520 180"[\s\S]*?\)\}/
  );
  assert.match(
    source,
    /\{lowerRouteActive && \([\s\S]*begin=\{upperRouteActive \? "0\.18s" : "0s"\}[\s\S]*path="M 120 180 Q 220 180 320 240 Q 420 240 520 180"[\s\S]*?\)\}/
  );
  assert.match(
    source,
    /\.workflow-particle\s*\{\s*fill:\s*#ff8a42;\s*filter:\s*drop-shadow\(0 0 4px rgba\(255, 138, 66, 0\.72\)\);\s*pointer-events:\s*none;\s*\}/
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.workflow-particle\s*\{\s*display:\s*none;\s*\}/
  );
});

test("phase 2 workflow cards preserve pointer state and support focus", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /const \[hoveredNode, setHoveredNode\] =\s*useState<WorkflowNodeId \| null>\(null\);/
  );
  assert.match(
    source,
    /const \[focusedNode, setFocusedNode\] =\s*useState<WorkflowNodeId \| null>\(null\);/
  );
  for (const [id, label] of [
    ["A", "Source Material"],
    ["B", "Source-Linked Report"],
    ["C", "Living Wiki"],
    ["D", "Research Plan"],
  ]) {
    assert.match(
      source,
      new RegExp(`onMouseEnter=\\{\\(\\) => setHoveredNode\\("${id}"\\)\\}`)
    );
    assert.match(
      source,
      new RegExp(`onFocus=\\{\\(\\) => setFocusedNode\\("${id}"\\)\\}`)
    );
    assert.match(source, new RegExp(`aria-label="${label}"`));
  }
  assert.equal(source.match(/tabIndex=\{0\}/g)?.length, 4);
  assert.equal(
    source.match(/onMouseLeave=\{\(\) => setHoveredNode\(null\)\}/g)?.length,
    4
  );
  assert.equal(
    source.match(/onBlur=\{\(\) => setFocusedNode\(null\)\}/g)?.length,
    4
  );
  assert.equal(source.match(/activeNode === "[ABCD]"/g)?.length, 8);
  assert.doesNotMatch(source, /hoveredNode === "[ABCD]"/);
  assert.match(source, /\{!activeNode &&\s*"Hover or focus nodes/);
});

test("phase 2 workflow semantics respect accessibility motion settings", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.equal(source.match(/role="group"/g)?.length, 4);
  assert.equal(source.match(/workflow-node w-36 cursor-pointer/g)?.length, 4);
  for (const label of [
    "Source Material",
    "Living Wiki",
    "Research Plan",
    "Source-Linked Report",
  ]) {
    assert.match(
      source,
      new RegExp(
        `role="group"[\\s\\S]{0,600}aria-label="${label}"[\\s\\S]{0,160}"workflow-node`
      )
    );
  }
  assert.match(
    source,
    /Node Tree Visualizer[\s\S]{0,350}<svg[\s\S]{0,250}aria-hidden="true"[\s\S]{0,100}focusable="false"/
  );
  assert.match(
    source,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.workflow-route\s*\{\s*transition:\s*none;\s*\}[\s\S]*?\.workflow-node\s*\{\s*transition:\s*none;\s*transform:\s*none;\s*\}[\s\S]*?\.workflow-particle\s*\{\s*display:\s*none;\s*\}/
  );
});

test("launch slide keeps its content wrapper without sticky-tail layout", async () => {
  const source = await readFile(introPagePath, "utf8");
  const launchStart = source.indexOf('id="launch"');
  const launchEnd = source.indexOf("</section>", launchStart);
  const launch = source.slice(launchStart, launchEnd);

  assert.notEqual(launchStart, -1);
  assert.match(launch, /className="launch-content relative z-10 max-w-3xl"/);
  assert.match(launch, /Designed for Human Oversight/);
  assert.equal(
    launch.match(/https:\/\/medium\.com\/@jerry\.shao\//g)?.length,
    2
  );
  assert.doesNotMatch(launch, /sticky|lg:-mt-|data-scroll-reveal/);
});

test("phase navigation keeps semantic anchors and uses scoped scrolling", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /import\s*\{\s*navigateToIntroPhase,\s*type IntroPhaseId,?\s*\}\s*from "\.\/phase-navigation";/
  );
  assert.match(
    source,
    /const handlePhaseNavigation = \(\s*event: React\.MouseEvent<HTMLAnchorElement>,\s*phaseId: IntroPhaseId\s*\) => \{\s*navigateToIntroPhase\(event, phaseId\);\s*\};/
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
  assert.doesNotMatch(source, /scroll-behavior\s*:\s*smooth/);
  assert.doesNotMatch(source, /addEventListener\("popstate"/);
});
