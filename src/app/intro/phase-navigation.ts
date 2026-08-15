export type IntroPhaseId = "phase1" | "phase2" | "phase3";

export interface PhaseNavigationEvent {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
}

export interface PhaseNavigationTarget {
  scrollIntoView(options: ScrollIntoViewOptions): void;
}

export interface PhaseNavigationEnvironment {
  currentHash(): string;
  findTarget(id: IntroPhaseId): PhaseNavigationTarget | null;
  prefersReducedMotion(): boolean;
  pushHash(hash: string): void;
}

const browserPhaseNavigationEnvironment: PhaseNavigationEnvironment = {
  currentHash: () => window.location.hash,
  findTarget: (id) => document.getElementById(id),
  prefersReducedMotion: () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  pushHash: (hash) => window.history.pushState(null, "", hash),
};

export function navigateToIntroPhase(
  event: PhaseNavigationEvent,
  phaseId: IntroPhaseId,
  environment = browserPhaseNavigationEnvironment
): boolean {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.button !== 0
  ) {
    return false;
  }

  const target = environment.findTarget(phaseId);
  if (!target) {
    return false;
  }

  event.preventDefault();

  const hash = `#${phaseId}`;
  if (environment.currentHash() !== hash) {
    environment.pushHash(hash);
  }

  target.scrollIntoView({
    behavior: environment.prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });

  return true;
}
