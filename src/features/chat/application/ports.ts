export interface ThreadSnapshot<State> {
  updatedAt?: string;
  values?: State;
}

export interface ChatGateway<State> {
  getThreadSnapshot(threadId: string): Promise<ThreadSnapshot<State>>;
  updateFiles(threadId: string, files: Record<string, unknown>): Promise<void>;
}

export interface RunExecutor {
  submit(
    values?: unknown,
    options?: unknown,
    lifecycle?: { onAccepted?: () => void }
  ): Promise<void>;
  acceptNextRun(runId?: string): void;
  stop(): void;
}
