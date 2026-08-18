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

const MAX_CACHED_HYDRATIONS = 500;
const MAX_CONCURRENT_HYDRATIONS = 4;

type CachedHydration = {
  deploymentUrl: string;
  identityScope: string;
  updatedAt: string;
  preview: HydratedPreview;
};

type HydratedPreview = {
  humanTitle: string | null;
  description: string;
  hasHumanTitle: boolean;
};

type ThreadPreview = {
  title: string;
  description: string;
  isUserDefinedTitle: boolean;
  hasHumanTitle: boolean;
};

const recoveredPreviewCache = new Map<string, CachedHydration>();
const activeIdentityScopes = new Map<string, string>();

function normalizeDeploymentUrl(deploymentUrl: string): string {
  return deploymentUrl.replace(/\/+$/, "");
}

function hydrationCacheKey(
  deploymentUrl: string,
  identityScope: string,
  threadId: string
): string {
  return `${normalizeDeploymentUrl(
    deploymentUrl
  )}\u0000${identityScope}\u0000${threadId}`;
}

function clearDeploymentCache(deploymentUrl: string): void {
  for (const [key, cached] of recoveredPreviewCache) {
    if (cached.deploymentUrl === deploymentUrl)
      recoveredPreviewCache.delete(key);
  }
}

function activateIdentityScope(
  deploymentUrl: string,
  identityScope: string | null
): identityScope is string {
  const normalizedDeploymentUrl = normalizeDeploymentUrl(deploymentUrl);
  if (!identityScope) {
    clearDeploymentCache(normalizedDeploymentUrl);
    activeIdentityScopes.delete(normalizedDeploymentUrl);
    return false;
  }

  const activeIdentityScope = activeIdentityScopes.get(normalizedDeploymentUrl);
  if (activeIdentityScope && activeIdentityScope !== identityScope) {
    clearDeploymentCache(normalizedDeploymentUrl);
  }
  activeIdentityScopes.set(normalizedDeploymentUrl, identityScope);
  return true;
}

function getCachedHydration(
  deploymentUrl: string,
  identityScope: string,
  thread: ThreadRecord
): CachedHydration | undefined {
  const key = hydrationCacheKey(deploymentUrl, identityScope, thread.thread_id);
  const cached = recoveredPreviewCache.get(key);
  if (!cached) return undefined;
  if (cached.updatedAt !== thread.updated_at) {
    recoveredPreviewCache.delete(key);
    return undefined;
  }

  recoveredPreviewCache.delete(key);
  recoveredPreviewCache.set(key, cached);
  return cached;
}

function cacheHydration(
  deploymentUrl: string,
  identityScope: string,
  thread: ThreadRecord,
  preview: HydratedPreview
): void {
  const normalizedDeploymentUrl = normalizeDeploymentUrl(deploymentUrl);
  const key = hydrationCacheKey(
    normalizedDeploymentUrl,
    identityScope,
    thread.thread_id
  );
  recoveredPreviewCache.delete(key);
  recoveredPreviewCache.set(key, {
    deploymentUrl: normalizedDeploymentUrl,
    identityScope,
    updatedAt: thread.updated_at,
    preview,
  });
  if (recoveredPreviewCache.size > MAX_CACHED_HYDRATIONS) {
    const oldestKey = recoveredPreviewCache.keys().next().value;
    if (oldestKey !== undefined) recoveredPreviewCache.delete(oldestKey);
  }
}

async function createIdentityScope(credential: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === "undefined") return null;

  try {
    const digest = await subtle.digest(
      "SHA-256",
      new TextEncoder().encode(credential)
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, Result>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<Result>
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  };
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
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

function fallbackThreadTitle(threadId: string): string {
  return `Thread ${threadId.slice(0, 8)}`;
}

function extractHydratedPreview(values: unknown): HydratedPreview {
  let humanTitle: string | null = null;
  let description = "";

  try {
    const state = values as { messages?: unknown } | undefined;
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const firstHuman = messages.find(
      (message): message is { type?: unknown; content?: unknown } =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: unknown }).type === "human"
    );
    const humanContent = normalizeMessageContent(firstHuman?.content);
    if (humanContent) {
      humanTitle =
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
    return { humanTitle: null, description: "", hasHumanTitle: false };
  }
  return { humanTitle, description, hasHumanTitle: Boolean(humanTitle) };
}

function extractThreadPreview(thread: ThreadRecord): ThreadPreview {
  const hydratedPreview = extractHydratedPreview(thread.values);
  const fallbackTitle = fallbackThreadTitle(thread.thread_id);
  const customTitle = thread.metadata?.custom_title;
  if (typeof customTitle === "string" && customTitle.trim()) {
    return {
      title: customTitle.trim(),
      description: hydratedPreview.description,
      isUserDefinedTitle: true,
      hasHumanTitle: hydratedPreview.hasHumanTitle,
    };
  }
  return {
    title: hydratedPreview.humanTitle ?? fallbackTitle,
    description: hydratedPreview.description,
    isUserDefinedTitle: false,
    hasHumanTitle: hydratedPreview.hasHumanTitle,
  };
}

function previewFromHydration(
  thread: ThreadRecord,
  hydratedPreview: HydratedPreview
): ThreadPreview {
  return {
    title: hydratedPreview.humanTitle ?? fallbackThreadTitle(thread.thread_id),
    description: hydratedPreview.description,
    isUserDefinedTitle: false,
    hasHumanTitle: hydratedPreview.hasHumanTitle,
  };
}

export class LangGraphThreadRepository implements ThreadRepository {
  private readonly client: LangGraphClient;
  private identityScope?: Promise<string | null>;

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
    const identityScope = await this.getIdentityScope();
    const useCache = activateIdentityScope(
      this.options.deploymentUrl,
      identityScope
    );
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
    return mapWithConcurrency(
      threads,
      MAX_CONCURRENT_HYDRATIONS,
      async (thread) => {
        const preview = extractThreadPreview(thread);
        if (
          thread.status === "busy" ||
          preview.isUserDefinedTitle ||
          preview.hasHumanTitle ||
          !isThreadStatus(thread.status)
        ) {
          return this.toItem(thread, query.assistantId);
        }
        const cached =
          useCache && identityScope
            ? getCachedHydration(
                this.options.deploymentUrl,
                identityScope,
                thread
              )
            : undefined;
        if (cached) {
          return this.toItem(
            thread,
            query.assistantId,
            previewFromHydration(thread, cached.preview)
          );
        }
        try {
          const state = await this.client.threads.getState(thread.thread_id);
          const hydratedPreview = extractHydratedPreview(state.values);
          if (useCache && identityScope) {
            cacheHydration(
              this.options.deploymentUrl,
              identityScope,
              thread,
              hydratedPreview
            );
          }
          return this.toItem(
            { ...thread, values: state.values },
            query.assistantId
          );
        } catch {
          return this.toItem(thread, query.assistantId);
        }
      }
    );
  }

  async getStatus(threadId: string): Promise<ThreadStatus | null> {
    const thread = await this.client.threads.get(threadId);
    return thread.status ?? null;
  }

  private getIdentityScope(): Promise<string | null> {
    if (!this.identityScope) {
      this.identityScope = createIdentityScope(
        this.options.sessionToken ?? this.options.apiKey
      );
    }
    return this.identityScope;
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

  private toItem(
    thread: ThreadRecord,
    assistantId: string,
    preview = extractThreadPreview(thread)
  ): ThreadItem {
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
