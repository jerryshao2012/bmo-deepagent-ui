import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_STREAM_OPTIONS } from "../src/app/hooks/chat-stream-options";

test("chat stream options disable persisted history and preserve live streaming", () => {
  assert.deepEqual(CHAT_STREAM_OPTIONS, {
    reconnectOnMount: true,
    fetchStateHistory: false,
    filterSubagentMessages: true,
  });
  assert.equal(Object.isFrozen(CHAT_STREAM_OPTIONS), true);
});
