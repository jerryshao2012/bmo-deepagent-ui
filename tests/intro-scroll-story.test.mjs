import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const introPagePath = new URL("../src/app/intro/page.tsx", import.meta.url);

test("intro phases form three progressive sticky scroll chapters", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.equal(source.match(/^\s*data-scroll-chapter\s*$/gm)?.length, 3);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /--chapter-progress/);
  assert.match(source, /className="chapter-sticky/);
  assert.match(source, /chapter-copy/);
  assert.match(source, /chapter-visual/);
  assert.match(source, /chapter-reveal/);
});

test("intro scroll story keeps accessible motion fallbacks", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /@media \(max-width: 1023px\)/);
  assert.match(source, /scroll-margin-top/);
});

test("intro page keeps document as the only vertical scroll container", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /min-h-screen overflow-x-clip/);
  assert.doesNotMatch(source, /min-h-screen overflow-x-hidden/);
});

test("hero preview begins after the first viewport", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /hero-copy[^\n]*min-h-\[calc\(100svh-11rem\)\][^\n]*justify-center/
  );
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

test("closing section replaces the empty tail and centers its content", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(
    source,
    /data-scroll-reveal[\s\S]{0,220}lg:-mt-\[calc\(40vh-3rem\)\][\s\S]{0,100}lg:min-h-\[calc\(100vh-3rem\)\]/
  );
  assert.doesNotMatch(source, /-top-\[30vh\][\s\S]{0,80}h-\[30vh\]/);
});
