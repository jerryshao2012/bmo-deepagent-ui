import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessedMessage } from "../src/app/utils/processMessages";
import { selectParallelResearchProgress } from "../src/app/utils/parallel-research-progress";

function message(
  toolCalls: ProcessedMessage["toolCalls"]
): ProcessedMessage {
  return {
    message: { id: "message", type: "ai", content: "" } as never,
    toolCalls,
    showAvatar: true,
  };
}

function researchCall(
  status: ProcessedMessage["toolCalls"][number]["status"]
) {
  return {
    id: crypto.randomUUID(),
    name: "task",
    args: { subagent_type: "research-agent" },
    status,
  };
}

test("returns completed count for active parallel research batch", () => {
  assert.deepEqual(
    selectParallelResearchProgress([
      message([
        researchCall("completed"),
        researchCall("completed"),
        researchCall("pending"),
      ]),
    ]),
    { completed: 2, total: 3 }
  );
});

test("uses latest qualifying batch instead of older active batch", () => {
  assert.deepEqual(
    selectParallelResearchProgress([
      message([researchCall("completed"), researchCall("pending")]),
      message([
        researchCall("completed"),
        researchCall("completed"),
        researchCall("pending"),
      ]),
    ]),
    { completed: 2, total: 3 }
  );
});

test("returns null after latest qualifying batch completes", () => {
  assert.equal(
    selectParallelResearchProgress([
      message([researchCall("completed"), researchCall("pending")]),
      message([researchCall("completed"), researchCall("completed")]),
    ]),
    null
  );
});

test("treats error and interrupted calls as terminal without completing them", () => {
  assert.equal(
    selectParallelResearchProgress([
      message([
        researchCall("completed"),
        researchCall("error"),
        researchCall("interrupted"),
      ]),
    ]),
    null
  );
});

test("ignores single research and non-research task calls", () => {
  assert.equal(
    selectParallelResearchProgress([
      message([researchCall("pending")]),
      message([
        {
          id: "task-1",
          name: "task",
          args: { subagent_type: "general-agent" },
          status: "pending",
        },
        {
          id: "task-2",
          name: "task",
          args: { subagent_type: "general-agent" },
          status: "pending",
        },
      ]),
    ]),
    null
  );
});
