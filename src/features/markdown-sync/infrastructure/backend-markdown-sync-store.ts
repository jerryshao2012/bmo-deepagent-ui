import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { authenticatedFetch } from "@/platform/http/authenticated-fetch";

import type { MarkdownSyncStore } from "../application/markdown-sync-store";

export class BackendMarkdownSyncStore implements MarkdownSyncStore {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async load(markdownId: string): Promise<string | null> {
    const response = await authenticatedFetch(this.url(markdownId), {
      headers: this.headers(),
    });
    if (!response.ok)
      throw new Error(`Markdown sync load failed (${response.status})`);
    const data = await response.json();
    const content = data?.values?.markdown_content;
    return typeof content === "string" ? content : null;
  }

  async save(markdownId: string, content: string): Promise<void> {
    const response = await authenticatedFetch(this.url(markdownId), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ values: { markdown_content: content } }),
    });
    if (!response.ok)
      throw new Error(`Markdown sync failed (${response.status})`);
  }

  async remove(markdownId: string): Promise<void> {
    await this.save(markdownId, "");
  }

  private url(markdownId: string): string {
    return `${this.baseUrl}/chat_threads/${markdownId}/state`;
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", "X-API-Key": this.token };
  }
}

export function createConfiguredBackendMarkdownSyncStore(): BackendMarkdownSyncStore | null {
  const config = getConfig();
  if (!config) return null;
  return new BackendMarkdownSyncStore(
    config.deploymentUrl.replace(/\/+$/, ""),
    getBrowserSessionToken() || ""
  );
}
