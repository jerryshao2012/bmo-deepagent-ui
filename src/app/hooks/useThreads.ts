import useSWRInfinite from "swr/infinite";
import useSWR from "swr";
import type { Thread } from "@langchain/langgraph-sdk";
import { Client } from "@langchain/langgraph-sdk";
import { getConfig } from "@/lib/config";
import { createLangGraphClientConfig, getBrowserSessionToken } from "@/lib/langgraph-client";

export interface ThreadItem {
  id: string;
  createdAt?: Date;
  updatedAt: Date;
  status: Thread["status"];
  title: string;
  description: string;
  assistantId?: string;
  isUserDefinedTitle?: boolean;
  isFavorite?: boolean;
}

const DEFAULT_PAGE_SIZE = 20;

function createThreadsClient() {
  const config = getConfig();
  if (!config) return null;

  const apiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  return new Client(
    createLangGraphClientConfig({
      deploymentUrl: config.deploymentUrl,
      apiKey,
    })
  );
}

function extractThreadPreview(thread: any): {
  title: string;
  description: string;
  isUserDefinedTitle: boolean;
} {
  let title = "Untitled Thread";
  let description = "";
  let isUserDefinedTitle = false;

  const customTitle = thread?.metadata?.custom_title;
  if (typeof customTitle === "string" && customTitle.trim().length > 0) {
    title = customTitle.trim();
    isUserDefinedTitle = true;
  }

  try {
    if (thread?.values && typeof thread.values === "object") {
      const values = thread.values as any;
      const messages = Array.isArray(values.messages) ? values.messages : [];

      if (!isUserDefinedTitle) {
        const firstHumanMessage = messages.find((m: any) => m.type === "human");
        if (firstHumanMessage?.content) {
          const content =
            typeof firstHumanMessage.content === "string"
              ? firstHumanMessage.content
              : firstHumanMessage.content[0]?.text || "";

          if (content) {
            title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
          }
        }
      }

      const firstAiMessage = messages.find((m: any) => m.type === "ai");
      if (firstAiMessage?.content) {
        const content =
          typeof firstAiMessage.content === "string"
            ? firstAiMessage.content
            : firstAiMessage.content[0]?.text || "";
        description = content.slice(0, 100);
      }
    }
  } catch {
    if (!isUserDefinedTitle && thread?.thread_id) {
      title = `Thread ${thread.thread_id.slice(0, 8)}`;
    }
  }

  return { title, description, isUserDefinedTitle };
}

