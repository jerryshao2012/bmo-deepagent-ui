import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

import type {
  ThreadItem,
  ThreadStatus,
} from "@/features/threads/application/thread-repository";
import { LangGraphThreadRepository } from "@/features/threads/infrastructure/langgraph-thread-repository";
import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";

export type { ThreadItem };

const DEFAULT_PAGE_SIZE = 20;

function configuredRepository(
  deploymentUrl: string,
  apiKey: string
): LangGraphThreadRepository {
  return new LangGraphThreadRepository({
    deploymentUrl,
    apiKey,
    sessionToken: getBrowserSessionToken() || apiKey,
  });
}

export function useThreads(props: {
  status?: ThreadStatus | "favorite";
  limit?: number;
}) {
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;
  return useSWRInfinite(
    (pageIndex: number, previousPageData: ThreadItem[] | null) => {
      const config = getConfig();
      if (!config || (previousPageData && previousPageData.length === 0)) {
        return null;
      }
      return {
        kind: "threads" as const,
        pageIndex,
        pageSize,
        deploymentUrl: config.deploymentUrl,
        assistantId: config.assistantId,
        apiKey: process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "",
        status: props.status,
      };
    },
    async ({ deploymentUrl, assistantId, apiKey, status, pageIndex, pageSize }) =>
      configuredRepository(deploymentUrl, apiKey).search({
        assistantId,
        status,
        pageIndex,
        pageSize,
      }),
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
      refreshInterval: (pages?: ThreadItem[][]) =>
        pages?.some((page) => page.some((thread) => thread.status === "busy"))
          ? 1500
          : 0,
      dedupingInterval: 400,
    }
  );
}

export function useThreadStatus(threadId?: string | null) {
  return useSWR<ThreadStatus | null>(
    threadId ? { kind: "thread-status" as const, threadId } : null,
    async ({ threadId: activeThreadId }) => {
      const config = getConfig();
      if (!config) return null;
      try {
        return await configuredRepository(
          config.deploymentUrl,
          process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || ""
        ).getStatus(activeThreadId);
      } catch {
        return null;
      }
    },
    { refreshInterval: 1500, revalidateOnFocus: true, keepPreviousData: false }
  );
}

function currentRepository(): LangGraphThreadRepository | null {
  const config = getConfig();
  if (!config) return null;
  return configuredRepository(
    config.deploymentUrl,
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || ""
  );
}

export async function deleteThread(threadId: string): Promise<void> {
  await currentRepository()?.delete(threadId);
}

export async function updateThreadTitle(
  threadId: string,
  title: string
): Promise<void> {
  await currentRepository()?.updateTitle(threadId, title);
}

export async function updateThreadFavorite(
  threadId: string,
  isFavorite: boolean
): Promise<void> {
  await currentRepository()?.updateFavorite(threadId, isFavorite);
}

export async function cleanupOldThreads(days: number = 7): Promise<void> {
  await currentRepository()?.cleanupOlderThan(days);
}
