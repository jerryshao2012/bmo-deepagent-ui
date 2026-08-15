import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const introPagePath = new URL("../src/app/intro/page.tsx", import.meta.url);

test("intro content presents the implemented document-grounded research workflow", async () => {
  const source = await readFile(introPagePath, "utf8");

  assert.match(source, /Enterprise Research Workspace/);
  assert.match(source, /Turn enterprise documents into/);
  assert.match(source, /Turn source material into a living research workspace/);
  assert.match(source, /Plan bounded research across documents and the web/);
  assert.match(source, /Inspect evidence before you use the result/);
  assert.match(source, /Source-Linked Evidence/);
  assert.match(source, /Human-Reviewed Skills/);
  assert.match(source, /Designed for Human Oversight/);
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
