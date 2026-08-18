import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React, { type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

import { useChat } from "../src/app/hooks/useChat";
import { ClientContext } from "../src/providers/ClientContext";

afterEach(() => {
  cleanup();
  localStorage.clear();
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
