"use client";

import { Expand, Minimize, ExternalLink } from "lucide-react";
import { useState } from "react";

import { INTRO_SLIDES, type IntroSlideId } from "./presentation-navigation";
import {
  INTRO_SPEAKER_NOTES,
  type SlideSpeakerNote,
} from "./speaker-notes-data";

interface PresentationChromeProps {
  activeSlideId: IntroSlideId;
  isFullscreen: boolean;
  fullscreenStatus: string;
  suspended: boolean;
  onNavigate(id: IntroSlideId): void;
  onToggleFullscreen(): void;
  onOpenNotesPopup?(): void;
}

export function PresentationChrome({
  activeSlideId,
  isFullscreen,
  fullscreenStatus,
  suspended,
  onNavigate,
  onToggleFullscreen,
  onOpenNotesPopup,
}: PresentationChromeProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const requestedActiveSlideIndex = INTRO_SLIDES.findIndex(
    (slide) => slide.id === activeSlideId
  );
  const activeSlideIndex =
    requestedActiveSlideIndex >= 0 ? requestedActiveSlideIndex : 0;
  const activeSlide = INTRO_SLIDES[activeSlideIndex];
  const effectiveActiveSlideId = activeSlide.id;
  const progress = (activeSlideIndex + 1) / INTRO_SLIDES.length;
  const currentSlide = activeSlideIndex + 1;
  const slideCount = INTRO_SLIDES.length;
  const announcement = `Slide ${currentSlide} of ${slideCount}: ${
    activeSlide.label
  }${fullscreenStatus ? `. ${fullscreenStatus}` : ""}`;
  const fullscreenLabel = isFullscreen ? "Exit fullscreen" : "Enter fullscreen";
  const FullscreenIcon = isFullscreen ? Minimize : Expand;

  const currentNotes: SlideSpeakerNote =
    INTRO_SPEAKER_NOTES[effectiveActiveSlideId] || {
      id: effectiveActiveSlideId,
      title: activeSlide.label,
      duration: "2 mins",
      minutes: 2,
      category: "General",
      talkingPoints: ["Present slide content clearly."],
      transitionCue: "Move to next slide.",
    };

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[90]"
      aria-label="Presentation controls"
      role="group"
    >
      {/* Slide progress indicator */}
      <div
        aria-label="Slide progress"
        aria-valuemax={slideCount}
        aria-valuemin={1}
        aria-valuenow={currentSlide}
        className="fixed inset-x-0 top-0 h-[3px] bg-[#F3F7FA]/80"
        role="progressbar"
      >
        <div
          className="h-full origin-left bg-[#0075BE] transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      {/* Right-hand slide navigation dots rail */}
      <nav
        aria-label="Presentation slides"
        className="pointer-events-auto fixed right-5 top-1/2 flex -translate-y-1/2 flex-col gap-3"
      >
        {INTRO_SLIDES.map((slide, index) => {
          const isActive = slide.id === effectiveActiveSlideId;
          return (
            <button
              aria-current={isActive ? "step" : undefined}
              aria-label={`Go to slide ${index + 1}: ${slide.label}`}
              className={`h-3 w-3 rounded-full border border-[#0075BE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F7FA] disabled:cursor-not-allowed disabled:opacity-45 motion-safe:transition ${
                isActive
                  ? "scale-125 bg-[#0075BE] shadow-[0_0_8px_rgba(0,117,190,0.6)]"
                  : "bg-white/80 hover:bg-[#0075BE]/40"
              }`}
              disabled={suspended}
              key={slide.id}
              onClick={() => onNavigate(slide.id)}
              type="button"
            />
          );
        })}
      </nav>

      {/* Bottom left slide counter and keyboard hint (keyboard hint shows on slide 1 only) */}
      <div className="pointer-events-none fixed bottom-5 left-5 hidden items-center gap-4 text-sm font-medium text-[#001928] md:flex">
        <span className="font-mono">{`${String(currentSlide).padStart(2, "0")} / ${String(
          slideCount
        ).padStart(2, "0")}`}</span>
        <span
          className={`transition-all duration-300 text-[#001928]/75 ${
            activeSlideIndex === 0
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-1"
          }`}
        >
          Arrow keys to navigate · F fullscreen
        </span>
      </div>

      {/* Fullscreen Button */}
      <button
        aria-label={fullscreenLabel}
        className="presentation-fullscreen-control pointer-events-auto fixed bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#001928] text-white shadow-lg hover:bg-[#0075BE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F7FA] disabled:cursor-not-allowed disabled:opacity-45 motion-safe:transition motion-safe:active:scale-95 sm:bottom-5 sm:right-5 sm:h-11 sm:w-11"
        data-presentation-fullscreen-control
        disabled={suspended}
        onClick={onToggleFullscreen}
        type="button"
      >
        <FullscreenIcon
          aria-hidden="true"
          className="h-5 w-5"
        />
      </button>

      {/* In-page Speaker Notes Drawer Fallback */}
      {drawerOpen && (
        <div className="pointer-events-auto fixed inset-x-4 bottom-16 z-[95] mx-auto max-w-2xl rounded-2xl border border-[#001928]/15 bg-[#001928] p-5 text-white shadow-2xl backdrop-blur-lg sm:bottom-20">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#0075BE]/30 px-2 py-0.5 font-mono text-xs font-semibold text-[#73C3EB]">
                {currentNotes.category}
              </span>
              <span className="font-mono text-xs text-white/60">
                Target: {currentNotes.duration}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onOpenNotesPopup && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenNotesPopup();
                    setDrawerOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded bg-[#0075BE] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#005f9e]"
                >
                  <ExternalLink className="h-3 w-3" />
                  Pop out window
                </button>
              )}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
              >
                ✕ Close
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm text-[#E2EAF0]">
            <h4 className="font-bold text-white">{currentNotes.title}</h4>
            <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-white/90">
              {currentNotes.talkingPoints.map((point, idx) => (
                <li key={idx}>
                  {point.replace(/\*\*(.*?)\*\*/g, "$1")}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs italic text-[#73C3EB]">
              Cue: {currentNotes.transitionCue}
            </p>
          </div>
        </div>
      )}

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
