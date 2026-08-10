import assert from "node:assert/strict";
import test from "node:test";

import runtimeState from "../runtime/state.cjs";

test("persisted server markdown wins over stale browser content", () => {
  assert.equal(typeof runtimeState.resolveInitialMarkdown, "function");
  assert.deepEqual(
    runtimeState.resolveInitialMarkdown("server copy", "stale browser copy"),
    { content: "server copy", seededFromClient: false }
  );
});

test("browser markdown seeds an empty server thread", () => {
  assert.equal(typeof runtimeState.resolveInitialMarkdown, "function");
  assert.deepEqual(
    runtimeState.resolveInitialMarkdown(null, "browser copy", false),
    {
      content: "browser copy",
      seededFromClient: true,
    }
  );
});

test("authoritative empty server markdown rejects stale browser content", () => {
  assert.deepEqual(
    runtimeState.resolveInitialMarkdown("", "stale browser copy", true),
    { content: "", seededFromClient: false }
  );
});

test("markdown IDs contain exactly six digits", () => {
  assert.equal(typeof runtimeState.isValidMarkdownId, "function");
  assert.equal(runtimeState.isValidMarkdownId("123456"), true);
  assert.equal(runtimeState.isValidMarkdownId("12345"), false);
  assert.equal(runtimeState.isValidMarkdownId("1234567"), false);
  assert.equal(runtimeState.isValidMarkdownId("abc123"), false);
});

test("pending server writes win over stale disk content", () => {
  assert.equal(typeof runtimeState.resolveServerMarkdown, "function");
  assert.deepEqual(
    runtimeState.resolveServerMarkdown(
      undefined,
      "unflushed update",
      "stale disk",
      true
    ),
    { content: "unflushed update", exists: true, readable: true }
  );
});

test("pending empty content is an authoritative deletion tombstone", () => {
  assert.equal(typeof runtimeState.resolveServerMarkdown, "function");
  assert.deepEqual(
    runtimeState.resolveServerMarkdown(undefined, "", "stale disk", true),
    { content: "", exists: true, readable: true }
  );
});

test("missing server state remains distinguishable from empty content", () => {
  assert.deepEqual(
    runtimeState.resolveServerMarkdown(undefined, undefined, undefined, false),
    { content: "", exists: false, readable: true }
  );
});

test("disk read failures cannot masquerade as authoritative empty content", () => {
  assert.deepEqual(
    runtimeState.resolveServerMarkdown(undefined, undefined, null, true),
    { content: "", exists: true, readable: false }
  );
});
