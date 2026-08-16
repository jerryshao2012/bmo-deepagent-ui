import type { RunExecutor } from "../application/ports";

interface LangGraphStreamCommands {
  submit(values?: unknown, options?: unknown): unknown;
  stop(): unknown;
}

export class LangGraphRunExecutor implements RunExecutor {
  constructor(private readonly stream: LangGraphStreamCommands) {}

  submit(values?: unknown, options?: unknown): void {
    const streamOptions =
      options && typeof options === "object"
        ? { ...options, streamSubgraphs: true }
        : { streamSubgraphs: true };

    this.stream.submit(values, streamOptions);
  }

  stop(): void {
    this.stream.stop();
  }
}
