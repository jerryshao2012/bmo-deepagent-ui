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

type ThreadRecord = {
  thread_id: string;
  created_at?: string;
  updated_at: string;
  status: ThreadStatus;
  metadata?: Record<string, unknown> | null;
  values?: unknown;
};

interface LangGraphThreadsClient {
  search(query?: {
    metadata?: Record<string, unknown>;
    limit?: number;
    offset?: number;
    status?: ThreadStatus;
    sortBy?: "created_at" | "updated_at";
    sortOrder?: "asc" | "desc";
    select?: Array<
      | "thread_id"
      | "created_at"
      | "updated_at"
      | "status"
      | "metadata"
      | "values"
    >;
  }): Promise<ThreadRecord[]>;
  getState(threadId: string): Promise<{ values?: unknown }>;
  get(threadId: string): Promise<ThreadRecord>;
  delete(threadId: string): Promise<void>;
  update(
    threadId: string,
    update?: { metadata?: Record<string, unknown> }
  ): Promise<unknown>;
}

interface LangGraphClient {
  threads: LangGraphThreadsClient;
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "";
}

function isThreadStatus(status: unknown): status is ThreadStatus {
  return (
    status === "idle" ||
    status === "busy" ||
    status === "interrupted" ||
    status === "error"
  );
}

function extractThreadPreview(thread: ThreadRecord): {
  title: string;
  description: string;
  isUserDefinedTitle: boolean;
  hasHumanTitle: boolean;
} {
  const fallbackTitle = `Thread ${thread.thread_id.slice(0, 8)}`;
  let title = fallbackTitle;
  let description = "";
  let isUserDefinedTitle = false;
  let hasHumanTitle = false;

  try {
    const customTitle = thread.metadata?.custom_title;
    if (typeof customTitle === "string" && customTitle.trim()) {
      title = customTitle.trim();
      isUserDefinedTitle = true;
    }

    const values = thread.values as { messages?: unknown } | undefined;
    const messages = Array.isArray(values?.messages) ? values.messages : [];
    const firstHuman = messages.find(
      (message): message is { type?: unknown; content?: unknown } =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === "human"
    );
    const humanContent = normalizeMessageContent(firstHuman?.content);
    hasHumanTitle = Boolean(humanContent);
    if (!isUserDefinedTitle && humanContent) {
      title =
        humanContent.slice(0, 50) + (humanContent.length > 50 ? "..." : "");
    }
    const firstAi = messages.find(
      (message): message is { type?: unknown; content?: unknown } =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === "ai"
    );
    const aiContent = normalizeMessageContent(firstAi?.content);
    if (aiContent) {
      description = aiContent.slice(0, 100);
    }
  } catch {
    title = isUserDefinedTitle ? title : fallbackTitle;
  }
  return { title, description, isUserDefinedTitle, hasHumanTitle };
}

export class LangGraphThreadRepository implements ThreadRepository {
  private readonly client: LangGraphClient;

  constructor(
    private readonly options: LangGraphThreadRepositoryOptions,
    client?: LangGraphClient
  ) {
    this.client =
      client ??
      new Client(
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
      select: [
        "thread_id",
        "created_at",
        "updated_at",
        "status",
        "metadata",
        "values",
      ],
    });
    return Promise.all(
      threads.map(async (thread) => {
        const preview = extractThreadPreview(thread);
        if (
          thread.status === "busy" ||
          preview.isUserDefinedTitle ||
          preview.hasHumanTitle ||
          !isThreadStatus(thread.status)
        ) {
          return this.toItem(thread, query.assistantId);
        }
        try {
          const state = await this.client.threads.getState(thread.thread_id);
          return this.toItem(
            { ...thread, values: state.values },
            query.assistantId
          );
        } catch {
          return this.toItem(thread, query.assistantId);
        }
      })
    );
  }

  async getStatus(threadId: string): Promise<ThreadStatus | null> {
    const thread = await this.client.threads.get(threadId);
    return thread.status ?? null;
  }

  async delete(threadId: string): Promise<void> {
    try {
      const baseUrl = this.options.deploymentUrl.replace(/\/+$/, "");
      const response = await authenticatedFetch(
        `${baseUrl}/threads/${threadId}/wiki`,
        {
          method: "DELETE",
          headers: {
            "X-API-Key": this.options.sessionToken || this.options.apiKey,
          },
        }
      );
      if (!response.ok) {
        console.warn(
          `Failed to delete thread wiki and documents: ${response.status}`
        );
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
            console.error(
              `[Cleanup] Failed to delete thread ${thread.thread_id}:`,
              error
            );
          }
        }
      }
      offset += batchSize;
      hasMore = threads.length === batchSize;
    }
  }

  private toItem(thread: ThreadRecord, assistantId: string): ThreadItem {
    const preview = extractThreadPreview(thread);
    return {
      id: thread.thread_id,
      createdAt: thread.created_at ? new Date(thread.created_at) : undefined,
      updatedAt: new Date(thread.updated_at),
      status: thread.status,
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
