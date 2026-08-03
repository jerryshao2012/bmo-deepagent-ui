export type ThreadStatus = "idle" | "busy" | "interrupted" | "error";

export interface ThreadItem {
  id: string;
  createdAt?: Date;
  updatedAt: Date;
  status: ThreadStatus;
  title: string;
  description: string;
  assistantId?: string;
  isUserDefinedTitle?: boolean;
  isFavorite?: boolean;
}

export interface ThreadSearchQuery {
  assistantId: string;
  status?: ThreadStatus | "favorite";
  pageIndex: number;
  pageSize: number;
}

export interface ThreadRepository {
  search(query: ThreadSearchQuery): Promise<ThreadItem[]>;
  getStatus(threadId: string): Promise<ThreadStatus | null>;
  delete(threadId: string): Promise<void>;
  updateTitle(threadId: string, title: string): Promise<void>;
  updateFavorite(threadId: string, isFavorite: boolean): Promise<void>;
  cleanupOlderThan(days: number): Promise<void>;
}
