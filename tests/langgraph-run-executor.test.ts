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

  assert.deepEqual(
    submissions.map(({ values, options }) => {
      const { onError: _onError, ...callerOptions } = options as Record<
        string,
        unknown
      >;
      return { values, options: callerOptions };
    }),
    [
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
    ]
  );
  assert.equal(
    submissions.every(
      ({ options }) =>
        typeof (options as { onError?: unknown }).onError === "function"
    ),
    true
  );
});

test("uses per-submit errors to retire a rejected A before B is created", () => {
  const submissions: Array<{ onError?: (error: unknown) => void }> = [];
  const executor = new LangGraphRunExecutor({
    submit(_values, options) {
      submissions.push(options as { onError?: (error: unknown) => void });
    },
    stop() {},
  });
  const accepted: string[] = [];

  assert.equal(
    executor.submit(undefined, undefined, {
      onAccepted: () => accepted.push("A"),
    }),
    undefined
  );
  executor.submit(undefined, undefined, {
    onAccepted: () => accepted.push("B"),
  });

  submissions[0].onError?.(new Error("run creation rejected"));
  executor.onRunCreated("run-b");

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
