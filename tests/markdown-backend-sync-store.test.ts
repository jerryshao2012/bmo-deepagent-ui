import assert from "node:assert/strict";
import test from "node:test";

import { BackendMarkdownSyncStore } from "../src/features/markdown-sync/infrastructure/backend-markdown-sync-store";

test("backend markdown load distinguishes missing state from an explicit empty tombstone", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [{ values: {} }, { values: { markdown_content: "" } }];
  globalThis.fetch = async () =>
    new Response(JSON.stringify(responses.shift()), {
      headers: { "Content-Type": "application/json" },
    });

  try {
    const store = new BackendMarkdownSyncStore("https://backend.test", "token");
    assert.equal(await store.load("111111"), null);
    assert.equal(await store.load("111111"), "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
