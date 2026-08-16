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
