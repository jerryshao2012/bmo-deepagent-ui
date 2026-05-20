import useSWRInfinite from "swr/infinite";
import useSWR from "swr";
import type { Thread } from "@langchain/langgraph-sdk";
import { Client } from "@langchain/langgraph-sdk";
import { getConfig } from "@/lib/config";

export interface ThreadItem {
  id: string;
  updatedAt: Date;
  status: Thread["status"];
  title: string;
  description: string;
  assistantId?: string;
}

const DEFAULT_PAGE_SIZE = 20;

function createThreadsClient() {
  const config = getConfig();
  if (!config) return null;

  const apiKey =
    config.langsmithApiKey ||
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    "";

  let apiUrl: string;
  const defaultHeaders: Record<string, string> = {};
  
  if (typeof window !== "undefined") {
    // Browser-side: use absolute URL to /api/proxy
    apiUrl = `${window.location.origin}/api/proxy`;
    // Pass deployment URL as header for dynamic local dev support
    defaultHeaders["X-Deployment-URL"] = config.deploymentUrl;
    if (apiKey) {
      defaultHeaders["X-Api-Key"] = apiKey;
    }
  } else {
    // Server-side: use direct deployment URL
    apiUrl = config.deploymentUrl;
    if (apiKey) {
      defaultHeaders["X-Api-Key"] = apiKey;
    }
  }

  return new Client({
    apiUrl,
    defaultHeaders,
  });
}

function extractThreadPreview(thread: any): {
  title: string;
  description: string;
} {
  let title = "Untitled Thread";
  let description = "";

  try {
    if (thread?.values && typeof thread.values === "object") {
      const values = thread.values as any;
      const messages = Array.isArray(values.messages) ? values.messages : [];

      const firstHumanMessage = messages.find((m: any) => m.type === "human");
      if (firstHumanMessage?.content) {
        const content =
          typeof firstHumanMessage.content === "string"
            ? firstHumanMessage.content
            : firstHumanMessage.content[0]?.text || "";
        title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
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
    if (thread?.thread_id) {
      title = `Thread ${thread.thread_id.slice(0, 8)}`;
    }
  }

  return { title, description };
}

export function useThreads(props: {
  status?: Thread["status"];
  limit?: number;
}) {
  const pageSize = props.limit || DEFAULT_PAGE_SIZE;

  const hasBusyThreads = (pages?: ThreadItem[][]) => {
    if (!pages) {
      return false;
    }

    return pages.some((page) => page.some((thread) => thread.status === "busy"));
  };

  return useSWRInfinite(
    (pageIndex: number, previousPageData: ThreadItem[] | null) => {
      const config = getConfig();
      if (!config) return null;

      const apiKey =
        config.langsmithApiKey ||
        process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
        "";

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
        isBrowser: typeof window !== "undefined",
      };
    },
    async ({
      deploymentUrl,
      assistantId,
      apiKey,
      status,
      pageIndex,
      pageSize,
      isBrowser,
    }: {
      kind: "threads";
      pageIndex: number;
      pageSize: number;
      deploymentUrl: string;
      assistantId: string;
      apiKey: string;
      status?: Thread["status"];
      isBrowser?: boolean;
    }) => {
      // Use API proxy for browser-side requests
      let apiUrl: string;
      const defaultHeaders: Record<string, string> = {};
      
      if (isBrowser) {
        // Browser-side: use absolute URL to /api/proxy
        apiUrl = typeof window !== "undefined" 
          ? `${window.location.origin}/api/proxy`
          : deploymentUrl;
        // Pass deployment URL as header for dynamic local dev support
        defaultHeaders["X-Deployment-URL"] = deploymentUrl;
        if (apiKey) {
          defaultHeaders["X-Api-Key"] = apiKey;
        }
      } else {
        // Server-side: use direct deployment URL
        apiUrl = deploymentUrl;
        if (apiKey) {
          defaultHeaders["X-Api-Key"] = apiKey;
        }
      }
      
      const client = new Client({
        apiUrl,
        defaultHeaders,
      });

      // Check if assistantId is a UUID (deployed) or graph name (local)
      const isUUID =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          assistantId
        );

      const threads = await client.threads.search({
        limit: pageSize,
        offset: pageIndex * pageSize,
        sortBy: "updated_at" as const,
        sortOrder: "desc" as const,
        status,
        // Only filter by assistant_id metadata for deployed graphs (UUIDs)
        // Local dev graphs don't set this metadata
        ...(isUUID ? { metadata: { assistant_id: assistantId } } : {}),
      });

      const mappedThreads = threads.map((thread): ThreadItem => {
        const { title, description } = extractThreadPreview(thread);

        return {
          id: thread.thread_id,
          updatedAt: new Date(thread.updated_at),
          status: thread.status,
          title,
          description,
          assistantId,
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
            thread.status === "busy" || thread.title === "Untitled Thread";

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
              updatedAt: fullThread?.updated_at
                ? new Date(fullThread.updated_at)
                : thread.updatedAt,
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

  const apiKey =
    config.langsmithApiKey ||
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    "";

  let apiUrl: string;
  const defaultHeaders: Record<string, string> = {};
  
  if (typeof window !== "undefined") {
    // Browser-side: use absolute URL to /api/proxy
    apiUrl = `${window.location.origin}/api/proxy`;
    // Pass deployment URL as header for dynamic local dev support
    defaultHeaders["X-Deployment-URL"] = config.deploymentUrl;
    if (apiKey) {
      defaultHeaders["X-Api-Key"] = apiKey;
    }
  } else {
    // Server-side: use direct deployment URL
    apiUrl = config.deploymentUrl;
    if (apiKey) {
      defaultHeaders["X-Api-Key"] = apiKey;
    }
  }

  const client = new Client({
    apiUrl,
    defaultHeaders,
  });

  await client.threads.delete(threadId);
}

/**
 * Delete threads older than the specified number of days
 * Uses updated_at timestamp, so any thread activity automatically extends retention
 * @param days - Number of days to retain threads since last update (default: 7)
 */
export async function cleanupOldThreads(days: number = 7): Promise<void> {
  const config = getConfig();
  if (!config) return;

  const apiKey =
    config.langsmithApiKey ||
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    "";

  let apiUrl: string;
  const defaultHeaders: Record<string, string> = {};
  
  if (typeof window !== "undefined") {
    apiUrl = `${window.location.origin}/api/proxy`;
    defaultHeaders["X-Deployment-URL"] = config.deploymentUrl;
    if (apiKey) {
      defaultHeaders["X-Api-Key"] = apiKey;
    }
  } else {
    apiUrl = config.deploymentUrl;
    if (apiKey) {
      defaultHeaders["X-Api-Key"] = apiKey;
    }
  }

  const client = new Client({
    apiUrl,
    defaultHeaders,
  });

  try {
    // Calculate cutoff date based on last update time
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    console.log(`[Cleanup] Starting thread cleanup - deleting threads not updated since ${cutoffDate.toISOString()} (${days} days ago)`);

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
            await client.threads.delete(thread.thread_id);
            deletedCount++;
            console.log(`[Cleanup] Deleted thread ${thread.thread_id} (last updated: ${updatedAt.toISOString()})`);
          } catch (error) {
            console.error(`[Cleanup] Failed to delete thread ${thread.thread_id}:`, error);
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
    
    console.log(`[Cleanup] Completed - checked ${checkedCount} threads, deleted ${deletedCount} old threads`);
  } catch (error) {
    console.error("[Cleanup] Error during thread cleanup:", error);
  }
}
