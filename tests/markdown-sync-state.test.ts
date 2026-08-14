import assert from "node:assert/strict";
import test from "node:test";

import * as syncState from "../src/features/markdown-sync/application/sync-state-machine";

test("backend mirror retry delay grows from four seconds and caps at one minute", () => {
  const retryDelay = Reflect.get(syncState, "backendMirrorRetryDelay");
  assert.equal(typeof retryDelay, "function");
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((failureCount) => retryDelay(failureCount)),
    [4_000, 8_000, 16_000, 32_000, 60_000, 60_000]
  );
});

test("explicit empty remote markdown clears stale local content while absence does not", () => {
  const shouldApplyRemoteMarkdown = Reflect.get(
    syncState,
    "shouldApplyRemoteMarkdown"
  );
  assert.equal(typeof shouldApplyRemoteMarkdown, "function");
  assert.equal(shouldApplyRemoteMarkdown("", "stale local", null), true);
  assert.equal(shouldApplyRemoteMarkdown(null, "stale local", null), false);

  const acceptRemoteMarkdown = Reflect.get(syncState, "acceptRemoteMarkdown");
  const staleState = {
    version: 4,
    content: "stale local",
    pendingWrite: null,
    lastSynced: null,
  };
  assert.deepEqual(acceptRemoteMarkdown(staleState, "", 4), {
    version: 5,
    content: "",
    pendingWrite: null,
    lastSynced: "",
  });
  assert.equal(acceptRemoteMarkdown(staleState, null, 4), staleState);
});
