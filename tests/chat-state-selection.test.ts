import assert from "node:assert/strict";
import test from "node:test";

type Todo = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
};

async function loadSelector() {
  try {
    return (await import("../src/app/hooks/chat-state-selection"))
      .selectEffectiveTodos as
      | ((options: {
          isLoading: boolean;
          streamTodos?: Todo[];
          serverTodos?: Todo[];
        }) => Todo[])
      | undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      return undefined;
    }
    throw error;
  }
}

const persistedTodo: Todo = {
  id: "persisted",
  content: "Persisted task",
  status: "pending",
};

test("idle stream todos are restored from a confirmed server snapshot", async () => {
  const selectEffectiveTodos = await loadSelector();
  assert.equal(typeof selectEffectiveTodos, "function");
  assert.deepEqual(
    selectEffectiveTodos?.({
      isLoading: false,
      streamTodos: [],
      serverTodos: [persistedTodo],
    }),
    [persistedTodo]
  );
});

test("loading keeps live stream todos authoritative", async () => {
  const selectEffectiveTodos = await loadSelector();
  assert.equal(typeof selectEffectiveTodos, "function");
  assert.deepEqual(
    selectEffectiveTodos?.({
      isLoading: true,
      streamTodos: [],
      serverTodos: [persistedTodo],
    }),
    []
  );
});

test("stream todos remain visible when no server snapshot exists", async () => {
  const selectEffectiveTodos = await loadSelector();
  assert.equal(typeof selectEffectiveTodos, "function");
  assert.deepEqual(
    selectEffectiveTodos?.({
      isLoading: false,
      streamTodos: [persistedTodo],
    }),
    [persistedTodo]
  );
});
