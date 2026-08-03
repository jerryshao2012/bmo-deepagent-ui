import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { authenticatedFetch } from "@/platform/http/authenticated-fetch";

import type {
  WikiGateway,
  WikiGraph,
  WikiTree,
} from "../application/wiki-gateway";

export class HttpWikiGateway implements WikiGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async getTree(threadId: string): Promise<WikiTree> {
    const response = await this.request(`/threads/${threadId}/wiki/tree`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          "Wiki workspace not found. Please wait for document ingestion or trigger ingest."
        );
      }
      throw new Error(`Failed to fetch wiki tree (${response.status})`);
    }
    const payload = await response.json();
    return { tree: payload.tree, fileCount: payload.file_count };
  }

  async getFile(threadId: string, path: string): Promise<string> {
    const response = await this.request(
      `/threads/${threadId}/wiki/file?path=${encodeURIComponent(path)}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch file content (${response.status})`);
    }
    const payload = await response.json();
    return payload.content || "";
  }

  async getGraph(threadId: string): Promise<WikiGraph> {
    const response = await this.request(`/threads/${threadId}/wiki/graph`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.detail ?? `HTTP ${response.status}`);
    }
    return response.json();
  }

  private request(path: string): Promise<Response> {
    return authenticatedFetch(`${this.baseUrl}${path}`, {
      headers: this.token ? { "X-API-Key": this.token } : {},
    });
  }
}

export function createConfiguredWikiGateway(): WikiGateway {
  const baseUrl = (getConfig()?.deploymentUrl || "").replace(/\/+$/, "");
  return new HttpWikiGateway(baseUrl, getBrowserSessionToken());
}
