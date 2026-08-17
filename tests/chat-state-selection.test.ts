import assert from "node:assert/strict";
import test from "node:test";
import type { TodoItem } from "../src/app/types/types";
import { selectEffectiveTodos } from "../src/app/hooks/chat-state-selection";
import * as chatStateSelection from "../src/app/hooks/chat-state-selection";

const persistedTodo: TodoItem = {
  id: "persisted",
  content: "Persisted task",
  status: "pending",
};

test("idle stream todos are restored from a confirmed server snapshot", async () => {
  assert.deepEqual(
    selectEffectiveTodos({
      isLoading: false,
      streamTodos: [],
      serverTodos: [persistedTodo],
    }),
    [persistedTodo]
  );
});

test("loading keeps live stream todos authoritative", async () => {
  assert.deepEqual(
    selectEffectiveTodos({
      isLoading: true,
      streamTodos: [],
      serverTodos: [persistedTodo],
    }),
    []
  );
});

test("stream todos remain visible when no server snapshot exists", async () => {
  assert.deepEqual(
    selectEffectiveTodos({
      isLoading: false,
      streamTodos: [persistedTodo],
    }),
    [persistedTodo]
  );
});

test("confirmed empty snapshot is authoritative for its thread", () => {
  assert.deepEqual(
    selectEffectiveTodos({
      isLoading: false,
      streamTodos: [persistedTodo],
      serverTodos: [],
    }),
    []
  );
});

test("mismatched snapshot ownership falls back to live todos", () => {
  assert.equal(
    typeof chatStateSelection.selectServerTodosForThread,
    "function"
  );
  const serverTodos = chatStateSelection.selectServerTodosForThread({
    currentThreadId: "thread-b",
    serverThreadId: "thread-a",
    serverTodos: [{ ...persistedTodo, id: "thread-a-task" }],
  });
  assert.deepEqual(
    selectEffectiveTodos({
      isLoading: false,
      streamTodos: [persistedTodo],
      serverTodos,
    }),
    [persistedTodo]
  );
});

test("matching snapshot ownership returns server todos", () => {
  assert.deepEqual(
    chatStateSelection.selectServerTodosForThread({
      currentThreadId: "thread-a",
      serverThreadId: "thread-a",
      serverTodos: [persistedTodo],
    }),
    [persistedTodo]
  );
});

test("same-thread stale snapshot is rejected while idle", () => {
  assert.equal(
    typeof chatStateSelection.shouldReplaceServerSnapshot,
    "function"
  );
  assert.equal(
    chatStateSelection.shouldReplaceServerSnapshot({
      previousSnapshot: { threadId: "thread-a", updatedAt: 200 },
      incomingThreadId: "thread-a",
      incomingUpdatedAt: 100,
      incomingMessageCount: 2,
      streamIsLoading: false,
      streamMessageCount: 0,
    }),
    false
  );
});

test("different-thread snapshot is accepted regardless of timestamp", () => {
  assert.equal(
    chatStateSelection.shouldReplaceServerSnapshot({
      previousSnapshot: { threadId: "thread-a", updatedAt: 200 },
      incomingThreadId: "thread-b",
      incomingUpdatedAt: 100,
      incomingMessageCount: 0,
      streamIsLoading: false,
      streamMessageCount: 3,
    }),
    true
  );
});

test("same-thread newer snapshot remains accepted", () => {
  assert.equal(
    chatStateSelection.shouldReplaceServerSnapshot({
      previousSnapshot: { threadId: "thread-a", updatedAt: 100 },
      incomingThreadId: "thread-a",
      incomingUpdatedAt: 200,
      incomingMessageCount: 0,
      streamIsLoading: false,
      streamMessageCount: 3,
    }),
    true
  );
});

test("same-thread more-complete snapshot is accepted only when not older", () => {
  assert.equal(
    chatStateSelection.shouldReplaceServerSnapshot({
      previousSnapshot: { threadId: "thread-a", updatedAt: 200 },
      incomingThreadId: "thread-a",
      incomingUpdatedAt: 100,
      incomingMessageCount: 5,
      streamIsLoading: true,
      streamMessageCount: 1,
    }),
    false
  );
  assert.equal(
    chatStateSelection.shouldReplaceServerSnapshot({
      previousSnapshot: { threadId: "thread-a", updatedAt: 100 },
      incomingThreadId: "thread-a",
      incomingUpdatedAt: 200,
      incomingMessageCount: 5,
      streamIsLoading: true,
      streamMessageCount: 1,
    }),
    true
  );
});

test("snapshot from before a run is ineligible until a fresh snapshot arrives", () => {
  assert.equal(
    typeof chatStateSelection.selectFreshServerTodosForRun,
    "function"
  );
  assert.equal(
    chatStateSelection.selectFreshServerTodosForRun({
      currentRunGeneration: 1,
      serverSnapshotRunGeneration: 0,
      serverTodos: [persistedTodo],
    }),
    undefined
  );
});

test("snapshot confirmed after run remains eligible", () => {
  assert.deepEqual(
    chatStateSelection.selectFreshServerTodosForRun({
      currentRunGeneration: 1,
      serverSnapshotRunGeneration: 1,
      serverTodos: [persistedTodo],
    }),
    [persistedTodo]
  );
});
