import { Client } from "@langchain/langgraph-sdk";

import { createLangGraphClientConfig } from "@/lib/langgraph-client";
import { authenticatedFetch } from "@/platform/http/authenticated-fetch";

import type {
  ThreadItem,
  ThreadRepository,
  ThreadSearchQuery,
  ThreadStatus,
} from "../application/thread-repository";

interface LangGraphThreadRepositoryOptions {
  deploymentUrl: string;
  apiKey: string;
  sessionToken?: string;
}

function extractThreadPreview(thread: Record<string, any>): {
  title: string;
  description: string;
  isUserDefinedTitle: boolean;
} {
  let title = "Untitled Thread";
  let description = "";
  let isUserDefinedTitle = false;
  const customTitle = thread?.metadata?.custom_title;
  if (typeof customTitle === "string" && customTitle.trim()) {
    title = customTitle.trim();
    isUserDefinedTitle = true;
  }

  try {
    const messages = Array.isArray(thread?.values?.messages)
      ? thread.values.messages
      : [];
    if (!isUserDefinedTitle) {
      const firstHuman = messages.find((message: any) => message.type === "human");
      const content = Array.isArray(firstHuman?.content)
        ? firstHuman.content[0]?.text || ""
        : firstHuman?.content || "";
      if (content) title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    }
    const firstAi = messages.find((message: any) => message.type === "ai");
    const content = Array.isArray(firstAi?.content)
      ? firstAi.content[0]?.text || ""
      : firstAi?.content || "";
    if (content) description = content.slice(0, 100);
  } catch {
    if (!isUserDefinedTitle && thread?.thread_id) {
      title = `Thread ${thread.thread_id.slice(0, 8)}`;
    }
  }
  return { title, description, isUserDefinedTitle };
}

export class LangGraphThreadRepository implements ThreadRepository {
  private readonly client: Client;

  constructor(private readonly options: LangGraphThreadRepositoryOptions) {
    this.client = new Client(
      createLangGraphClientConfig({
        deploymentUrl: options.deploymentUrl,
        apiKey: options.apiKey,
      })
    );
  }

  async search(query: ThreadSearchQuery): Promise<ThreadItem[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        query.assistantId
      );
    const threads = await this.client.threads.search({
      limit: query.pageSize,
      offset: query.pageIndex * query.pageSize,
      sortBy: "created_at",
      sortOrder: "desc",
      status: query.status === "favorite" ? undefined : query.status,
      metadata: {
        ...(isUuid ? { assistant_id: query.assistantId } : {}),
        ...(query.status === "favorite" ? { is_favorite: true } : {}),
      },
    });
    const mapped = threads.map((thread) => this.toItem(thread, query.assistantId));
    if (query.pageIndex > 0) return mapped;

    return Promise.all(
      mapped.map(async (item) => {
        if (
          item.status !== "busy" &&
          (item.isUserDefinedTitle || item.title !== "Untitled Thread")
        ) {
          return item;
        }
        try {
          const full = await this.client.threads.get(item.id);
          return this.toItem(full, query.assistantId);
        } catch {
          return item;
        }
      })
    );
  }

  async getStatus(threadId: string): Promise<ThreadStatus | null> {
    const thread = await this.client.threads.get(threadId);
    return (thread.status as ThreadStatus) ?? null;
  }

  async delete(threadId: string): Promise<void> {
    try {
      const baseUrl = this.options.deploymentUrl.replace(/\/+$/, "");
      const response = await authenticatedFetch(
        `${baseUrl}/threads/${threadId}/wiki`,
        {
          method: "DELETE",
          headers: { "X-API-Key": this.options.sessionToken || this.options.apiKey },
        }
      );
      if (!response.ok) {
        console.warn(`Failed to delete thread wiki and documents: ${response.status}`);
      }
    } catch (error) {
      console.error("Failed to delete thread wiki and documents:", error);
    }
    await this.client.threads.delete(threadId);
  }

  async updateTitle(threadId: string, title: string): Promise<void> {
    await this.updateMetadata(threadId, {
      custom_title: title.trim(),
      title_source: "user",
    });
  }

  async updateFavorite(threadId: string, isFavorite: boolean): Promise<void> {
    await this.updateMetadata(threadId, { is_favorite: isFavorite });
  }

  async cleanupOlderThan(days: number): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    let offset = 0;
    const batchSize = 100;
    let hasMore = true;
    while (hasMore) {
      const threads = await this.client.threads.search({
        limit: batchSize,
        offset,
        sortBy: "updated_at",
        sortOrder: "desc",
      });
      if (threads.length === 0) break;
      for (const thread of threads) {
        if (new Date(thread.updated_at) < cutoff) {
          try {
            await this.delete(thread.thread_id);
          } catch (error) {
            console.error(`[Cleanup] Failed to delete thread ${thread.thread_id}:`, error);
          }
        }
      }
      offset += batchSize;
      hasMore = threads.length === batchSize;
    }
  }

  private toItem(thread: Record<string, any>, assistantId: string): ThreadItem {
    const preview = extractThreadPreview(thread);
    return {
      id: thread.thread_id,
      createdAt: thread.created_at ? new Date(thread.created_at) : undefined,
      updatedAt: new Date(thread.updated_at),
      status: thread.status as ThreadStatus,
      assistantId,
      isFavorite: !!thread.metadata?.is_favorite,
      ...preview,
    };
  }

  private async updateMetadata(
    threadId: string,
    update: Record<string, unknown>
  ): Promise<void> {
    const existing = await this.client.threads.get(threadId);
    const metadata =
      existing.metadata && typeof existing.metadata === "object"
        ? existing.metadata
        : {};
    await this.client.threads.update(threadId, {
      metadata: { ...metadata, ...update },
    });
  }
}
