export const THREAD_SNAPSHOT_POLL_MS = 2_500;
export const THREAD_SNAPSHOT_RETRY_MS = [
  5_000, 10_000, 20_000, 30_000,
] as const;

export interface ThreadSnapshotPollerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const platformScheduler: ThreadSnapshotPollerScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

function isMissingSnapshot(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  return (
    candidate.status === 404 ||
    candidate.statusCode === 404 ||
    candidate.response?.status === 404
  );
}

export class ThreadSnapshotPoller<T> {
  private active = false;
  private epoch = 0;
  private retryIndex = 0;
  private timer: unknown | null = null;

  constructor(
    private readonly request: () => Promise<T>,
    private readonly deliver: (value: T) => void,
    private readonly scheduler: ThreadSnapshotPollerScheduler = platformScheduler
  ) {}

  start(): void {
    if (this.active) return;
    this.stop();
    this.active = true;
    this.retryIndex = 0;
    const epoch = ++this.epoch;
    void this.requestSnapshot(epoch);
  }

  stop(): void {
    this.active = false;
    this.epoch += 1;
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private isActive(epoch: number): boolean {
    return this.active && this.epoch === epoch;
  }

  private async requestSnapshot(epoch: number): Promise<void> {
    let value: T;
    try {
      value = await this.request();
    } catch (error) {
      if (!this.isActive(epoch) || isMissingSnapshot(error)) return;
      this.scheduleRetry(epoch);
      return;
    }

    if (!this.isActive(epoch)) return;
    this.retryIndex = 0;
    if (!this.isActive(epoch)) return;
    try {
      this.deliver(value);
    } catch {
      if (!this.isActive(epoch)) return;
      this.scheduleRetry(epoch);
      return;
    }
    if (!this.isActive(epoch)) return;
    this.schedule(epoch, THREAD_SNAPSHOT_POLL_MS);
  }

  private scheduleRetry(epoch: number): void {
    const delay = THREAD_SNAPSHOT_RETRY_MS[this.retryIndex];
    this.retryIndex = Math.min(
      this.retryIndex + 1,
      THREAD_SNAPSHOT_RETRY_MS.length - 1
    );
    if (!this.isActive(epoch)) return;
    this.schedule(epoch, delay);
  }

  private schedule(epoch: number, delayMs: number): void {
    if (!this.isActive(epoch)) return;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (!this.isActive(epoch)) return;
      void this.requestSnapshot(epoch);
    }, delayMs);
  }
}
