import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("markdown synchronization has state, cache, and backend boundaries", async () => {
  for (const file of [
    "src/features/markdown-sync/application/markdown-sync-store.ts",
    "src/features/markdown-sync/application/sync-state-machine.ts",
    "src/features/markdown-sync/infrastructure/browser-markdown-sync-store.ts",
    "src/features/markdown-sync/infrastructure/backend-markdown-sync-store.ts",
  ]) {
    await assert.doesNotReject(readFile(file, "utf8"), `${file} must exist`);
  }
});

test("intro presentation does not own backend HTTP or cache keys", async () => {
  const source = await readFile("src/app/intro/page.tsx", "utf8");
  assert.doesNotMatch(source, /authenticatedFetch/);
  assert.doesNotMatch(source, /`markdown_thread_\$\{/);
});

test("custom runtime declares server boundary modules", async () => {
  const server = await readFile("server.cjs", "utf8");
  for (const module of [
    "bootstrap",
    "transport",
    "state",
    "persistence",
    "images",
    "websocket-heartbeat",
  ]) {
    await assert.doesNotReject(
      readFile(`runtime/${module}.cjs`, "utf8"),
      `runtime/${module}.cjs must exist`
    );
    assert.match(server, new RegExp(`runtime/${module}`));
  }
});
