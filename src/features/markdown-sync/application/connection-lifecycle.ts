export type MarkdownConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "fallback"
  | "disconnected";

export const MARKDOWN_INACTIVITY_MS = 300_000;
export const WEBSOCKET_ATTEMPT_TIMEOUT_MS = 10_000;
export const WEBSOCKET_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const WEBSOCKET_UPGRADE_INTERVAL_MS = 60_000;

export interface ConnectionScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MarkdownConnectionEffects {
  connectWebSocket(): void;
  abortWebSocketAttempt(): void;
  startFallback(): void;
  stopFallback(): void;
  startCrossDeploySync(): void;
  stopAllTransports(): void;
  setStatus(status: MarkdownConnectionStatus): void;
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

  private inactivityTimer: unknown;
  private attemptTimer: unknown;
  private retryTimer: unknown;
  private upgradeTimer: unknown;

  constructor(
    private readonly effects: MarkdownConnectionEffects,
    private readonly scheduler: ConnectionScheduler = platformScheduler,
  ) {}

  setDialogOpen(open: boolean): void {
    if (this.disposed) return;
    this.dialogOpen = open;
    this.applyEligibility();
  }

  setVisibility(visible: boolean): void {
    if (this.disposed) return;
    this.visible = visible;
    this.applyEligibility();
  }

  recordActivity(): void {
    if (this.disposed || !this.isEligible()) return;

    if (this.sleeping) {
      this.wake();
      return;
    }

    this.armInactivityTimer();
  }

  socketOpened(): void {
    if (this.disposed) return;
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

  connectionFailed(): void {
    if (this.disposed) return;

    this.clearAttemptTimer();
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
    if (this.disposed || !this.isEligible()) return;

    if (this.sleeping) {
      this.wake();
      return;
    }

    if (this.attemptTimer !== undefined) {
      this.clearAttemptTimer();
      this.effects.abortWebSocketAttempt();
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

    this.disposed = true;
    this.clearEveryTimer();
    this.effects.stopAllTransports();
  }

  private applyEligibility(): void {
    if (!this.isEligible()) {
      if (!this.sleeping || !this.ineligibleReconciled) this.hibernate();
      return;
    }

    if (this.sleeping) this.wake();
  }

  private wake(): void {
    this.clearEveryTimer();
    this.retryIndex = 0;
    this.fallbackActive = false;
    this.upgradeAttempt = false;
    this.webSocketOpen = false;
    this.crossDeploySyncStarted = false;
    this.sleeping = false;
    this.ineligibleReconciled = false;
    this.effects.stopFallback();
    this.armInactivityTimer();
    this.effects.setStatus("connecting");
    this.beginWebSocketAttempt();
  }

  private hibernate(): void {
    if (this.disposed) return;

    this.clearEveryTimer();
    this.retryIndex = 0;
    this.fallbackActive = false;
    this.upgradeAttempt = false;
    this.webSocketOpen = false;
    this.crossDeploySyncStarted = false;
    this.sleeping = true;
    this.ineligibleReconciled = true;
    this.effects.stopAllTransports();
    this.effects.setStatus("idle");
  }

  private beginWebSocketAttempt(): void {
    if (this.disposed || !this.isEligible()) return;

    this.clearAttemptTimer();
    this.effects.connectWebSocket();
    this.attemptTimer = this.scheduler.setTimeout(() => {
      this.attemptTimer = undefined;
      if (this.disposed) return;
      this.effects.abortWebSocketAttempt();
      this.connectionFailed();
    }, WEBSOCKET_ATTEMPT_TIMEOUT_MS);
  }

  private armInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = this.scheduler.setTimeout(() => {
      this.inactivityTimer = undefined;
      if (this.disposed || !this.isEligible()) return;
      this.hibernate();
    }, MARKDOWN_INACTIVITY_MS);
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

  private clearEveryTimer(): void {
    this.clearInactivityTimer();
    this.clearAttemptTimer();
    this.clearRetryTimer();
    this.clearUpgradeTimer();
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer === undefined) return;
    this.scheduler.clearTimeout(this.inactivityTimer);
    this.inactivityTimer = undefined;
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
