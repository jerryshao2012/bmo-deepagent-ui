import assert from "node:assert/strict";
import test from "node:test";

import { submitResearchMessage } from "../src/app/utils/submit-research-message";

for (const testCase of [
  {
    name: "unknown availability without matching pending document",
    availability: null,
    pendingDocFolder: undefined,
    expected: { no_web: false },
  },
  {
    name: "confirmed false availability",
    availability: false,
    pendingDocFolder: undefined,
    expected: { no_web: true, has_documents: false, doc_folder: null },
  },
  {
    name: "confirmed true availability",
    availability: true,
    threadId: "thread-a",
    pendingDocFolder: undefined,
    expected: {
      no_web: false,
      has_documents: true,
      doc_folder: "docs/threads/thread-a",
    },
  },
  {
    name: "pending document folder",
    availability: null,
    threadId: "thread-a",
    pendingDocument: {
      threadId: "thread-a",
      docFolder: "docs/threads/thread-a",
    },
    expected: {
      no_web: false,
      has_documents: true,
      doc_folder: "docs/threads/thread-a",
    },
  },
] as const) {
  test(`submits exactly once for ${testCase.name}`, () => {
    const calls: Array<[string, Record<string, unknown>]> = [];

    const result = submitResearchMessage({
      message: "Find evidence",
      noWeb: testCase.expected.no_web,
      availability: testCase.availability,
      threadId: "threadId" in testCase ? testCase.threadId : "existing-thread",
      pendingDocument:
        "pendingDocument" in testCase ? testCase.pendingDocument : undefined,
      sendMessage: (message, values) => {
        calls.push([message, values]);
        return "sent";
      },
    });

    assert.equal(result, "sent");
    assert.deepEqual(calls, [["Find evidence", testCase.expected]]);
  });
}

test("does not apply another thread's pending document folder", () => {
  const calls: Array<Record<string, unknown>> = [];

  submitResearchMessage({
    message: "Research B",
    noWeb: false,
    availability: null,
    threadId: "B",
    pendingDocument: {
      threadId: "A",
      docFolder: "docs/threads/A",
    },
    sendMessage: (_message, values) => calls.push(values),
  });

  assert.deepEqual(calls, [{ no_web: false }]);
});

test("confirmed false ignores a same-thread pending document folder", () => {
  const calls: Array<Record<string, unknown>> = [];

  submitResearchMessage({
    message: "Research A",
    noWeb: true,
    availability: false,
    threadId: "A",
    pendingDocument: {
      threadId: "A",
      docFolder: "docs/threads/A",
    },
    sendMessage: (_message, values) => calls.push(values),
  });

  assert.deepEqual(calls, [
    { no_web: true, has_documents: false, doc_folder: null },
  ]);
});
