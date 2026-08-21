"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  INTRO_SLIDES,
  adjacentIntroSlide,
  directionForPresentationKey,
  fitsPresentationViewport,
  isPresentationEditableTarget,
  isPresentationInteractiveTarget,
  shouldLeaveOverflowingSlide,
  type IntroSlideId,
  type PresentationInputTarget,
  type PresentationDirection,
} from "./presentation-navigation";

const FULLSCREEN_UNAVAILABLE =
  "Fullscreen is unavailable in this browser context";
const WHEEL_THRESHOLD = 24;
const WHEEL_COOLDOWN_MS = 620;
const TOUCH_THRESHOLD = 48;
const HEADER_OFFSET = 64;

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export interface IntroPresentationState {
  activeSlideId: IntroSlideId;
  activeSlideIndex: number;
  isFullscreen: boolean;
  fullscreenStatus: string;
  goToSlide(id: IntroSlideId, historyMode?: "push" | "replace"): void;
  toggleFullscreen(): Promise<void>;
}

function isIntroSlideId(id: string): id is IntroSlideId {
  return INTRO_SLIDES.some((slide) => slide.id === id);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isFullscreenActive() {
  if (typeof document === "undefined") return false;

  const fullscreenDocument = document as FullscreenDocument;
  return Boolean(
    document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement
  );
}

function updateActiveClass(id: IntroSlideId) {
  document
    .querySelectorAll<HTMLElement>("[data-intro-slide]")
    .forEach((slide) => slide.classList.toggle("is-active", slide.id === id));
}

function scrollSlideIntoView(
  target: HTMLElement,
  behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth"
) {
  const { height } = target.getBoundingClientRect();
  target.scrollIntoView({
    behavior,
    block: fitsPresentationViewport(height, window.innerHeight)
      ? "center"
      : "start",
  });
}

export function useIntroPresentation({
  suspended,
}: {
  suspended: boolean;
}): IntroPresentationState {
  const [activeSlideId, setActiveSlideId] = useState<IntroSlideId>("hero");
  const [isFullscreen, setIsFullscreen] = useState(isFullscreenActive);
  const [fullscreenStatus, setFullscreenStatus] = useState("");
  const activeSlideIdRef = useRef<IntroSlideId>("hero");
  const isFullscreenRef = useRef(isFullscreen);
  const suspendedRef = useRef(suspended);

  suspendedRef.current = suspended;
  isFullscreenRef.current = isFullscreen;

  const activateSlide = useCallback((id: IntroSlideId) => {
    activeSlideIdRef.current = id;
    updateActiveClass(id);
    setActiveSlideId(id);
  }, []);

  const navigateToSlide = useCallback(
    (id: IntroSlideId, historyMode: "push" | "replace"): boolean => {
      const target = document.getElementById(id);
      if (!target || !isIntroSlideId(id)) {
        return false;
      }

      scrollSlideIntoView(target);
      window.history[`${historyMode}State`](null, "", `#${id}`);
      activateSlide(id);
      return true;
    },
    [activateSlide]
  );

  const goToSlide = useCallback(
    (id: IntroSlideId, historyMode: "push" | "replace" = "replace") => {
      navigateToSlide(
        id,
        historyMode === "push" && id === activeSlideIdRef.current
          ? "replace"
          : historyMode
      );
    },
    [navigateToSlide]
  );

  const toggleFullscreen = useCallback(async () => {
    const fullscreenDocument = document as FullscreenDocument;
    const fullscreenElement = document.documentElement as FullscreenElement;

    try {
      if (isFullscreenRef.current) {
        const exit =
          document.exitFullscreen ?? fullscreenDocument.webkitExitFullscreen;
        if (!exit) throw new Error("Fullscreen exit unavailable");
        await exit.call(document);
      } else {
        const request =
          fullscreenElement.requestFullscreen ??
          fullscreenElement.webkitRequestFullscreen;
        if (!request) throw new Error("Fullscreen request unavailable");
        await request.call(fullscreenElement);
      }
    } catch {
      setFullscreenStatus(FULLSCREEN_UNAVAILABLE);
    }
  }, []);

  useEffect(() => {
    const presentationRoot = document.documentElement;
    presentationRoot.classList.add("intro-presentation-initializing");

    const slides = Array.from(
      document.querySelectorAll<HTMLElement>("[data-intro-slide]")
    );
    const observer = new IntersectionObserver(
      (entries) => {
        const viewportCenter = window.innerHeight / 2;
        let candidate:
          | { id: IntroSlideId; distance: number; documentOrder: number }
          | undefined;

        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          const id = target.id;
          if (!entry.isIntersecting || !isIntroSlideId(id)) return;

          const rect = target.getBoundingClientRect();
          const distance = Math.abs(
            (rect.top + rect.bottom) / 2 - viewportCenter
          );
          const documentOrder = slides.indexOf(target);
          if (
            !candidate ||
            distance < candidate.distance ||
            (distance === candidate.distance &&
              documentOrder < candidate.documentOrder)
          ) {
            candidate = { id, distance, documentOrder };
          }
        });

        if (!candidate) return;
        window.history.replaceState(null, "", `#${candidate.id}`);
        activateSlide(candidate.id);
      },
      { rootMargin: "-49% 0px -49% 0px", threshold: 0 }
    );

    slides.forEach((slide) => observer.observe(slide));

    const hashId = window.location.hash.slice(1);
    if (isIntroSlideId(hashId)) {
      navigateToSlide(hashId, "replace");
    } else {
      navigateToSlide("hero", "replace");
    }

    presentationRoot.classList.add("intro-presentation-ready");
    let initializationFrame: number | undefined = window.requestAnimationFrame(
      () => {
        initializationFrame = undefined;
        presentationRoot.classList.remove("intro-presentation-initializing");
      }
    );

    const atSlideBoundary = (
      direction: PresentationDirection,
      slideId = activeSlideIdRef.current
    ) => {
      const activeSlide = document.getElementById(slideId);
      if (!activeSlide) return false;

      const { top, bottom } = activeSlide.getBoundingClientRect();
      return shouldLeaveOverflowingSlide(
        { top, bottom, viewportHeight: window.innerHeight },
        direction,
        HEADER_OFFSET
      );
    };

    const navigateAdjacent = (
      direction: PresentationDirection,
      slideId = activeSlideIdRef.current
    ) => {
      const adjacentId = adjacentIntroSlide(slideId, direction);
      if (adjacentId === slideId) return false;
      return navigateToSlide(adjacentId, "push");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        suspendedRef.current ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isPresentationEditableTarget(
          event.target as PresentationInputTarget | null
        )
      ) {
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }

      if (
        isPresentationInteractiveTarget(
          event.target as PresentationInputTarget | null
        )
      ) {
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        goToSlide(INTRO_SLIDES[0].id, "push");
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        goToSlide(INTRO_SLIDES[INTRO_SLIDES.length - 1].id, "push");
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigateAdjacent(event.key === "ArrowRight" ? 1 : -1);
        return;
      }

      const direction = directionForPresentationKey(event.key, event.shiftKey);
      if (!direction || !atSlideBoundary(direction)) return;

      event.preventDefault();
      navigateAdjacent(direction);
    };

    let wheelLocked = false;
    let wheelCooldown: number | undefined;
    const handleWheel = (event: WheelEvent) => {
      if (suspendedRef.current || Math.abs(event.deltaY) < WHEEL_THRESHOLD) {
        return;
      }

      const direction: PresentationDirection = event.deltaY > 0 ? 1 : -1;
      if (!atSlideBoundary(direction)) return;

      event.preventDefault();
      if (wheelLocked) return;

      if (navigateAdjacent(direction)) {
        wheelLocked = true;
        wheelCooldown = window.setTimeout(() => {
          wheelLocked = false;
          wheelCooldown = undefined;
        }, WHEEL_COOLDOWN_MS);
      }
    };

    let touchGesture:
      | {
          startY: number;
          slideId: IntroSlideId;
          direction: PresentationDirection | null;
          claimed: boolean;
        }
      | undefined;
    const handleTouchStart = (event: TouchEvent) => {
      if (suspendedRef.current || event.touches.length !== 1) {
        touchGesture = undefined;
        return;
      }

      const startY = event.touches[0]?.clientY;
      if (startY === undefined) return;
      touchGesture = {
        startY,
        slideId: activeSlideIdRef.current,
        direction: null,
        claimed: false,
      };
    };
    const handleTouchMove = (event: TouchEvent) => {
      const gesture = touchGesture;
      if (suspendedRef.current || !gesture) return;
      if (event.touches.length !== 1) {
        touchGesture = undefined;
        return;
      }

      const currentY = event.touches[0]?.clientY;
      if (currentY === undefined) return;
      const deltaY = gesture.startY - currentY;
      if (Math.abs(deltaY) < TOUCH_THRESHOLD) return;

      const direction: PresentationDirection = deltaY > 0 ? 1 : -1;
      if (!atSlideBoundary(direction, gesture.slideId)) return;

      gesture.direction = direction;
      gesture.claimed = true;
      event.preventDefault();
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = touchGesture;
      touchGesture = undefined;
      if (
        suspendedRef.current ||
        !gesture ||
        event.changedTouches.length !== 1
      ) {
        return;
      }

      const endY = event.changedTouches[0]?.clientY;
      if (endY === undefined) return;

      const deltaY = gesture.startY - endY;
      if (Math.abs(deltaY) < TOUCH_THRESHOLD) return;

      const direction: PresentationDirection = deltaY > 0 ? 1 : -1;
      if (
        (!gesture.claimed && !atSlideBoundary(direction, gesture.slideId)) ||
        (gesture.direction !== null && gesture.direction !== direction)
      ) {
        return;
      }

      event.preventDefault();
      navigateAdjacent(direction, gesture.slideId);
    };
    const handleTouchCancel = () => {
      touchGesture = undefined;
    };

    let fullscreenOuterFrame: number | undefined;
    let fullscreenInnerFrame: number | undefined;
    const cancelFullscreenRealignment = () => {
      if (fullscreenOuterFrame !== undefined) {
        window.cancelAnimationFrame(fullscreenOuterFrame);
        fullscreenOuterFrame = undefined;
      }
      if (fullscreenInnerFrame !== undefined) {
        window.cancelAnimationFrame(fullscreenInnerFrame);
        fullscreenInnerFrame = undefined;
      }
    };
    const syncFullscreen = () => {
      const enabled = isFullscreenActive();
      isFullscreenRef.current = enabled;
      setIsFullscreen(enabled);
      setFullscreenStatus(enabled ? "Fullscreen enabled" : "Fullscreen exited");
      cancelFullscreenRealignment();
      fullscreenOuterFrame = window.requestAnimationFrame(() => {
        fullscreenOuterFrame = undefined;
        fullscreenInnerFrame = window.requestAnimationFrame(() => {
          fullscreenInnerFrame = undefined;
          const activeSlide = document.getElementById(activeSlideIdRef.current);
          if (activeSlide) scrollSlideIntoView(activeSlide, "auto");
        });
      });
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: false });
    document.addEventListener("touchcancel", handleTouchCancel);
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("wheel", handleWheel);
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchCancel);
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("webkitfullscreenchange", syncFullscreen);
      cancelFullscreenRealignment();
      if (wheelCooldown !== undefined) window.clearTimeout(wheelCooldown);
      if (initializationFrame !== undefined) {
        window.cancelAnimationFrame(initializationFrame);
      }
      touchGesture = undefined;
      slides.forEach((slide) => slide.classList.remove("is-active"));
      presentationRoot.classList.remove(
        "intro-presentation-initializing",
        "intro-presentation-ready"
      );
    };
  }, [activateSlide, goToSlide, navigateToSlide, toggleFullscreen]);

  const activeSlideIndex = useMemo(
    () => INTRO_SLIDES.findIndex((slide) => slide.id === activeSlideId),
    [activeSlideId]
  );

  return {
    activeSlideId,
    activeSlideIndex,
    isFullscreen,
    fullscreenStatus,
    goToSlide,
    toggleFullscreen,
  };
}
