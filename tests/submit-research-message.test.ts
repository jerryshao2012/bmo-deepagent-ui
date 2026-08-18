import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilityForCurrentThread,
  submitResearchMessage,
} from "../src/app/utils/submit-research-message";

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

test("confirmed true without a thread omits document state", () => {
  const calls: Array<Record<string, unknown>> = [];

  submitResearchMessage({
    message: "Research without thread",
    noWeb: false,
    availability: true,
    threadId: null,
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

test("stale A false cannot override B pending upload evidence", () => {
  const availability = availabilityForCurrentThread({
    availability: false,
    evidence: { threadId: "A", available: false },
    threadId: "B",
  });
  const calls: Array<Record<string, unknown>> = [];

  submitResearchMessage({
    message: "Research B",
    noWeb: false,
    availability,
    threadId: "B",
    pendingDocument: { threadId: "B", docFolder: "docs/threads/B" },
    sendMessage: (_message, values) => calls.push(values),
  });

  assert.deepEqual(calls, [
    { no_web: false, has_documents: true, doc_folder: "docs/threads/B" },
  ]);
});

test("stale A positive cannot leak document state into B", () => {
  const availability = availabilityForCurrentThread({
    availability: true,
    evidence: { threadId: "A", available: true },
    threadId: "B",
  });
  const calls: Array<Record<string, unknown>> = [];

  submitResearchMessage({
    message: "Research B",
    noWeb: false,
    availability,
    threadId: "B",
    sendMessage: (_message, values) => calls.push(values),
  });

  assert.deepEqual(calls, [{ no_web: false }]);
});

test("matching evidence preserves transient unknown availability", () => {
  assert.equal(
    availabilityForCurrentThread({
      availability: null,
      evidence: { threadId: "B", available: true },
      threadId: "B",
    }),
    null
  );
});
