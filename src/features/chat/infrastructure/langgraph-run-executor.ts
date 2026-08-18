import type { RunExecutor } from "../application/ports";

interface LangGraphStreamCommands {
  submit(values?: unknown, options?: unknown): unknown;
  stop(): unknown;
}

interface SubmissionLifecycle {
  onAccepted?: () => void;
}

interface PendingSubmission {
  stream: LangGraphStreamCommands;
  values: unknown;
  options: Record<string, unknown>;
  onAccepted?: () => void;
  accepted: boolean;
}

export class LangGraphRunExecutor implements RunExecutor {
  private static readonly MAX_REMEMBERED_CREATED_RUN_IDS = 128;
  private stream: LangGraphStreamCommands;
  private readonly queuedSubmissions: PendingSubmission[] = [];
  private inFlightSubmission: PendingSubmission | null = null;
  private readonly createdRunIds = new Map<string, undefined>();

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
      // Capture committed stream when caller submits. A later thread render
      // must not redirect this queued request to another thread's stream.
      stream: this.stream,
      values,
      options: streamOptions,
      onAccepted: lifecycle?.onAccepted,
      accepted: false,
    };
    streamOptions.streamSubgraphs = true;
    this.queuedSubmissions.push(pendingSubmission);
    this.startNextSubmission();
  }

  onRunCreated(runId?: string): void {
    if (runId && !this.rememberCreatedRun(runId)) return;

    const pendingSubmission = this.inFlightSubmission;
    if (!pendingSubmission || pendingSubmission.accepted) return;

    pendingSubmission.accepted = true;
    try {
      pendingSubmission.onAccepted?.();
    } catch (error) {
      console.error("Run acceptance callback failed:", error);
    }
  }

  onRunError(runId?: string): void {
    // Completion owns queue advancement so terminal callbacks cannot consume
    // a later request that has not reached the SDK yet.
  }

  onRunFinished(runId?: string): void {
    // Completion owns queue advancement so terminal callbacks cannot consume
    // a later request that has not reached the SDK yet.
  }

  stop(): void {
    (this.inFlightSubmission?.stream ?? this.stream).stop();
  }

  private startNextSubmission(): void {
    if (this.inFlightSubmission) return;

    const pendingSubmission = this.queuedSubmissions.shift();
    if (!pendingSubmission) return;

    this.inFlightSubmission = pendingSubmission;
    try {
      // The SDK invokes onCreated before its submit Promise settles. Legacy
      // void handles must likewise create synchronously before returning.
      void Promise.resolve(
        pendingSubmission.stream.submit(
          pendingSubmission.values,
          pendingSubmission.options
        )
      )
        .finally(() => {
          this.completeSubmission(pendingSubmission);
        })
        .catch(() => {});
    } catch (error) {
      this.completeSubmission(pendingSubmission);
      throw error;
    }
  }

  private completeSubmission(pendingSubmission: PendingSubmission): void {
    if (this.inFlightSubmission !== pendingSubmission) return;
    this.inFlightSubmission = null;
    this.startNextSubmission();
  }

  private rememberCreatedRun(runId: string): boolean {
    if (this.createdRunIds.has(runId)) {
      this.createdRunIds.delete(runId);
      this.createdRunIds.set(runId, undefined);
      return false;
    }

    this.createdRunIds.set(runId, undefined);
    if (
      this.createdRunIds.size >
      LangGraphRunExecutor.MAX_REMEMBERED_CREATED_RUN_IDS
    ) {
      const oldestRunId = this.createdRunIds.keys().next().value;
      if (oldestRunId) this.createdRunIds.delete(oldestRunId);
    }
    return true;
  }
}