export function useThreads(props: {
  status?: Thread["status"] | "favorite";
  limit?: number;
}) {
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;

  const hasBusyThreads = (pages?: ThreadItem[][]) => {
    if (!pages) {
      return false;
    }

    return pages.some((page) =>
      page.some((thread) => thread.status === "busy")
    );
  };

  return useSWRInfinite(
    (pageIndex: number, previousPageData: ThreadItem[] | null) => {
      const config = getConfig();
      if (!config) return null;

      const apiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

      // If the previous page returned no items, we've reached the end
      if (previousPageData && previousPageData.length === 0) {
        return null;
      }

      return {
        kind: "threads" as const,
        pageIndex,
        pageSize,
        deploymentUrl: config.deploymentUrl,
        assistantId: config.assistantId,
        apiKey,
        status: props?.status,
      };
    },
    async ({
      deploymentUrl,
      assistantId,
      apiKey,
      status,
      pageIndex,
      pageSize,
    }: {
      kind: "threads";
      pageIndex: number;
      pageSize: number;
      deploymentUrl: string;
      assistantId: string;
      apiKey: string;
      status?: Thread["status"] | "favorite";
    }) => {
      const client = new Client(
        createLangGraphClientConfig({ deploymentUrl, apiKey })
      );

      // Check if assistantId is a UUID (deployed) or graph name (local)
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          assistantId
        );

      const threads = await client.threads.search({
        limit: pageSize,
        offset: pageIndex * pageSize,
        sortBy: "created_at" as const,
        sortOrder: "desc" as const,
        status: status === "favorite" ? undefined : status,
        metadata: {
          ...(isUUID ? { assistant_id: assistantId } : {}),
          ...(status === "favorite" ? { is_favorite: true } : {}),
        },
      });

      const mappedThreads = threads.map((thread): ThreadItem => {
        const { title, description, isUserDefinedTitle } =
          extractThreadPreview(thread);

        return {
          id: thread.thread_id,
          createdAt: new Date(thread.created_at),
          updatedAt: new Date(thread.updated_at),
          status: thread.status,
          title,
          description,
          assistantId,
          isUserDefinedTitle,
          isFavorite: !!thread.metadata?.is_favorite,
        };
      });

      // The search endpoint may return stale or sparse values while a run just completed.
      // Hydrate only potentially incomplete rows on the first page for fresh title/status.
      if (pageIndex > 0) {
        return mappedThreads;
      }

      return await Promise.all(
        mappedThreads.map(async (thread) => {
          const needsHydration =
            thread.status === "busy" ||
            (!thread.isUserDefinedTitle && thread.title === "Untitled Thread");

          if (!needsHydration) {
            return thread;
          }

          try {
            const fullThread = await (client.threads as any).get(thread.id);
            const { title, description } = extractThreadPreview(fullThread);

            return {
              ...thread,
              title,
              description,
              status: (fullThread?.status as Thread["status"]) ?? thread.status,
              createdAt: fullThread?.created_at
                ? new Date(fullThread.created_at)
                : thread.createdAt,
              updatedAt: fullThread?.updated_at
                ? new Date(fullThread.updated_at)
                : thread.updatedAt,
              isFavorite: !!fullThread?.metadata?.is_favorite,
            };
          } catch {
            return thread;
          }
        })
      );
    },
    {
      revalidateFirstPage: true,
      revalidateOnFocus: true,
      // Poll while any thread is running so the list updates without user interaction.
      refreshInterval: (pages?: ThreadItem[][]) =>
        hasBusyThreads(pages) ? 1500 : 0,
      dedupingInterval: 400,
    }
  );
}

export function useThreadStatus(threadId?: string | null) {
  return useSWR<Thread["status"] | null>(
    threadId ? { kind: "thread-status" as const, threadId } : null,
    async ({ threadId }: { kind: "thread-status"; threadId: string }) => {
      const client = createThreadsClient();
      if (!client) {
        return null;
      }

      try {
        const thread = await (client.threads as any).get(threadId);
        return (thread?.status as Thread["status"]) ?? null;
      } catch {
        return null;
      }
    },
    {
      refreshInterval: 1500,
      revalidateOnFocus: true,
      keepPreviousData: false,
    }
  );
}

export async function deleteThread(threadId: string): Promise<void> {
  const config = getConfig();
  if (!config) return;

  const apiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";
  const token = getBrowserSessionToken() || apiKey || "";

  // 1. Clean up local wiki workspace and uploaded documents on the server.
  try {
    const cleanUrl = config.deploymentUrl.replace(/\/+$/, "");
    const response = await fetch(`${cleanUrl}/threads/${threadId}/wiki`, {
      method: "DELETE",
      headers: {
        "X-API-Key": token,
      },
    });
    if (!response.ok) {
      console.warn(`Failed to delete thread wiki and documents: ${response.status}`);
    }
  } catch (error) {
    console.error("Failed to delete thread wiki and documents:", error);
  }

  // 2. Delete the thread in LangGraph
  const client = new Client(
    createLangGraphClientConfig({
      deploymentUrl: config.deploymentUrl,
      apiKey,
    })
  );

  await client.threads.delete(threadId);
}

