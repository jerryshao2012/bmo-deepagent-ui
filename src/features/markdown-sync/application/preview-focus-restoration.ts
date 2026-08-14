export interface AnimationFrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

export class PreviewFocusRestoration {
  private handle: number | null = null;

  constructor(private readonly scheduler: AnimationFrameScheduler) {}

  schedule(restore: () => void, shouldRestore: () => boolean): void {
    this.cancel();
    this.handle = this.scheduler.request(() => {
      this.handle = null;
      if (shouldRestore()) restore();
    });
  }

  cancel(): void {
    if (this.handle === null) return;
    this.scheduler.cancel(this.handle);
    this.handle = null;
  }
}
