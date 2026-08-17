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

export function shouldReplaceServerSnapshot({
  previousSnapshot,
  incomingThreadId,
  incomingUpdatedAt,
  incomingMessageCount,
  streamIsLoading,
  streamMessageCount,
}: {
  previousSnapshot?: { threadId: string; updatedAt: number } | null;
  incomingThreadId: string;
  incomingUpdatedAt: number;
  incomingMessageCount: number;
  streamIsLoading: boolean;
  streamMessageCount: number;
}): boolean {
  if (
    previousSnapshot &&
    previousSnapshot.threadId === incomingThreadId &&
    incomingUpdatedAt < previousSnapshot.updatedAt
  ) {
    return false;
  }

  if (!previousSnapshot || previousSnapshot.threadId !== incomingThreadId) {
    return true;
  }

  const isMoreRecent = incomingUpdatedAt > previousSnapshot.updatedAt;
  const isMoreComplete = incomingMessageCount > streamMessageCount;
  return (
    isMoreComplete ||
    (!streamIsLoading && (isMoreRecent || incomingMessageCount > 0))
  );
}

export function selectFreshServerTodosForRun({
  currentRunGeneration,
  serverSnapshotRunGeneration,
  serverTodos,
}: {
  currentRunGeneration: number;
  serverSnapshotRunGeneration?: number;
  serverTodos?: TodoItem[];
}): TodoItem[] | undefined {
  if (
    serverSnapshotRunGeneration === undefined ||
    serverSnapshotRunGeneration !== currentRunGeneration
  ) {
    return undefined;
  }
  return serverTodos;
}
