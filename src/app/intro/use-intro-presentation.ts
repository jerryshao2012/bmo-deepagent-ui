"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  INTRO_SLIDES,
  adjacentIntroSlide,
  directionForPresentationKey,
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

      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "start",
      });
      window.history[`${historyMode}State`](null, "", `#${id}`);
      activateSlide(id);
      return true;
    },
    [activateSlide]
  );

  const goToSlide = useCallback(
    (id: IntroSlideId, historyMode: "push" | "replace" = "push") => {
      navigateToSlide(id, historyMode);
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
    document.documentElement.classList.add("intro-presentation-ready");

    const slides = Array.from(
      document.querySelectorAll<HTMLElement>("[data-intro-slide]")
    );
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.id;
          if (!entry.isIntersecting || !isIntroSlideId(id)) return;

          window.history.replaceState(null, "", `#${id}`);
          activateSlide(id);
        });
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

    const atSlideBoundary = (direction: PresentationDirection) => {
      const activeSlide = document.getElementById(activeSlideIdRef.current);
      if (!activeSlide) return false;

      const { top, bottom } = activeSlide.getBoundingClientRect();
      return shouldLeaveOverflowingSlide(
        { top, bottom, viewportHeight: window.innerHeight },
        direction
      );
    };

    const navigateAdjacent = (direction: PresentationDirection) =>
      navigateToSlide(
        adjacentIntroSlide(activeSlideIdRef.current, direction),
        "push"
      );

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
        navigateToSlide(INTRO_SLIDES[0].id, "push");
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        navigateToSlide(INTRO_SLIDES[INTRO_SLIDES.length - 1].id, "push");
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

    let touchStartY: number | null = null;
    const handleTouchStart = (event: TouchEvent) => {
      if (suspendedRef.current) return;
      touchStartY = event.touches[0]?.clientY ?? null;
    };
    const handleTouchEnd = (event: TouchEvent) => {
      const startY = touchStartY;
      touchStartY = null;
      if (suspendedRef.current || startY === null) return;

      const endY = event.changedTouches[0]?.clientY;
      if (endY === undefined) return;

      const deltaY = startY - endY;
      if (Math.abs(deltaY) < TOUCH_THRESHOLD) return;

      const direction: PresentationDirection = deltaY > 0 ? 1 : -1;
      if (!atSlideBoundary(direction)) return;

      event.preventDefault();
      navigateAdjacent(direction);
    };

    const syncFullscreen = () => {
      const enabled = isFullscreenActive();
      isFullscreenRef.current = enabled;
      setIsFullscreen(enabled);
      setFullscreenStatus(enabled ? "Fullscreen enabled" : "Fullscreen exited");
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });
    document.addEventListener("touchend", handleTouchEnd, { passive: false });
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);

    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("wheel", handleWheel);
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("webkitfullscreenchange", syncFullscreen);
      if (wheelCooldown !== undefined) window.clearTimeout(wheelCooldown);
      touchStartY = null;
      slides.forEach((slide) => slide.classList.remove("is-active"));
      document.documentElement.classList.remove("intro-presentation-ready");
    };
  }, [activateSlide, navigateToSlide, toggleFullscreen]);

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
