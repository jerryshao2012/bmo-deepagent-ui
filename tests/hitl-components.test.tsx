import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  HitlInterruptPanel,
  type RequirementClarificationInterruptV1,
  type ParsedInterrupt,
} from "../src/features/hitl";

afterEach(cleanup);

const clarification: RequirementClarificationInterruptV1 = {
  kind: "requirement_clarification",
  version: 1,
  request_id: "tool-call-1",
  questions: [
    {
      id: "audience",
      prompt: "Who is this for?",
      type: "single_select",
      required: true,
      options: [
        { id: "exec", label: "Executives", description: "Board-ready" },
        { id: "eng", label: "Engineers" },
      ],
      allow_other: true,
    },
    {
      id: "outputs",
      prompt: "Which outputs?",
      type: "multi_select",
      required: true,
      options: [
        { id: "slides", label: "Slides" },
        { id: "memo", label: "Memo" },
      ],
      allow_other: false,
    },
  ],
};

test("questionnaire validates answers and submits clarification response", () => {
  const submissions: unknown[] = [];
  const parsed: ParsedInterrupt = {
    kind: "requirement_clarification",
    request: { threadId: "thread-1" },
    payload: clarification,
  };

  render(
    <HitlInterruptPanel
      parsedInterrupt={parsed}
      currentThreadId="thread-1"
      isLoading={false}
      onResume={(input) => submissions.push(input)}
    />
  );

  const submit = screen.getByRole("button", { name: "Submit answers" });
  assert.equal(submit.getAttribute("disabled"), "");

  fireEvent.click(screen.getByLabelText("Executives"));
  fireEvent.click(screen.getByLabelText("Slides"));
  fireEvent.click(screen.getByLabelText("Memo"));
  fireEvent.change(screen.getByLabelText("Other answer for Who is this for?"), {
    target: { value: "C-suite" },
  });
  fireEvent.click(submit);

  assert.deepEqual(submissions, [
    {
      threadId: "thread-1",
      value: {
        kind: "requirement_clarification_response",
        version: 1,
        request_id: "tool-call-1",
        skipped: false,
        answers: [
          {
            question_id: "audience",
            selected_option_ids: ["exec"],
            other_text: "C-suite",
          },
          {
            question_id: "outputs",
            selected_option_ids: ["slides", "memo"],
            other_text: null,
          },
        ],
      },
    },
  ]);
});

test("questionnaire can skip with empty answer list", () => {
  const submissions: unknown[] = [];
  const parsed: ParsedInterrupt = {
    kind: "requirement_clarification",
    request: { threadId: "thread-1" },
    payload: clarification,
  };

  render(
    <HitlInterruptPanel
      parsedInterrupt={parsed}
      currentThreadId="thread-1"
      isLoading={false}
      onResume={(input) => submissions.push(input)}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Skip and continue" }));

  assert.deepEqual(submissions, [
    {
      threadId: "thread-1",
      value: {
        kind: "requirement_clarification_response",
        version: 1,
        request_id: "tool-call-1",
        skipped: true,
        answers: [],
      },
    },
  ]);
});

test("approval wizard accumulates duplicate tool-name decisions by original index", () => {
  const submissions: unknown[] = [];
  const parsed: ParsedInterrupt = {
    kind: "action_review",
    request: { threadId: "thread-2" },
    actions: [
      {
        index: 0,
        request: { name: "search", args: { q: "first" }, description: "first" },
        config: { actionName: "search", allowedDecisions: ["approve"] },
      },
      {
        index: 1,
        request: {
          name: "search",
          args: { q: "second" },
          description: "second",
        },
        config: { actionName: "search", allowedDecisions: ["reject"] },
      },
    ],
  };

  render(
    <HitlInterruptPanel
      parsedInterrupt={parsed}
      currentThreadId="thread-2"
      isLoading={false}
      onResume={(input) => submissions.push(input)}
    />
  );

  assert.ok(screen.getByText("Action 1 of 2"));
  assert.ok(screen.getByText("first"));
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  assert.ok(screen.getByText("Action 2 of 2"));
  fireEvent.change(screen.getByLabelText("Response to reviewer"), {
    target: { value: "Too broad" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit decisions" }));

  assert.deepEqual(submissions, [
    {
      threadId: "thread-2",
      value: {
        decisions: [
          { type: "approve" },
          { type: "reject", message: "Too broad" },
        ],
      },
    },
  ]);
});

test("stale thread interrupt renders explicit blocked state", () => {
  const parsed: ParsedInterrupt = {
    kind: "unsupported",
    request: { threadId: "old-thread" },
    reason: "Unsupported interrupt payload.",
    value: {},
  };

  render(
    <HitlInterruptPanel
      parsedInterrupt={parsed}
      currentThreadId="new-thread"
      isLoading={false}
      onResume={() => {
        throw new Error("must not resume stale thread");
      }}
    />
  );

  assert.ok(screen.getByText("Thread Changed"));
});
