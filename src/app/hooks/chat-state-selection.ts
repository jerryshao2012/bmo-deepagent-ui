import type { TodoItem } from "@/app/types/types";

export function selectEffectiveTodos({
  isLoading,
  streamTodos,
  serverTodos,
  currentThreadId,
  serverSnapshotThreadId,
}: {
  isLoading: boolean;
  streamTodos?: TodoItem[];
  serverTodos?: TodoItem[];
  currentThreadId?: string | null;
  serverSnapshotThreadId?: string | null;
}): TodoItem[] {
  const isSnapshotForCurrentThread =
    currentThreadId !== undefined &&
    currentThreadId !== null &&
    serverSnapshotThreadId === currentThreadId;

  if (isLoading || serverTodos === undefined || !isSnapshotForCurrentThread) {
    return streamTodos ?? [];
  }
  return serverTodos;
}
