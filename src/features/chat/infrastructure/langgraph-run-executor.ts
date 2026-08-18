import type { RunExecutor } from "../application/ports";

interface LangGraphStreamCommands {
  submit(values?: unknown, options?: unknown): unknown;
  stop(): unknown;
}

interface SubmissionLifecycle {
  onAccepted?: () => void;
}

interface PendingSubmission {
  onAccepted?: () => void;
}

export class LangGraphRunExecutor implements RunExecutor {
  private stream: LangGraphStreamCommands;
  private readonly pendingSubmissions: PendingSubmission[] = [];
  private readonly createdRunIds = new Set<string>();

  constructor(stream: LangGraphStreamCommands) {
    this.stream = stream;
  }

  setStream(stream: LangGraphStreamCommands): void {
    this.stream = stream;
  }

  submit(
    values?: unknown,
    options?: unknown,
    lifecycle?: SubmissionLifecycle
  ): void {
    const streamOptions: Record<string, unknown> =
      options && typeof options === "object"
        ? { ...(options as Record<string, unknown>) }
        : {};
    const pendingSubmission: PendingSubmission = {
      onAccepted: lifecycle?.onAccepted,
    };
    this.pendingSubmissions.push(pendingSubmission);
    streamOptions.streamSubgraphs = true;

    try {
      // The SDK invokes onCreated before its submit Promise settles. Legacy
      // void handles must likewise create synchronously before returning.
      void Promise.resolve(this.stream.submit(values, streamOptions))
        .finally(() => {
          this.retireSubmission(pendingSubmission);
        })
        .catch(() => {});
    } catch (error) {
      this.retireSubmission(pendingSubmission);
      throw error;
    }
  }

  onRunCreated(runId?: string): void {
    if (runId && this.createdRunIds.has(runId)) return;
    if (runId) this.createdRunIds.add(runId);

    const pendingSubmission = this.pendingSubmissions.shift();
    if (!pendingSubmission) return;

    try {
      pendingSubmission.onAccepted?.();
    } catch (error) {
      console.error("Run acceptance callback failed:", error);
    }
  }

  onRunError(runId?: string): void {
    if (runId) return;
    this.retireFirstUncreatedSubmission();
  }

  onRunFinished(runId?: string): void {
    if (runId) return;
    this.retireFirstUncreatedSubmission();
  }

  stop(): void {
    this.stream.stop();
  }

  private retireSubmission(pendingSubmission: PendingSubmission): void {
    const pendingIndex = this.pendingSubmissions.indexOf(pendingSubmission);
    if (pendingIndex !== -1) {
      this.pendingSubmissions.splice(pendingIndex, 1);
    }
  }

  private retireFirstUncreatedSubmission(): void {
    this.pendingSubmissions.shift();
  }
}
