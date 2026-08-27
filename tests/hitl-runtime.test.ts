import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApprovalResumeValue,
  buildClarificationResponse,
  mergeHitlConfig,
  parseInterrupt,
} from "../src/features/hitl";
import type { HitlDecision } from "../src/features/hitl";

const clarificationPayload = {
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
      id: "format",
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

test("parses requirement clarification interrupt v1", () => {
  const parsed = parseInterrupt({
    value: clarificationPayload,
    ns: ["tools"],
  });

  assert.equal(parsed.kind, "requirement_clarification");
  assert.equal(parsed.request.threadId, null);
  assert.equal(parsed.payload.request_id, "tool-call-1");
  assert.equal(
    parsed.payload.questions[0].options[0].description,
    "Board-ready"
  );
});

test("parses standard action reviews from snake or camel payloads as ordered arrays", () => {
  const snake = parseInterrupt({
    value: {
      action_requests: [
        { name: "search", args: { q: "one" }, description: "first" },
        { name: "search", args: { q: "two" }, description: "second" },
      ],
      review_configs: [
        { action_name: "search", allowed_decisions: ["approve"] },
        { action_name: "search", allowed_decisions: ["reject", "respond"] },
      ],
    },
  });
  const camel = parseInterrupt({
    value: {
      actionRequests: [{ name: "write_file", args: { path: "x" } }],
      reviewConfigs: [{ actionName: "write_file", allowedDecisions: ["edit"] }],
    },
  });

  assert.equal(snake.kind, "action_review");
  assert.equal(snake.actions[1].request.args.q, "two");
  assert.deepEqual(snake.actions[1].config?.allowedDecisions, [
    "reject",
    "respond",
  ]);
  assert.equal(camel.kind, "action_review");
  assert.equal(camel.actions[0].config?.actionName, "write_file");
});

test("builds clarification answers in question order and skip response", () => {
  const answer = buildClarificationResponse(clarificationPayload, {
    audience: { selectedOptionIds: ["exec"], otherText: "C-suite" },
    format: { selectedOptionIds: ["slides", "memo"], otherText: "" },
  });
  const skipped = buildClarificationResponse(clarificationPayload, {}, true);

  assert.deepEqual(answer, {
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
        question_id: "format",
        selected_option_ids: ["slides", "memo"],
        other_text: null,
      },
    ],
  });
  assert.deepEqual(skipped.answers, []);
  assert.equal(skipped.skipped, true);
});

test("merges HITL capability config without dropping assistant config", () => {
  const merged = mergeHitlConfig({
    recursion_limit: 100,
    configurable: {
      model: "gemma",
      client_capabilities: { markdown_preview: 1 },
    },
  });

  assert.deepEqual(merged, {
    recursion_limit: 100,
    configurable: {
      model: "gemma",
      clarification_mode: "auto",
      client_capabilities: {
        markdown_preview: 1,
        requirement_clarification: 1,
      },
    },
  });
});

test("approval resume builder requires one ordered decision per action", () => {
  const decisions: HitlDecision[] = [
    { type: "approve" },
    { type: "reject", message: "Too broad" },
  ];

  assert.deepEqual(buildApprovalResumeValue(decisions, 2), { decisions });
  assert.throws(
    () => buildApprovalResumeValue([{ type: "approve" }], 2),
    /one decision per action/i
  );
});
