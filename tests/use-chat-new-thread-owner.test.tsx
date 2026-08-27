import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { useQueryState } from "nuqs";

import { useChat } from "../src/app/hooks/useChat";
import { ClientContext } from "../src/providers/ClientContext";

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.sessionStorage.clear();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("installed SDK promotes queued new-thread work after thread-1 assignment", async () => {
  const createdThread = deferred<{ thread_id: string }>();
  const firstRun = deferred<void>();
  const streamedThreadIds: string[] = [];
  const cancelCalls: Array<[string, string]> = [];
  let firstSignal: AbortSignal | undefined;
  let streamCount = 0;
  const client = {
    threads: {
      create: async () => createdThread.promise,
      getState: async () => ({
        values: { messages: [], todos: [], files: {} },
      }),
    },
    runs: {
      stream(
        threadId: string,
        _assistantId: string,
        options: {
          onDisconnect?: string;
          onRunCreated?: (run: { run_id: string; thread_id: string }) => void;
          signal?: AbortSignal;
        }
      ) {
        streamedThreadIds.push(threadId);
        streamCount += 1;
        const isFirstRun = streamCount === 1;
        if (isFirstRun) {
          assert.equal(options.onDisconnect, "continue");
          firstSignal = options.signal;
          options.onRunCreated?.({ run_id: "run-1", thread_id: threadId });
        }
        return {
          async next() {
            if (isFirstRun) await firstRun.promise;
            return { done: true, value: undefined };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
      cancel: async (threadId: string, runId: string) => {
        cancelCalls.push([threadId, runId]);
      },
    },
  } as never;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={{}}>
      <ClientContext.Provider value={{ client }}>
        {children}
      </ClientContext.Provider>
    </NuqsTestingAdapter>
  );
  const { result } = renderHook(() => useChat({ activeAssistant: null }), {
    wrapper,
  });

  act(() => {
    result.current.sendMessage("first");
    result.current.sendMessage("queued before ID");
  });
  await waitFor(() => assert.equal(streamCount, 0));
  await act(async () => {
    createdThread.resolve({ thread_id: "thread-1" });
    await createdThread.promise;
  });
  await waitFor(() => assert.deepEqual(streamedThreadIds, ["thread-1"]));

  act(() => result.current.stopStream());
  await waitFor(() => assert.equal(firstSignal?.aborted, true));
  await waitFor(() => assert.deepEqual(cancelCalls, [["thread-1", "run-1"]]));

  firstRun.resolve();
  await waitFor(() =>
    assert.deepEqual(streamedThreadIds, ["thread-1", "thread-1"])
  );
});

test("installed SDK stop cancels a rejoined server run without an executor submission", async () => {
  const rejoinedRunFinished = deferred<void>();
  const cancelCalls: Array<[string, string]> = [];
  let localSignal: AbortSignal | undefined;
  let rejoinedSignal: AbortSignal | undefined;
  let joinCalls = 0;
  const client = {
    threads: {
      getState: async () => ({
        values: { messages: [], todos: [], files: {} },
      }),
    },
    runs: {
      stream(
        threadId: string,
        _assistantId: string,
        options: {
          onRunCreated?: (run: { run_id: string; thread_id: string }) => void;
          signal?: AbortSignal;
        }
      ) {
        assert.equal(threadId, "A");
        localSignal = options.signal;
        options.onRunCreated?.({ run_id: "run-A", thread_id: "A" });
        const localAbort = new Promise<never>((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("local stream aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true }
          );
        });
        return {
          async next() {
            return localAbort;
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
      joinStream(
        threadId: string,
        runId: string,
        options: { signal?: AbortSignal }
      ) {
        assert.equal(threadId, "A");
        assert.equal(runId, "run-A");
        joinCalls += 1;
        rejoinedSignal = options.signal;
        options.signal?.addEventListener("abort", () =>
          rejoinedRunFinished.resolve()
        );
        return {
          async next() {
            await rejoinedRunFinished.promise;
            return { done: true, value: undefined };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
      cancel: async (threadId: string, runId: string) => {
        cancelCalls.push([threadId, runId]);
      },
    },
  } as never;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={{ threadId: "A" }}>
      <ClientContext.Provider value={{ client }}>
        {children}
      </ClientContext.Provider>
    </NuqsTestingAdapter>
  );
  const { result } = renderHook(
    () => {
      const chat = useChat({ activeAssistant: null });
      const [threadId, setThreadId] = useQueryState("threadId");
      return { chat, threadId, setThreadId };
    },
    { wrapper }
  );

  act(() => result.current.chat.sendMessage("start A run"));
  await waitFor(() => assert.equal(localSignal?.aborted, false));
  await waitFor(() =>
    assert.equal(window.sessionStorage.getItem("lg:stream:A"), "run-A")
  );
  await act(async () => {
    await result.current.setThreadId("B");
  });
  await waitFor(() => assert.equal(localSignal?.aborted, true));
  await act(async () => {
    await result.current.setThreadId("A");
  });
  await waitFor(() => assert.equal(joinCalls, 1));

  act(() => result.current.chat.stopStream());
  await waitFor(() => assert.equal(rejoinedSignal?.aborted, true));
  await waitFor(() => assert.deepEqual(cancelCalls, [["A", "run-A"]]));
});

test("resume interrupt submits typed value on owning thread with HITL config", async () => {
  const streamed: Array<{
    threadId: string;
    options: Record<string, unknown>;
  }> = [];
  const client = {
    threads: {
      getState: async () => ({
        values: { messages: [], todos: [], files: {} },
      }),
    },
    runs: {
      stream(
        threadId: string,
        _assistantId: string,
        options: Record<string, unknown>
      ) {
        streamed.push({ threadId, options });
        return {
          async next() {
            return { done: true, value: undefined };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    },
  } as never;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={{ threadId: "A" }}>
      <ClientContext.Provider value={{ client }}>
        {children}
      </ClientContext.Provider>
    </NuqsTestingAdapter>
  );
  const { result } = renderHook(
    () =>
      useChat({
        activeAssistant: {
          assistant_id: "assistant-1",
          config: {
            configurable: {
              model: "gemma",
              client_capabilities: { markdown_preview: 1 },
            },
          },
        } as never,
      }),
    { wrapper }
  );
  const resumeValue = {
    decisions: [{ type: "approve" }],
  };

  act(() => {
    result.current.resumeInterrupt({ threadId: "A", value: resumeValue });
  });

  await waitFor(() => assert.equal(streamed.length, 1));
  assert.equal(streamed[0].threadId, "A");
  assert.deepEqual(streamed[0].options.command, { resume: resumeValue });
  assert.deepEqual(streamed[0].options.config, {
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

test("resume interrupt rejects stale thread submissions", async () => {
  const streamed: unknown[] = [];
  const client = {
    threads: {
      getState: async () => ({
        values: { messages: [], todos: [], files: {} },
      }),
    },
    runs: {
      stream() {
        streamed.push("unexpected");
        return {
          async next() {
            return { done: true, value: undefined };
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    },
  } as never;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={{ threadId: "A" }}>
      <ClientContext.Provider value={{ client }}>
        {children}
      </ClientContext.Provider>
    </NuqsTestingAdapter>
  );
  const { result } = renderHook(() => useChat({ activeAssistant: null }), {
    wrapper,
  });

  assert.throws(
    () =>
      result.current.resumeInterrupt({
        threadId: "B",
        value: { decisions: [{ type: "approve" }] },
      }),
    /stale interrupt/i
  );
  assert.deepEqual(streamed, []);
});
