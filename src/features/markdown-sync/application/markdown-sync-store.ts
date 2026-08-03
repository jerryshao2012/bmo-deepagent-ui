export interface MarkdownSyncStore {
  load(markdownId: string): Promise<string | null>;
  save(markdownId: string, content: string): Promise<void>;
  remove(markdownId: string): Promise<void>;
}
