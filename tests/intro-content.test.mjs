import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const introPagePath = new URL("../src/app/intro/page.tsx", import.meta.url);

test("intro content presents the implemented document-grounded research workflow", async () => {
  const source = await readFile(introPagePath, "utf8");
  const normalizedSource = source.replace(/\s+/g, " ");

  assert.match(source, /Enterprise Research Workspace/);
  assert.match(source, /Turn enterprise documents into/);
  assert.match(source, /Turn source material into a living research workspace/);
  assert.match(source, /Plan bounded research across documents and the web/);
  assert.match(source, /Inspect evidence before you use the result/);
  assert.match(source, /Source-Linked Evidence/);
  assert.match(source, /Human-Reviewed Skills/);
  assert.match(source, /Designed for Human Oversight/);
  for (const exactCopy of [
    "Applied AI Deep Agent turns reports, policies, research, and presentations into a living thread wiki, then combines document evidence with bounded web research and visible verification.",
    "Upload reports, policies, research, and presentations into an isolated thread. Deep Agent tracks ingestion progress and organizes source material into reusable wiki knowledge.",
    "Deep Agent queries thread knowledge first, delegates targeted web research for remaining gaps, and synthesizes the evidence into a report with visible tasks and state files.",
    "Post-generation review checks citation reachability, report coverage, and missing perspectives. Weak reports can be revised through visible verification rounds before final delivery.",
    "Upload sources, follow research and verification progress, inspect citations, and apply reusable skills in one workspace. Generated outputs remain subject to human review.",
    "Harness Engineering: Building Production-Grade AI Systems Beyond Prompts and Context",
    "Harness Engineering, Part 2: How a Deep Research Agent Becomes a Production System",
  ]) {
    assert.ok(
      normalizedSource.includes(exactCopy),
      `expected preserved copy: ${exactCopy}`
    );
  }
});

test("intro content appears in six-slide narrative order", async () => {
  const source = await readFile(introPagePath, "utf8");
  const markers = [
    "Turn enterprise documents into",
    "BUILDING THREAD KNOWLEDGE",
    "Phase 1: Ground",
    "Phase 2: Research",
    "Phase 3: Review",
    "See how your documents",
  ];
  let previousIndex = -1;

  for (const marker of markers) {
    const markerIndex = source.indexOf(marker, previousIndex + 1);
    assert.ok(markerIndex > previousIndex, `${marker} follows previous slide`);
    previousIndex = markerIndex;
  }
});

test("intro excludes reference-deck editing APIs but retains Collab Markdown UI", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.doesNotMatch(source, /data-editable|InlineEditor|exportFile/);
  assert.match(source, /<textarea/);
  assert.match(source, /onClick=\{handleCopy\}/);
  assert.match(
    source,
    /<TabsTrigger value="preview">Review Markdown<\/TabsTrigger>/
  );
  assert.match(source, /<MarkdownContent/);
  assert.match(source, /data-markdown-preview-close/);
});

test("intro content does not advertise unsupported coding-agent behavior", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.doesNotMatch(source, /deterministic harness/i);
  assert.doesNotMatch(source, /deterministic safety/i);
  assert.doesNotMatch(source, /repository workspace/i);
  assert.doesNotMatch(source, /watches tools execute passively/i);
  assert.doesNotMatch(source, /Docker Sandbox/i);
  assert.doesNotMatch(source, /WASM or Docker/i);
  assert.doesNotMatch(source, /lint check/i);
  assert.doesNotMatch(source, /Syntax Loop Validators/i);
});
