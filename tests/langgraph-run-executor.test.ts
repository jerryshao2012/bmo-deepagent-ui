import assert from "node:assert/strict";
import test from "node:test";

import { LangGraphRunExecutor } from "../src/features/chat/infrastructure/langgraph-run-executor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

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

test("does not leak a rejected submission acceptance callback into a later run", async () => {
  const firstSubmission = deferred<void>();
  const secondSubmission = deferred<void>();
  const submissions = [firstSubmission, secondSubmission];
  const executor = new LangGraphRunExecutor({
    submit() {
      return submissions.shift()?.promise;
    },
    stop() {},
  });
  const accepted: string[] = [];

  const first = executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  const second = executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });

  firstSubmission.reject(new Error("run creation rejected"));
  await assert.rejects(first, /run creation rejected/);
  executor.acceptNextRun("run-b");
  executor.acceptNextRun("run-b");
  secondSubmission.resolve();
  await second;

  assert.deepEqual(accepted, ["B"]);
});