export async function updateThreadTitle(
  threadId: string,
  title: string
): Promise<void> {
  const config = getConfig();
  if (!config) return;

  const apiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  const client = new Client(
    createLangGraphClientConfig({
      deploymentUrl: config.deploymentUrl,
      apiKey,
    })
  );

  const existing = await (client.threads as any).get(threadId);
  const metadata =
    existing?.metadata && typeof existing.metadata === "object"
      ? existing.metadata
      : {};

  await client.threads.update(threadId, {
    metadata: {
      ...metadata,
      custom_title: title.trim(),
      title_source: "user",
    },
  });
}

export async function updateThreadFavorite(
  threadId: string,
  isFavorite: boolean
): Promise<void> {
  const config = getConfig();
  if (!config) return;

  const apiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  const client = new Client(
    createLangGraphClientConfig({
      deploymentUrl: config.deploymentUrl,
      apiKey,
    })
  );

  const existing = await (client.threads as any).get(threadId);
  const metadata =
    existing?.metadata && typeof existing.metadata === "object"
      ? existing.metadata
      : {};

  await client.threads.update(threadId, {
    metadata: {
      ...metadata,
      is_favorite: isFavorite,
    },
  });
}

/**
 * Delete threads older than the specified number of days
 * Uses updated_at timestamp, so any thread activity automatically extends retention
 * @param days - Number of days to retain threads since last update (default: 7)
 */
export async function cleanupOldThreads(days: number = 7): Promise<void> {
  const config = getConfig();
  if (!config) return;

  const apiKey = process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";
  const token = getBrowserSessionToken() || apiKey || "";

  const client = new Client(
    createLangGraphClientConfig({
      deploymentUrl: config.deploymentUrl,
      apiKey,
    })
  );

  try {
    // Calculate cutoff date based on last update time
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    console.log(
      `[Cleanup] Starting thread cleanup - deleting threads not updated since ${cutoffDate.toISOString()} (${days} days ago)`
    );

    // Search threads in batches to handle pagination
    let offset = 0;
    const batchSize = 100;
    let hasMore = true;
    let deletedCount = 0;
    let checkedCount = 0;

    while (hasMore) {
      const threads = await client.threads.search({
        limit: batchSize,
        offset,
        sortBy: "updated_at" as const,
        sortOrder: "desc" as const,
      });

      if (threads.length === 0) {
        hasMore = false;
        break;
      }

      // Check each thread's updated_at timestamp
      for (const thread of threads) {
        checkedCount++;
        const updatedAt = new Date(thread.updated_at);

        // Only delete if thread hasn't been updated in the retention period
        if (updatedAt < cutoffDate) {
          try {
            // Clean up the wiki and documents first!
            try {
              const cleanUrl = config.deploymentUrl.replace(/\/+$/, "");
              const response = await fetch(`${cleanUrl}/threads/${thread.thread_id}/wiki`, {
                method: "DELETE",
                headers: {
                  "X-API-Key": token,
                },
              });
              if (!response.ok) {
                console.warn(
                  `[Cleanup] Failed to delete thread wiki and documents for thread ${thread.thread_id}: ${response.status}`
                );
              }
            } catch (err) {
              console.error(
                `[Cleanup] Error deleting thread wiki and documents for thread ${thread.thread_id}:`,
                err
              );
            }

            await client.threads.delete(thread.thread_id);
            deletedCount++;
            console.log(
              `[Cleanup] Deleted thread ${
                thread.thread_id
              } (last updated: ${updatedAt.toISOString()})`
            );
          } catch (error) {
            console.error(
              `[Cleanup] Failed to delete thread ${thread.thread_id}:`,
              error
            );
          }
        } else {
          // Thread is still active, stop checking further (sorted by updated_at desc)
          // All remaining threads will be newer
          if (deletedCount === 0 && checkedCount > 0) {
            hasMore = false;
            break;
          }
        }
      }

      offset += batchSize;

      // If we got fewer threads than requested, we've reached the end
      if (threads.length < batchSize) {
        hasMore = false;
      }
    }

    console.log(
      `[Cleanup] Completed - checked ${checkedCount} threads, deleted ${deletedCount} old threads`
    );
  } catch (error) {
    console.error("[Cleanup] Error during thread cleanup:", error);
  }
}
