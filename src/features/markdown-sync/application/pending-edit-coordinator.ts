export interface PendingMarkdownEdit {
  readonly content: string;
  readonly operationId: number;
  readonly immediate: boolean;
  readonly threadId: string;
}

export interface MarkdownWebSocketSyncMessage {
  readonly content: string;
  readonly initial?: unknown;
  readonly clientId?: unknown;
  readonly operationId?: unknown;
}

export type MarkdownWebSocketSyncResolution =
  | { readonly action: "apply"; readonly acknowledgeOperationId?: number }
  | { readonly action: "ignore" }
  | { readonly action: "resend" };

export function resolveMarkdownWebSocketSync({
  incoming,
  localClientId,
  pendingEdit,
}: {
  incoming: MarkdownWebSocketSyncMessage;
  localClientId: string;
  pendingEdit: PendingMarkdownEdit | null;
}): MarkdownWebSocketSyncResolution {
  if (!pendingEdit) return { action: "apply" };
  if (
    incoming.content === pendingEdit.content &&
    incoming.clientId === localClientId &&
    incoming.operationId === pendingEdit.operationId
  ) {
    return {
      action: "apply",
      acknowledgeOperationId: pendingEdit.operationId,
    };
  }
  return incoming.initial === true
    ? { action: "resend" }
    : { action: "ignore" };
}

export interface FallbackWriteContext {
  readonly generation: number;
  readonly signal: AbortSignal;
}

export type FallbackWriter = (
  edit: PendingMarkdownEdit,
  context: FallbackWriteContext
) => Promise<void>;

export interface FallbackCoordinatorCallbacks {
  onReady?(): void;
  onWriteError?(error: unknown): void;
}

export interface PendingEditCoordinatorScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type MarkdownCurrentRead<T> =
  | { readonly current: true; readonly value: T }
  | { readonly current: false };

const FALLBACK_WRITE_RETRY_MS = 1_000;

const platformScheduler: PendingEditCoordinatorScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

