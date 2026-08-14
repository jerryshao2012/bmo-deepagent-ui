import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKDOWN_PREVIEW_CLOSE_SELECTOR,
  shouldRecordMarkdownActivity,
} from "../src/features/markdown-sync/application/preview-activity";

function targetWithClosest(matchesClose: boolean): EventTarget {
  return {
    closest(selector: string) {
      assert.equal(selector, MARKDOWN_PREVIEW_CLOSE_SELECTOR);
      return matchesClose ? { selector } : null;
    },
  } as unknown as EventTarget;
}

test("preview activity accepts ordinary panel targets and direct mutations", () => {
  assert.equal(shouldRecordMarkdownActivity(null), true);
  assert.equal(shouldRecordMarkdownActivity(new EventTarget()), true);
  assert.equal(shouldRecordMarkdownActivity(targetWithClosest(false)), true);
});

test("preview activity ignores close control and nested close descendants", () => {
  assert.equal(shouldRecordMarkdownActivity(targetWithClosest(true)), false);
});
