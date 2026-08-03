import type { MarkdownSyncStore } from "../application/markdown-sync-store";

const PREFIX = "markdown_thread_";

export class BrowserMarkdownSyncStore implements MarkdownSyncStore {
  async load(markdownId: string): Promise<string | null> {
    return localStorage.getItem(this.key(markdownId));
  }

  async save(markdownId: string, content: string): Promise<void> {
    if (content) localStorage.setItem(this.key(markdownId), content);
    else localStorage.removeItem(this.key(markdownId));
  }

  async remove(markdownId: string): Promise<void> {
    localStorage.removeItem(this.key(markdownId));
  }

  clearAll(): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  }

  private key(markdownId: string): string {
    return `${PREFIX}${markdownId}`;
  }
}
