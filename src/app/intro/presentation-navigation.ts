export const INTRO_SLIDES = [
  { id: "hero", label: "Overview" },
  { id: "preview", label: "Workspace preview" },
  { id: "phase1", label: "Phase 1: Ground" },
  { id: "phase2", label: "Phase 2: Research" },
  { id: "phase3", label: "Phase 3: Review" },
  { id: "launch", label: "Launch" },
] as const;

export type IntroSlideId = (typeof INTRO_SLIDES)[number]["id"];
export type PresentationDirection = -1 | 1;
export const PRESENTATION_VIEWPORT_EPSILON = 2;

export function adjacentIntroSlide(
  current: IntroSlideId,
  direction: PresentationDirection
): IntroSlideId {
  const currentIndex = INTRO_SLIDES.findIndex((slide) => slide.id === current);
  if (currentIndex < 0) {
    return INTRO_SLIDES[0].id;
  }

  const nextIndex = Math.max(
    0,
    Math.min(INTRO_SLIDES.length - 1, currentIndex + direction)
  );

  return INTRO_SLIDES[nextIndex].id;
}

export function directionForPresentationKey(
  key: string,
  shiftKey: boolean
): PresentationDirection | null {
  if (key === " ") {
    return shiftKey ? -1 : 1;
  }

  if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown") {
    return 1;
  }

  if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp") {
    return -1;
  }

  return null;
}

export interface PresentationOverflowState {
  top: number;
  bottom: number;
  viewportHeight: number;
}

export function fitsPresentationViewport(
  height: number,
  viewportHeight: number,
  epsilon = PRESENTATION_VIEWPORT_EPSILON
): boolean {
  return height <= viewportHeight + epsilon;
}

export function shouldLeaveOverflowingSlide(
  { top, bottom, viewportHeight }: PresentationOverflowState,
  direction: PresentationDirection,
  headerOffset = 0,
  epsilon = PRESENTATION_VIEWPORT_EPSILON
): boolean {
  if (fitsPresentationViewport(bottom - top, viewportHeight, epsilon)) {
    return true;
  }

  if (direction === 1) {
    return bottom <= viewportHeight + headerOffset + epsilon;
  }

  return top >= headerOffset - epsilon;
}

export interface PresentationInputTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

export function isPresentationEditableTarget(
  target: PresentationInputTarget | null
): boolean {
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toUpperCase();
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable === true
  );
}

export function isPresentationInteractiveTarget(
  target: PresentationInputTarget | null
): boolean {
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toUpperCase();
  return (
    isPresentationEditableTarget(target) ||
    tagName === "BUTTON" ||
    tagName === "A"
  );
}
