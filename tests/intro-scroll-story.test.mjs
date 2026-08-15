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
  assert.match(source, /chapter-path/);
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
