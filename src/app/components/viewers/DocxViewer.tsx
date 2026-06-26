"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  clearHighlights,
  highlightTextInElement,
} from "@/app/utils/documentHighlight";

interface DocxViewerProps {
  docxData: ArrayBuffer;
  initialPage?: number;
  /** Surrounding-sentence quote to highlight in the rendered document. */
  highlightQuote?: string;
}

export const DocxViewer: React.FC<DocxViewerProps> = ({
  docxData,
  initialPage,
  highlightQuote,
}) => {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml(
          { arrayBuffer: docxData },
          {
            styleMap: [
              "p[style-name='Heading 1'] => h1.docx-heading-1:fresh",
              "p[style-name='Heading 2'] => h2.docx-heading-2:fresh",
              "p[style-name='Heading 3'] => h3.docx-heading-3:fresh",
            ],
          }
        );
        if (!cancelled) {
          setHtml(result.value);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to render DOCX: ${e}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docxData]);

  // Jump to approximate page position if initialPage is provided.
  // DOCX files don't have intrinsic pages, so we divide the rendered
  // content into equal-height "virtual pages" for navigation purposes.
  useEffect(() => {
    if (initialPage && contentRef.current && html) {
      const container = contentRef.current;
      // Wait for content to render, then scroll proportionally.
      requestAnimationFrame(() => {
        const totalHeight = container.scrollHeight;
        // Assume ~50 lines per "page" as a heuristic, using total content height / 10 pages
        const estimatedPages = Math.max(10, Math.round(totalHeight / 800));
        const targetPage = Math.min(initialPage, estimatedPages);
        const scrollTarget = (totalHeight / estimatedPages) * (targetPage - 1);
        container.scrollTo({ top: scrollTarget, behavior: "smooth" });
      });
    }
  }, [initialPage, html]);

  // Highlight the cited passage after the HTML is mounted.
  useEffect(() => {
    if (!contentRef.current || !html) return;
    const container = contentRef.current;
    requestAnimationFrame(() => {
      clearHighlights(container);
      if (highlightQuote) {
        highlightTextInElement(container, highlightQuote);
        const mark = container.querySelector<HTMLElement>("mark.cite-highlight");
        mark?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, [html, highlightQuote]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-sm text-muted-foreground">
          Loading document…
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

  return (
    <div
      ref={contentRef}
      className="h-full overflow-auto bg-white p-8 text-zinc-900"
    >
      <div
        className="docx-content mx-auto max-w-3xl [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-4 [&_blockquote]:italic [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_img]:max-w-full [&_img]:rounded [&_li]:ml-6 [&_li]:list-disc [&_ol]:ml-6 [&_ol]:list-decimal [&_p]:mb-3 [&_p]:leading-relaxed [&_table]:border-collapse [&_td]:border [&_td]:border-zinc-300 [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:border-zinc-400 [&_th]:bg-zinc-100 [&_th]:px-3 [&_th]:py-1.5 [&_th]:font-semibold [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:ml-6"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};
