import assert from "node:assert/strict";
import test from "node:test";

import { LangGraphRunExecutor } from "../src/features/chat/infrastructure/langgraph-run-executor";

test("adds subgraph streaming to every submission without changing caller options", () => {
  const submissions: Array<{ values: unknown; options: unknown }> = [];
  const stream = {
    submit(values?: unknown, options?: unknown) {
      submissions.push({ values, options });
    },
    stop() {},
  };
  const executor = new LangGraphRunExecutor(stream);
  const checkpoint = { checkpoint_id: "checkpoint-1" };
  const optimisticValues = { messages: [{ type: "human", content: "hello" }] };

  executor.submit(
    { messages: [] },
    {
      config: { recursion_limit: 100 },
      checkpoint,
      command: { resume: "approved" },
      interruptAfter: ["tools"],
      optimisticValues,
    }
  );
  executor.submit(undefined);

  assert.deepEqual(submissions, [
    {
      values: { messages: [] },
      options: {
        config: { recursion_limit: 100 },
        checkpoint,
        command: { resume: "approved" },
        interruptAfter: ["tools"],
        optimisticValues,
        streamSubgraphs: true,
      },
    },
    {
      values: undefined,
      options: { streamSubgraphs: true },
    },
  ]);
});
