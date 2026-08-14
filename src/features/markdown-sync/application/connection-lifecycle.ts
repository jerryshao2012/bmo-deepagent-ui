export type MarkdownConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "fallback"
  | "disconnected";

export const MARKDOWN_INACTIVITY_MS = 300_000;
export const MARKDOWN_AUTO_CLOSE_SECONDS = 5;
export const MARKDOWN_COUNTDOWN_TICK_MS = 1_000;
export const WEBSOCKET_ATTEMPT_TIMEOUT_MS = 10_000;
export const WEBSOCKET_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const WEBSOCKET_UPGRADE_INTERVAL_MS = 60_000;

export interface ConnectionScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MarkdownConnectionEffects {
  connectWebSocket(attemptId: number): void;
  abortWebSocketAttempt(attemptId: number): void;
  startFallback(): void;
  stopFallback(): void;
  /** Must be idempotent and restart-safe; stopAllTransports is its stop boundary. */
  startCrossDeploySync(): void;
  stopAllTransports(): void;
  setStatus(status: MarkdownConnectionStatus): void;
  setAutoCloseCountdown(seconds: number | null): void;
  requestAutoClose(): void;
}

const platformScheduler: ConnectionScheduler = {
  setTimeout(callback, delayMs) {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class MarkdownConnectionLifecycle {
  private dialogOpen = false;
  private visible = true;
  private sleeping = true;
  private ineligibleReconciled = false;
  private disposed = false;
  private fallbackActive = false;
  private upgradeAttempt = false;
  private webSocketOpen = false;
  private crossDeploySyncStarted = false;
  private retryIndex = 0;
  private nextAttemptId = 1;
  private activeAttemptId: number | undefined;
  private idleCycleEpoch = 0;
  private countdownSeconds: number | null = null;
  private closeRequested = false;

  private inactivityTimer: unknown;
  private countdownTimer: unknown;
  private attemptTimer: unknown;
  private retryTimer: unknown;
  private upgradeTimer: unknown;

  constructor(
    private readonly effects: MarkdownConnectionEffects,
    private readonly scheduler: ConnectionScheduler = platformScheduler,
  ) {}

  setDialogOpen(open: boolean): void {
    if (this.disposed) return;
    const changed = this.dialogOpen !== open;
    this.dialogOpen = open;
    this.applyEligibility(changed);
  }

  setVisibility(visible: boolean): void {
    if (this.disposed) return;
    const changed = this.visible !== visible;
    this.visible = visible;
    this.applyEligibility(changed);
  }

  recordActivity(): void {
    if (this.disposed || !this.isEligible() || this.closeRequested) return;

    if (this.sleeping) {
      this.wake();
      return;
    }

    this.armInactivityTimer();
  }

  socketOpened(attemptId: number): void {
    if (
      this.disposed ||
      attemptId !== this.activeAttemptId ||
      this.webSocketOpen
    ) {
      return;
    }
    if (!this.isEligible()) {
      this.hibernate();
      return;
    }

    this.clearAttemptTimer();
    this.clearRetryTimer();
    this.clearUpgradeTimer();
    this.retryIndex = 0;
    this.fallbackActive = false;
    this.upgradeAttempt = false;
    this.webSocketOpen = true;
    this.crossDeploySyncStarted = false;
    this.sleeping = false;
    this.effects.stopFallback();
    this.effects.setStatus("connected");
  }

  initialSyncReady(): void {
    if (
      this.disposed ||
      this.sleeping ||
      !this.webSocketOpen ||
      this.crossDeploySyncStarted
    ) {
      return;
    }

    this.crossDeploySyncStarted = true;
    this.effects.startCrossDeploySync();
  }

  fallbackReady(): void {
    if (
      this.disposed ||
      this.sleeping ||
      !this.fallbackActive ||
      this.crossDeploySyncStarted
    ) {
      return;
    }

    this.crossDeploySyncStarted = true;
    this.effects.startCrossDeploySync();
  }

  connectionFailed(attemptId: number): void {
    if (this.disposed || attemptId !== this.activeAttemptId) return;

    this.clearAttemptTimer();
    this.activeAttemptId = undefined;
    this.webSocketOpen = false;

    if (!this.isEligible()) {
      this.hibernate();
      return;
    }

    if (this.fallbackActive || this.upgradeAttempt) {
      this.upgradeAttempt = false;
      this.effects.setStatus("fallback");
      this.armUpgradeTimer();
      return;
    }

    if (this.retryIndex < WEBSOCKET_RETRY_DELAYS_MS.length) {
      const retryDelay = WEBSOCKET_RETRY_DELAYS_MS[this.retryIndex];
      this.retryIndex += 1;
      this.effects.setStatus("reconnecting");
      this.clearRetryTimer();
      this.retryTimer = this.scheduler.setTimeout(() => {
        this.retryTimer = undefined;
        if (this.disposed) return;
        if (!this.isEligible()) {
          this.hibernate();
          return;
        }
        this.beginWebSocketAttempt();
      }, retryDelay);
      return;
    }

    this.fallbackActive = true;
    this.upgradeAttempt = false;
    this.crossDeploySyncStarted = false;
    this.effects.startFallback();
    this.effects.setStatus("fallback");
    this.armUpgradeTimer();
  }

  reconnectNow(): void {
    if (this.disposed || !this.isEligible() || this.closeRequested) return;
    if (this.webSocketOpen) return;

    if (this.sleeping) {
      this.wake();
      return;
    }

    if (this.activeAttemptId !== undefined) {
      const attemptId = this.activeAttemptId;
      this.clearAttemptTimer();
      this.activeAttemptId = undefined;
      this.effects.abortWebSocketAttempt(attemptId);
    }
    this.clearRetryTimer();
    this.clearUpgradeTimer();

    if (this.fallbackActive) {
      this.upgradeAttempt = true;
      this.effects.setStatus("fallback");
    } else {
      this.retryIndex = 0;
      this.effects.setStatus("reconnecting");
    }

    this.beginWebSocketAttempt();
  }

  isEligible(): boolean {
    return !this.disposed && this.dialogOpen && this.visible;
  }

  dispose(): void {
    if (this.disposed) return;

    this.invalidateIdleCycle();
    this.disposed = true;
    this.clearTransportTimers();
    this.activeAttemptId = undefined;
    this.webSocketOpen = false;
    this.effects.stopAllTransports();
  }

  private applyEligibility(changed: boolean): void {
    if (!this.isEligible()) {
      if (changed) this.invalidateIdleCycle();
      if (!this.sleeping || !this.ineligibleReconciled) {
        this.hibernateTransports();
      }
      return;
    }

    if (this.sleeping && changed) this.wake();
  }

  private wake(): void {
    this.invalidateIdleCycle();
    this.clearTransportTimers();
    this.retryIndex = 0;
    this.fallbackActive = false;
    this.upgradeAttempt = false;
    this.webSocketOpen = false;
    this.activeAttemptId = undefined;
    this.crossDeploySyncStarted = false;
    this.sleeping = false;
    this.ineligibleReconciled = false;
    this.closeRequested = false;
    this.effects.stopFallback();
    this.armInactivityTimer();
    this.effects.setStatus("connecting");
    this.beginWebSocketAttempt();
  }

  private hibernate(): void {
    if (this.disposed) return;

    this.invalidateIdleCycle();
    this.hibernateTransports();
  }

  private hibernateTransports(): void {
    if (this.disposed) return;

    this.clearTransportTimers();
    this.retryIndex = 0;
    this.fallbackActive = false;
    this.upgradeAttempt = false;
    this.webSocketOpen = false;
    this.activeAttemptId = undefined;
    this.crossDeploySyncStarted = false;
    this.sleeping = true;
    this.ineligibleReconciled = true;
    this.effects.stopAllTransports();
    if (this.disposed || !this.sleeping) return;
    this.effects.setStatus("idle");
  }

  private beginWebSocketAttempt(): void {
    if (
      this.disposed ||
      !this.isEligible() ||
      this.activeAttemptId !== undefined
    ) {
      return;
    }

    this.clearAttemptTimer();
    const attemptId = this.nextAttemptId;
    this.nextAttemptId += 1;
    this.activeAttemptId = attemptId;
    this.effects.connectWebSocket(attemptId);
    if (this.activeAttemptId !== attemptId || this.webSocketOpen) return;

    this.attemptTimer = this.scheduler.setTimeout(() => {
      if (this.disposed || this.activeAttemptId !== attemptId) return;
      this.attemptTimer = undefined;
      this.effects.abortWebSocketAttempt(attemptId);
      this.connectionFailed(attemptId);
    }, WEBSOCKET_ATTEMPT_TIMEOUT_MS);
  }

  private armInactivityTimer(): void {
    this.invalidateIdleCycle();
    const epoch = this.idleCycleEpoch;
    const timer = this.scheduler.setTimeout(() => {
      if (this.inactivityTimer === timer) this.inactivityTimer = undefined;
      if (!this.isCurrentIdleCycle(epoch)) return;

      this.hibernateTransports();
      if (!this.isCurrentIdleCycle(epoch)) return;
      this.beginCountdown();
    }, MARKDOWN_INACTIVITY_MS);
    this.inactivityTimer = timer;
  }

  private beginCountdown(): void {
    this.idleCycleEpoch += 1;
    const epoch = this.idleCycleEpoch;
    this.publishCountdown(MARKDOWN_AUTO_CLOSE_SECONDS);
    if (!this.isCurrentIdleCycle(epoch)) return;
    this.armCountdownTick(epoch, MARKDOWN_AUTO_CLOSE_SECONDS - 1);
  }

  private armCountdownTick(epoch: number, remainingSeconds: number): void {
    this.clearCountdownTimer();
    const timer = this.scheduler.setTimeout(() => {
      if (this.countdownTimer === timer) this.countdownTimer = undefined;
      if (!this.isCurrentIdleCycle(epoch)) return;

      if (remainingSeconds > 0) {
        this.publishCountdown(remainingSeconds);
        if (!this.isCurrentIdleCycle(epoch)) return;
        this.armCountdownTick(epoch, remainingSeconds - 1);
        return;
      }

      this.closeRequested = true;
      this.idleCycleEpoch += 1;
      const closeEpoch = this.idleCycleEpoch;
      this.publishCountdown(null);
      if (!this.isCurrentCloseRequest(closeEpoch)) return;
      this.effects.requestAutoClose();
    }, MARKDOWN_COUNTDOWN_TICK_MS);
    this.countdownTimer = timer;
  }

  private isCurrentIdleCycle(epoch: number): boolean {
    return (
      epoch === this.idleCycleEpoch &&
      !this.disposed &&
      this.dialogOpen &&
      this.visible &&
      !this.closeRequested
    );
  }

  private isCurrentCloseRequest(epoch: number): boolean {
    return (
      epoch === this.idleCycleEpoch &&
      !this.disposed &&
      this.dialogOpen &&
      this.visible &&
      this.closeRequested
    );
  }

  private invalidateIdleCycle(): void {
    this.idleCycleEpoch += 1;
    this.clearInactivityTimer();
    this.clearCountdownTimer();
    this.publishCountdown(null);
  }

  private publishCountdown(seconds: number | null): void {
    if (this.countdownSeconds === seconds) return;
    this.countdownSeconds = seconds;
    this.effects.setAutoCloseCountdown(seconds);
  }

  private armUpgradeTimer(): void {
    this.clearUpgradeTimer();
    this.upgradeTimer = this.scheduler.setTimeout(() => {
      this.upgradeTimer = undefined;
      if (this.disposed) return;
      if (!this.isEligible()) {
        this.hibernate();
        return;
      }
      if (!this.fallbackActive) return;

      this.upgradeAttempt = true;
      this.beginWebSocketAttempt();
    }, WEBSOCKET_UPGRADE_INTERVAL_MS);
  }

  private clearTransportTimers(): void {
    this.clearAttemptTimer();
    this.clearRetryTimer();
    this.clearUpgradeTimer();
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer === undefined) return;
    this.scheduler.clearTimeout(this.inactivityTimer);
    this.inactivityTimer = undefined;
  }

  private clearCountdownTimer(): void {
    if (this.countdownTimer === undefined) return;
    this.scheduler.clearTimeout(this.countdownTimer);
    this.countdownTimer = undefined;
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer === undefined) return;
    this.scheduler.clearTimeout(this.attemptTimer);
    this.attemptTimer = undefined;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === undefined) return;
    this.scheduler.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private clearUpgradeTimer(): void {
    if (this.upgradeTimer === undefined) return;
    this.scheduler.clearTimeout(this.upgradeTimer);
    this.upgradeTimer = undefined;
  }
}
