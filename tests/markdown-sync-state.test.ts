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
