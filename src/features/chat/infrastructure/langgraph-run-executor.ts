import type { RunExecutor } from "../application/ports";

interface LangGraphStreamCommands {
  submit(values?: unknown, options?: unknown): unknown;
  stop(): unknown;
}

export class LangGraphRunExecutor implements RunExecutor {
  private readonly pendingSubmissions: Array<{
    onAccepted?: () => void;
    accepted: boolean;
  }> = [];
  private readonly acceptedRunIds = new Set<string>();

  constructor(private readonly stream: LangGraphStreamCommands) {}

  submit(
    values?: unknown,
    options?: unknown,
    lifecycle?: { onAccepted?: () => void }
  ): Promise<void> {
    const streamOptions =
      options && typeof options === "object"
        ? { ...options, streamSubgraphs: true }
        : { streamSubgraphs: true };
    const pendingSubmission = {
      onAccepted: lifecycle?.onAccepted,
      accepted: false,
    };
    this.pendingSubmissions.push(pendingSubmission);

    try {
      return Promise.resolve(this.stream.submit(values, streamOptions))
        .then(() => undefined)
        .catch((error) => {
          if (!pendingSubmission.accepted) {
            this.removePendingSubmission(pendingSubmission);
          }
          throw error;
        });
    } catch (error) {
      this.removePendingSubmission(pendingSubmission);
      throw error;
    }
  }

  acceptNextRun(runId?: string): void {
    if (runId && this.acceptedRunIds.has(runId)) return;
    if (runId) this.acceptedRunIds.add(runId);

    const pendingSubmission = this.pendingSubmissions.shift();
    if (!pendingSubmission || pendingSubmission.accepted) return;

    pendingSubmission.accepted = true;
    pendingSubmission.onAccepted?.();
  }

  stop(): void {
    this.stream.stop();
  }

  private removePendingSubmission(pendingSubmission: {
    onAccepted?: () => void;
    accepted: boolean;
  }): void {
    const pendingIndex = this.pendingSubmissions.indexOf(pendingSubmission);
    if (pendingIndex !== -1) {
      this.pendingSubmissions.splice(pendingIndex, 1);
    }
  }
}
