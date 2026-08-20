"use client";

import { Expand, Minimize } from "lucide-react";

import { INTRO_SLIDES, type IntroSlideId } from "./presentation-navigation";

interface PresentationChromeProps {
  activeSlideId: IntroSlideId;
  isFullscreen: boolean;
  fullscreenStatus: string;
  onNavigate(id: IntroSlideId): void;
  onToggleFullscreen(): void;
}

export function PresentationChrome({
  activeSlideId,
  isFullscreen,
  fullscreenStatus,
  onNavigate,
  onToggleFullscreen,
}: PresentationChromeProps): JSX.Element {
  const activeSlideIndex = Math.max(
    0,
    INTRO_SLIDES.findIndex((slide) => slide.id === activeSlideId)
  );
  const activeSlide = INTRO_SLIDES[activeSlideIndex];
  const progress = (activeSlideIndex + 1) / INTRO_SLIDES.length;
  const currentSlide = activeSlideIndex + 1;
  const slideCount = INTRO_SLIDES.length;
  const announcement = `Slide ${currentSlide} of ${slideCount}: ${
    activeSlide.label
  }${fullscreenStatus ? `. ${fullscreenStatus}` : ""}`;
  const fullscreenLabel = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
  const FullscreenIcon = isFullscreen ? Minimize : Expand;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[90]"
      aria-label="Presentation controls"
    >
      <div
        aria-label="Slide progress"
        aria-valuemax={slideCount}
        aria-valuemin={1}
        aria-valuenow={currentSlide}
        className="fixed inset-x-0 top-0 h-[3px] bg-[#F3F7FA]/80"
        role="progressbar"
      >
        <div
          className="h-full origin-left bg-[#0075BE]"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <nav
        aria-label="Presentation slides"
        className="pointer-events-auto fixed right-5 top-1/2 hidden -translate-y-1/2 flex-col gap-3 sm:flex"
      >
        {INTRO_SLIDES.map((slide, index) => {
          const isActive = slide.id === activeSlideId;
          return (
            <button
              aria-current={isActive ? "step" : undefined}
              aria-label={`Go to slide ${index + 1}: ${slide.label}`}
              className={`h-3 w-3 rounded-full border border-[#0075BE] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F7FA] ${
                isActive ? "bg-[#0075BE]" : "bg-white/80 hover:bg-[#0075BE]/40"
              }`}
              key={slide.id}
              onClick={() => onNavigate(slide.id)}
              type="button"
            />
          );
        })}
      </nav>

      <div className="pointer-events-none fixed bottom-5 left-5 hidden items-center gap-4 text-sm font-medium text-[#001928] md:flex">
        <span>{`${String(currentSlide).padStart(2, "0")} / ${String(
          slideCount
        ).padStart(2, "0")}`}</span>
        <span className="text-[#001928]/75">
          Arrow keys to navigate · F fullscreen
        </span>
      </div>

      <button
        aria-label={fullscreenLabel}
        className="pointer-events-auto fixed bottom-5 right-5 inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#001928] text-white shadow-lg transition hover:bg-[#0075BE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F7FA] active:scale-95"
        onClick={onToggleFullscreen}
        type="button"
      >
        <FullscreenIcon
          aria-hidden="true"
          className="h-5 w-5"
        />
      </button>

      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {announcement}
      </p>
    </div>
  );
}
