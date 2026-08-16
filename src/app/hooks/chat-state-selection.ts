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