interface ActiveFallback {
  readonly generation: number;
  readonly threadId: string;
  readonly abortController: AbortController;
  readonly writer: FallbackWriter;
  readonly callbacks: FallbackCoordinatorCallbacks;
  initialSeen: boolean;
  readySignaled: boolean;
  inFlightOperationId: number | null;
  retryHandle: unknown | null;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export class MarkdownPendingEditCoordinator {
  private activeFallback: ActiveFallback | null = null;
  private currentThreadId: string | null = null;
  private editGeneration = 0;
  private nextFallbackGeneration = 1;
  private nextOperationId = 1;
  private pendingEdit: PendingMarkdownEdit | null = null;

  constructor(
    private readonly scheduler: PendingEditCoordinatorScheduler = platformScheduler
  ) {}

  switchThread(threadId: string): void {
    if (this.currentThreadId === threadId) return;
    this.stopFallback();
    this.currentThreadId = threadId;
    this.editGeneration += 1;
    if (this.pendingEdit?.threadId !== threadId) this.pendingEdit = null;
  }

  publish(
    threadId: string,
    content: string,
    immediate: boolean
  ): PendingMarkdownEdit {
    if (this.currentThreadId !== threadId) this.switchThread(threadId);
    const edit: PendingMarkdownEdit = Object.freeze({
      content,
      operationId: this.nextOperationId++,
      immediate,
      threadId,
    });
    this.editGeneration += 1;
    this.pendingEdit = edit;
    const active = this.activeFallback;
    if (active?.threadId === threadId && active.initialSeen) {
      this.clearRetry(active);
      this.flushFallback(active.generation);
    }
    return edit;
  }

  pendingForThread(threadId: string): PendingMarkdownEdit | null {
    return this.pendingEdit?.threadId === threadId ? this.pendingEdit : null;
  }

  async readCurrent<T>(
    threadId: string,
    read: () => Promise<T>
  ): Promise<MarkdownCurrentRead<T>> {
    if (
      this.currentThreadId !== threadId ||
      this.pendingForThread(threadId) !== null
    ) {
      return { current: false };
    }
    const generation = this.editGeneration;
    const value = await read();
    if (
      this.currentThreadId !== threadId ||
      this.editGeneration !== generation ||
      this.pendingForThread(threadId) !== null
    ) {
      return { current: false };
    }
    return { current: true, value };
  }

  acknowledgeWebSocket(threadId: string, operationId: number): boolean {
    if (
      this.pendingEdit?.threadId !== threadId ||
      this.pendingEdit.operationId !== operationId
    ) {
      return false;
    }
    this.pendingEdit = null;
    return true;
  }

  startFallback(
    threadId: string,
    writer: FallbackWriter,
    callbacks: FallbackCoordinatorCallbacks = {}
  ): number {
    if (this.currentThreadId !== threadId) {
      this.switchThread(threadId);
    } else {
      this.stopFallback();
    }
    const generation = this.nextFallbackGeneration++;
    this.activeFallback = {
      generation,
      threadId,
      abortController: new AbortController(),
      writer,
      callbacks,
      initialSeen: false,
      readySignaled: false,
      inFlightOperationId: null,
      retryHandle: null,
    };
    return generation;
  }

  stopFallback(): void {
    const active = this.activeFallback;
    this.activeFallback = null;
    if (active) {
      this.clearRetry(active);
      active.abortController.abort();
    }
  }

  markFallbackInitialSeen(generation: number): void {
    const active = this.getActiveFallback(generation);
    if (!active) return;
    active.initialSeen = true;
    this.signalReady(active);
    this.flushFallback(generation);
  }

  flushFallback(generation: number): void {
    const active = this.getActiveFallback(generation);
    if (!active || !active.initialSeen || active.inFlightOperationId !== null) {
      return;
    }
    this.clearRetry(active);
    const edit = this.pendingForThread(active.threadId);
    if (!edit) {
      this.signalReady(active);
      return;
    }
    active.inFlightOperationId = edit.operationId;
    void this.runFallbackWrite(active, edit);
  }

  flushActiveFallback(threadId: string): void {
    const active = this.activeFallback;
    if (active?.threadId === threadId) this.flushFallback(active.generation);
  }

  private getActiveFallback(generation: number): ActiveFallback | null {
    const active = this.activeFallback;
    return active?.generation === generation ? active : null;
  }

  private isActive(active: ActiveFallback): boolean {
    return this.activeFallback === active;
  }

  private async runFallbackWrite(
    active: ActiveFallback,
    edit: PendingMarkdownEdit
  ): Promise<void> {
    let accepted = false;
    try {
      await active.writer(edit, {
        generation: active.generation,
        signal: active.abortController.signal,
      });
      if (!this.isActive(active)) return;
      accepted = true;
      if (
        this.pendingEdit?.threadId === edit.threadId &&
        this.pendingEdit.operationId === edit.operationId
      ) {
        this.pendingEdit = null;
      }
    } catch (error) {
      if (this.isActive(active) && !isAbortError(error)) {
        active.callbacks.onWriteError?.(error);
      }
    } finally {
      if (
        this.isActive(active) &&
        active.inFlightOperationId === edit.operationId
      ) {
        active.inFlightOperationId = null;
        this.signalReady(active);
        const latest = this.pendingForThread(active.threadId);
        if (latest && (accepted || latest.operationId !== edit.operationId)) {
          this.flushFallback(active.generation);
        } else if (latest) {
          this.scheduleRetry(active);
        }
      }
    }
  }

  private signalReady(active: ActiveFallback): void {
    if (
      !active.initialSeen ||
      active.readySignaled ||
      this.pendingForThread(active.threadId) !== null
    ) {
      return;
    }
    active.readySignaled = true;
    active.callbacks.onReady?.();
  }

  private scheduleRetry(active: ActiveFallback): void {
    if (active.retryHandle !== null || !this.isActive(active)) return;
    active.retryHandle = this.scheduler.setTimeout(() => {
      if (!this.isActive(active)) return;
      active.retryHandle = null;
      this.flushFallback(active.generation);
    }, FALLBACK_WRITE_RETRY_MS);
  }

  private clearRetry(active: ActiveFallback): void {
    if (active.retryHandle === null) return;
    this.scheduler.clearTimeout(active.retryHandle);
    active.retryHandle = null;
  }
}
