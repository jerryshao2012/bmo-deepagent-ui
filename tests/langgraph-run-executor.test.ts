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

test("keeps queued B bound to its committed stream after a later C stream commits", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  const aSubmissions: unknown[] = [];
  const bSubmissions: Array<{ values: unknown; options: unknown }> = [];
  const cSubmissions: unknown[] = [];
  const aStream = {
    submit(values?: unknown) {
      aSubmissions.push(values);
      return a.promise;
    },
    stop() {},
  };
  const bStream = {
    submit(values?: unknown, options?: unknown) {
      bSubmissions.push({ values, options });
      return b.promise;
    },
    stop() {},
  };
  const cStream = {
    submit(values?: unknown) {
      cSubmissions.push(values);
    },
    stop() {},
  };
  const executor = new LangGraphRunExecutor(aStream);
  const accepted: string[] = [];

  executor.submit({ messages: ["A"] });
  executor.setStream(bStream);
  executor.submit(
    {
      messages: ["B"],
      has_documents: true,
      doc_folder: "docs/threads/B",
    },
    undefined,
    {
      onAccepted: () => accepted.push("B"),
    }
  );
  executor.setStream(cStream);
  a.resolve();
  await a.promise;
  await Promise.resolve();

  assert.deepEqual(aSubmissions, [{ messages: ["A"] }]);
  assert.deepEqual(bSubmissions, [
    {
      values: {
        messages: ["B"],
        has_documents: true,
        doc_folder: "docs/threads/B",
      },
      options: { streamSubgraphs: true },
    },
  ]);
  assert.deepEqual(cSubmissions, []);

  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;

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
  executor.onRunCreated("run-a");
  assert.deepEqual(accepted, ["A"]);
  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;

  assert.deepEqual(accepted, ["A", "B"]);
});

test("stop targets the in-flight stream while queued work retains its own stream", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  let aStops = 0;
  let bStops = 0;
  let aSubmits = 0;
  let bSubmits = 0;
  const aStream = {
    submit() {
      aSubmits += 1;
      return a.promise;
    },
    stop() {
      aStops += 1;
    },
  };
  const bStream = {
    submit() {
      bSubmits += 1;
      return b.promise;
    },
    stop() {
      bStops += 1;
    },
  };
  const executor = new LangGraphRunExecutor(aStream);

  executor.submit();
  executor.setStream(bStream);
  executor.submit();
  executor.stop();
  assert.equal(aStops, 1);
  assert.equal(bStops, 0);
  assert.equal(aSubmits, 1);
  assert.equal(bSubmits, 0);

  a.resolve();
  await a.promise;
  await Promise.resolve();
  assert.equal(bSubmits, 1);
  b.resolve();
  await b.promise;
});

test("keeps queued work on its captured handle across a same-thread rerender", async () => {
  const a = deferred<void>();
  const b = deferred<void>();
  let firstBSubmits = 0;
  let refreshedBSubmits = 0;
  const executor = new LangGraphRunExecutor({
    submit() {
      return a.promise;
    },
    stop() {},
  });
  const firstBStream = {
    submit() {
      firstBSubmits += 1;
      return b.promise;
    },
    stop() {},
  };
  const refreshedBStream = {
    submit() {
      refreshedBSubmits += 1;
    },
    stop() {},
  };

  executor.submit({ messages: ["A"] });
  executor.setStream(firstBStream);
  executor.submit({ messages: ["B"] });
  executor.setStream(refreshedBStream);
  a.resolve();
  await a.promise;
  await Promise.resolve();

  assert.equal(firstBSubmits, 1);
  assert.equal(refreshedBSubmits, 0);
  b.resolve();
  await b.promise;
});

test("bounds remembered created run IDs while retaining terminal duplicate protection", async () => {
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

  for (let index = 0; index < 129; index += 1) {
    executor.onRunCreated(`previous-${index}`);
  }
  assert.equal(
    (executor as unknown as { createdRunIds: Map<string, undefined> })
      .createdRunIds.size,
    128
  );

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("A"),
  });
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });
  executor.onRunCreated("run-a");
  a.resolve();
  await a.promise;
  await Promise.resolve();
  executor.onRunCreated("run-a");
  assert.deepEqual(accepted, ["A"]);
  executor.onRunCreated("run-b");
  b.resolve();
  await b.promise;

  assert.deepEqual(accepted, ["A", "B"]);
});

test("refreshes duplicate created-run IDs so LRU evicts the actual oldest ID", () => {
  const executor = new LangGraphRunExecutor({ submit() {}, stop() {} });
  const accepted: string[] = [];

  for (let index = 0; index < 128; index += 1) {
    executor.onRunCreated(`cached-${index}`);
  }
  executor.onRunCreated("cached-0");
  executor.onRunCreated("cached-128");

  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("accepted"),
  });
  executor.onRunCreated("cached-0");
  assert.deepEqual(accepted, []);
  executor.onRunCreated("cached-1");

  assert.deepEqual(accepted, ["accepted"]);
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
