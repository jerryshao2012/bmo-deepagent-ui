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

test("resolved submit without onCreated retires A before B is created", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const submissions = [a, b];
  const executor = new LangGraphRunExecutor({
    submit() {
      return submissions.shift()?.promise;
    },
    stop() {},
  });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  a.resolve();
  await a.promise;
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunCreated("run-b");

  b.resolve();
  await b.promise;

  assert.deepEqual(accepted, ["B"]);
});

test("rejected submit without onCreated retires A before B is created", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const submissions = [a, b];
  const executor = new LangGraphRunExecutor({
    submit() {
      return submissions.shift()?.promise;
    },
    stop() {},
  });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  a.reject(new Error("run creation rejected"));
  await a.promise.catch(() => {});
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunCreated("run-b");

  b.resolve();
  await b.promise;

  assert.deepEqual(accepted, ["B"]);
});

test("uses a no-run terminal signal to retire A before B is created", () => {
  const executor = new LangGraphRunExecutor({ submit() {}, stop() {} });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunError();
  executor.onRunCreated("run-b");

  assert.deepEqual(accepted, ["B"]);
});

test("uses a no-run finish to retire a submission that never created a run", () => {
  const executor = new LangGraphRunExecutor({ submit() {}, stop() {} });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunFinished();
  executor.onRunCreated("run-b");

  assert.deepEqual(accepted, ["B"]);
});

test("keeps queued acceptance across a fresh stream handle", () => {
  const firstHandleSubmissions: unknown[] = [];
  const secondHandleSubmissions: unknown[] = [];
  const firstHandle = {
    submit(_values?: unknown, options?: unknown) {
      firstHandleSubmissions.push(options);
    },
    stop() {},
  };
  const secondHandle = {
    submit(_values?: unknown, options?: unknown) {
      secondHandleSubmissions.push(options);
    },
    stop() {},
  };
  const executor = new LangGraphRunExecutor(firstHandle);
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.setStream(secondHandle);
  executor.onRunCreated("run-a");
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunCreated("run-b");

  assert.equal(firstHandleSubmissions.length, 1);
  assert.equal(secondHandleSubmissions.length, 1);
  assert.deepEqual(accepted, ["A", "B"]);
});

test("accepted A terminal callbacks cannot retire queued B", () => {
  const executor = new LangGraphRunExecutor({ submit() {}, stop() {} });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunCreated("run-a");
  executor.onRunFinished("run-a");
  executor.onRunError("run-a");
  executor.onRunCreated("run-b");

  assert.deepEqual(accepted, ["A", "B"]);
});

test("isolates acceptance callback exceptions from SDK lifecycle", () => {
  const executor = new LangGraphRunExecutor({ submit() {}, stop() {} });

  executor.submit(undefined, undefined, {
    onAccepted: () => {
      throw new Error("callback boom");
    },
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => executor.onRunCreated("run-a"));
  } finally {
    console.error = originalConsoleError;
  }
});
