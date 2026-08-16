import assert from "node:assert/strict";
import test from "node:test";
import type { TodoItem } from "../src/app/types/types";
import { selectEffectiveTodos } from "../src/app/hooks/chat-state-selection";

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
      currentThreadId: "thread-a",
      serverSnapshotThreadId: "thread-a",
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
      currentThreadId: "thread-a",
      serverSnapshotThreadId: "thread-a",
    }),
    []
  );
});

test("stream todos remain visible when no server snapshot exists", async () => {
  assert.deepEqual(
    selectEffectiveTodos({
      isLoading: false,
      streamTodos: [persistedTodo],
      currentThreadId: "thread-a",
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
      currentThreadId: "thread-a",
      serverSnapshotThreadId: "thread-a",
    }),
    []
  );
});

test("snapshot from another thread cannot replace live todos", () => {
  assert.deepEqual(
    selectEffectiveTodos({
      isLoading: false,
      streamTodos: [persistedTodo],
      serverTodos: [{ ...persistedTodo, id: "thread-a-task" }],
      currentThreadId: "thread-b",
      serverSnapshotThreadId: "thread-a",
    }),
    [persistedTodo]
  );
});
