import type { TodoItem } from "@/app/types/types";

export function selectEffectiveTodos({
  isLoading,
  streamTodos,
  serverTodos,
}: {
  isLoading: boolean;
  streamTodos?: TodoItem[];
  serverTodos?: TodoItem[];
}): TodoItem[] {
  if (isLoading || serverTodos === undefined) {
    return streamTodos ?? [];
  }
  return serverTodos;
}

export function selectServerTodosForThread({
  currentThreadId,
  serverThreadId,
  serverTodos,
}: {
  currentThreadId?: string | null;
  serverThreadId?: string | null;
  serverTodos?: TodoItem[];
}): TodoItem[] | undefined {
  if (
    currentThreadId === null ||
    currentThreadId === undefined ||
    currentThreadId !== serverThreadId
  ) {
    return undefined;
  }
  return serverTodos;
}
