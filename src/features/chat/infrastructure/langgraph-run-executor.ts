import type { RunExecutor } from "../application/ports";

interface LangGraphStreamCommands {
  submit(values?: unknown, options?: unknown): unknown;
  stop(): unknown;
}

export class LangGraphRunExecutor implements RunExecutor {
  constructor(private readonly stream: LangGraphStreamCommands) {}

  submit(values?: unknown, options?: unknown): void {
    this.stream.submit(values, options);
  }

  stop(): void {
    this.stream.stop();
  }
}
