import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/app/components/ChatInterface.tsx", import.meta.url),
  "utf8"
);

test("centers expanded task list without changing other metadata panels", () => {
  assert.match(
    source,
    /className=\{cn\(\s*"px-\[18px\]",\s*metaOpen === "tasks" && "py-2"\s*\)\}/
  );
  assert.match(source, /className="mb-4 last:mb-0"/);
});
