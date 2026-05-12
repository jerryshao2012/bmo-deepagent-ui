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
  if (!config) {
    return null;
  }

  const apiKey =
    config.langsmithApiKey ||
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    "";

  return new Client({
    apiUrl: config.deploymentUrl,
    defaultHeaders: apiKey ? { "X-Api-Key": apiKey } : {},
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
      const apiKey =
        config?.langsmithApiKey ||
        process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
        "";

      if (!config) {
        return null;
      }

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
      status?: Thread["status"];
    }) => {
      const client = new Client({
        apiUrl: deploymentUrl,
        defaultHeaders: apiKey ? { "X-Api-Key": apiKey } : {},
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

      const hydratedThreads = await Promise.all(
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

      return hydratedThreads;
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
  if (!config) throw new Error("No config found");

  const apiKey =
    config.langsmithApiKey ||
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    "";

  const client = new Client({
    apiUrl: config.deploymentUrl,
    defaultHeaders: apiKey ? { "X-Api-Key": apiKey } : {},
  });

  await client.threads.delete(threadId);
}
