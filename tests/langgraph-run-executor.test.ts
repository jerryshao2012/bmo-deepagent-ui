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

test("adds subgraph streaming to every serialized submission without changing caller options", async () => {
  const submissions: Array<{ values: unknown; options: unknown }> = [];
  const executor = new LangGraphRunExecutor({
    submit(values?: unknown, options?: unknown) {
      submissions.push({ values, options });
    },
    stop() {},
  });
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
  await Promise.resolve();

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

test("serializes resolved A before starting and accepting B", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const streamResults = [a, b];
  const started: string[] = [];
  const executor = new LangGraphRunExecutor({
    submit() {
      started.push(started.length === 0 ? "A" : "B");
      return streamResults.shift()?.promise;
    },
    stop() {},
  });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  assert.deepEqual(started, ["A"]);

  a.resolve();
  await a.promise;
  await Promise.resolve();
  assert.deepEqual(started, ["A", "B"]);

  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;
  assert.deepEqual(accepted, ["B"]);
});

test("serializes rejected A before starting and accepting B", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const streamResults = [a, b];
  const started: string[] = [];
  const executor = new LangGraphRunExecutor({
    submit() {
      started.push(started.length === 0 ? "A" : "B");
      return streamResults.shift()?.promise;
    },
    stop() {},
  });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  assert.deepEqual(started, ["A"]);

  a.reject(new Error("run creation rejected"));
  await a.promise.catch(() => {});
  await Promise.resolve();
  assert.deepEqual(started, ["A", "B"]);

  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;
  assert.deepEqual(accepted, ["B"]);
});

test("global no-run lifecycle callbacks cannot consume queued B", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const streamResults = [a, b];
  const executor = new LangGraphRunExecutor({
    submit() {
      return streamResults.shift()?.promise;
    },
    stop() {},
  });
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunError();
  executor.onRunFinished();
  a.resolve();
  await a.promise;
  await Promise.resolve();
  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;

  assert.deepEqual(accepted, ["B"]);
});

test("uses refreshed stream handle when starting queued B", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const firstHandleSubmissions: unknown[] = [];
  const secondHandleSubmissions: unknown[] = [];
  const firstHandle = {
    submit(_values?: unknown, options?: unknown) {
      firstHandleSubmissions.push(options);
      return a.promise;
    },
    stop() {},
  };
  const secondHandle = {
    submit(_values?: unknown, options?: unknown) {
      secondHandleSubmissions.push(options);
      return b.promise;
    },
    stop() {},
  };
  const executor = new LangGraphRunExecutor(firstHandle);
  const accepted: string[] = [];

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.setStream(secondHandle);
  a.resolve();
  await a.promise;
  await Promise.resolve();
  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;

  assert.equal(firstHandleSubmissions.length, 1);
  assert.equal(secondHandleSubmissions.length, 1);
  assert.deepEqual(accepted, ["B"]);
});

test("accepted A terminal callbacks cannot retire queued B", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const streamResults = [a, b];
  const executor = new LangGraphRunExecutor({
    submit() {
      return streamResults.shift()?.promise;
    },
    stop() {},
  });
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
  a.resolve();
  await a.promise;
  await Promise.resolve();
  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;

  assert.deepEqual(accepted, ["A", "B"]);
});

test("stop delegates to current stream while preserving queued work", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const streamResults = [a, b];
  let stopCalls = 0;
  let submitCalls = 0;
  const executor = new LangGraphRunExecutor({
    submit() {
      submitCalls += 1;
      return streamResults.shift()?.promise;
    },
    stop() {
      stopCalls += 1;
    },
  });

  executor.submit();
  executor.submit();
  executor.stop();
  assert.equal(stopCalls, 1);
  assert.equal(submitCalls, 1);

  a.resolve();
  await a.promise;
  await Promise.resolve();
  assert.equal(submitCalls, 2);
  b.resolve();
  await b.promise;
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
