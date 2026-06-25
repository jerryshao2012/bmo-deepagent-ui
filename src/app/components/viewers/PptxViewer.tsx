"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Presentation,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import {
  fetchDocumentExtract,
} from "@/app/components/viewers/documentUtils";

interface PptxViewerProps {
  filePath: string;
  threadId: string;
  initialSlide?: number;
}

interface SlideSection {
  slideNumber: number;
  content: string;
}

/**
 * Parse extracted PPTX markdown (with `<!-- slide: N -->` sentinels) into
 * individual slide sections.
 */
function parseSlides(extracted: string): SlideSection[] {
  const sections: SlideSection[] = [];
  // Split on the slide sentinel comment
  const parts = extracted.split(/(?=<!--\s*slide:\s*\d+\s*-->)/);
  for (const part of parts) {
    const match = part.match(/<!--\s*slide:\s*(\d+)\s*-->/);
    if (!match) continue;
    const slideNumber = parseInt(match[1], 10);
    // Remove the sentinel and the redundant "Slide N" header line that the
    // extractor emits, keeping just the body content.
    const body = part
      .replace(/<!--\s*slide:\s*\d+\s*-->\n?/, "")
      .replace(/^Slide\s+\d+\s*\n?/i, "")
      .trim();
    if (body) {
      sections.push({ slideNumber, content: body });
    }
  }
  // Fallback: if no sentinels found, treat the whole thing as one section
  if (sections.length === 0 && extracted.trim()) {
    sections.push({ slideNumber: 1, content: extracted.trim() });
  }
  return sections;
}

export const PptxViewer: React.FC<PptxViewerProps> = ({
  filePath,
  threadId,
  initialSlide,
}) => {
  const [slides, setSlides] = useState<SlideSection[]>([]);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const slideRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const extracted = await fetchDocumentExtract(filePath, threadId);
        if (cancelled) return;
        const parsed = parseSlides(extracted);
        setSlides(parsed);
        setCurrentSlide(
          initialSlide
            ? Math.min(Math.max(initialSlide, 1), parsed.length)
            : 1
        );
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load presentation: ${e}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath, threadId]);

  // Jump to initial slide
  useEffect(() => {
    if (initialSlide && slides.length > 0 && scrollRef.current) {
      requestAnimationFrame(() => {
        const target = slideRefs.current.get(initialSlide);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [initialSlide, slides]);

  const goToSlide = useCallback(
    (slideNum: number) => {
      const clamped = Math.min(Math.max(slideNum, 1), slides.length);
      setCurrentSlide(clamped);
      slideRefs.current.get(clamped)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    },
    [slides.length]
  );

  // Track current slide on scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const containerTop = scrollRef.current.getBoundingClientRect().top;
    let active = 1;
    for (const slide of slides) {
      const el = slideRefs.current.get(slide.slideNumber);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top - containerTop <= 50) {
        active = slide.slideNumber;
      } else {
        break;
      }
    }
    setCurrentSlide(active);
  }, [slides]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-sm text-muted-foreground">
          Loading presentation…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No slide content found
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Slide navigation toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => goToSlide(currentSlide - 1)}
            disabled={currentSlide <= 1}
          >
            <ChevronLeft size={16} />
          </Button>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={1}
              max={slides.length}
              value={currentSlide}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (v >= 1 && v <= slides.length) goToSlide(v);
              }}
              className="h-7 w-14 text-center text-sm"
            />
            <span className="text-sm text-muted-foreground">
              / {slides.length}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => goToSlide(currentSlide + 1)}
            disabled={currentSlide >= slides.length}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Presentation size={14} />
          Slide {currentSlide} of {slides.length}
        </div>
      </div>

      {/* Slides list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-zinc-100 p-4 dark:bg-zinc-900"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {slides.map((slide) => (
            <div
              key={slide.slideNumber}
              ref={(el) => {
                if (el) {
                  slideRefs.current.set(slide.slideNumber, el);
                } else {
                  slideRefs.current.delete(slide.slideNumber);
                }
              }}
              className="overflow-hidden rounded-lg border border-border bg-white shadow-sm"
            >
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-orange-500 text-xs font-semibold text-white">
                  {slide.slideNumber}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  Slide {slide.slideNumber}
                </span>
              </div>
              <div className="p-6 text-zinc-900">
                <MarkdownContent content={slide.content} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
