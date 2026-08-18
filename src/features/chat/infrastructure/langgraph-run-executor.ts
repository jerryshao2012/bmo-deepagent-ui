import type { RunExecutor } from "../application/ports";

interface LangGraphStreamCommands {
  submit(values?: unknown, options?: unknown): unknown;
  stop(): unknown;
}

interface SubmissionLifecycle {
  onAccepted?: () => void;
}

type StreamOwnerKey = string | null;

interface ActiveStream {
  ownerKey: StreamOwnerKey;
  commands: LangGraphStreamCommands;
}

interface PendingSubmission {
  ownerKey: StreamOwnerKey;
  values: unknown;
  options: Record<string, unknown>;
  onAccepted?: () => void;
  accepted: boolean;
}

export class LangGraphRunExecutor implements RunExecutor {
  private static readonly MAX_REMEMBERED_CREATED_RUN_IDS = 128;
  private static readonly MAX_QUEUED_SUBMISSIONS = 128;
  private currentStream: ActiveStream | null;
  private readonly queuedSubmissions: PendingSubmission[] = [];
  private inFlightSubmission: PendingSubmission | null = null;
  private readonly createdRunIds = new Map<string, undefined>();

  constructor(
    stream?: LangGraphStreamCommands,
    ownerKey: StreamOwnerKey = "default"
  ) {
    this.currentStream = stream ? { ownerKey, commands: stream } : null;
  }

  setStream(stream: LangGraphStreamCommands, ownerKey: StreamOwnerKey): void {
    this.currentStream = { ownerKey, commands: stream };
    this.startNextSubmission();
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
    const currentStream = this.currentStream;
    if (!currentStream) {
      throw new Error("Cannot submit before a stream owner is committed");
    }
    if (
      this.queuedSubmissions.length >=
      LangGraphRunExecutor.MAX_QUEUED_SUBMISSIONS
    ) {
      throw new Error("Too many queued stream submissions");
    }

    const pendingSubmission: PendingSubmission = {
      // Preserve thread ownership but resolve its stream handle only when
      // that owner is committed again. Render-specific handles are stale.
      ownerKey: currentStream.ownerKey,
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
    if (
      this.inFlightSubmission &&
      this.currentStream &&
      this.inFlightSubmission.ownerKey === this.currentStream.ownerKey
    ) {
      this.currentStream.commands.stop();
    }
  }

  private startNextSubmission(): void {
    if (this.inFlightSubmission) return;

    const currentStream = this.currentStream;
    if (!currentStream) return;

    // FIFO is preserved per owner. Work for inactive owners stays dormant
    // instead of invoking an old handle from a different committed thread.
    const pendingIndex = this.queuedSubmissions.findIndex(
      (pendingSubmission) =>
        pendingSubmission.ownerKey === currentStream.ownerKey
    );
    if (pendingIndex === -1) return;
    const pendingSubmission = this.queuedSubmissions.splice(pendingIndex, 1)[0];
    if (!pendingSubmission) return;

    this.inFlightSubmission = pendingSubmission;
    try {
      // The SDK invokes onCreated before its submit Promise settles. Legacy
      // void handles must likewise create synchronously before returning.
      void Promise.resolve(
        currentStream.commands.submit(
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
