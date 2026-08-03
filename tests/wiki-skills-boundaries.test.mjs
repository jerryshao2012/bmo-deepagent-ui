import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wiki and skills expose application gateways with HTTP adapters", async () => {
  for (const file of [
    "src/features/wiki/application/wiki-gateway.ts",
    "src/features/wiki/infrastructure/http-wiki-gateway.ts",
    "src/features/skills/application/skills-gateway.ts",
    "src/features/skills/infrastructure/http-skills-gateway.ts",
  ]) {
    await assert.doesNotReject(readFile(file, "utf8"), `${file} must exist`);
  }
});

test("presentation and compatibility facades do not own wiki or skills HTTP", async () => {
  for (const file of [
    "src/app/components/WikiTreeViewer.tsx",
    "src/app/components/WikiGraphViewer.tsx",
    "src/lib/skills.ts",
  ]) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /authenticatedFetch/);
  }
});
