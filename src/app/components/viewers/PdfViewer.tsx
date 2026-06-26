"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  ArrowLeftRight,
  ArrowUpDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findBestRange } from "@/app/utils/documentHighlight";

interface PdfViewerProps {
  pdfData: ArrayBuffer;
  initialPage?: number;
  /** Surrounding-sentence quote to highlight on the cited page. */
  highlightQuote?: string;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

/**
 * Resolve a citation `initialPage` (1-based, possibly a page *label*) to a
 * 1-based physical page index.
 */
function resolveTargetPage(
  initialPage: number | undefined,
  numPages: number,
  pageLabels: string[] | null
): number {
  if (initialPage === undefined) return 1;
  if (pageLabels) {
    const idx = pageLabels.indexOf(initialPage.toString());
    if (idx !== -1) return idx + 1;
  }
  return Math.min(Math.max(initialPage, 1), numPages || 1);
}

/**
 * Given a PDF page's TextContent items and a quote, return highlight rects
 * (in scale-1, top-left-origin page units) for the best matching text run.
 */
function computePdfHighlightRects(
  textItems: any[],
  quote: string,
  pageHeight: number
): HighlightRect[] {
  let pageText = "";
  const segs: { itemIndex: number; start: number; len: number }[] = [];
  let lastItem: any = null;
  
  textItems.forEach((item, idx) => {
    const str = item.str ?? "";
    if (!str) return;

    if (lastItem && pageText.length > 0) {
      const tx1 = lastItem.transform;
      const tx2 = item.transform;
      const hasTransform = tx1 && tx2 && tx1.length >= 6 && tx2.length >= 6;
      
      let needsSpace = lastItem.hasEOL;
      if (hasTransform && !needsSpace) {
        const y1 = tx1[5];
        const y2 = tx2[5];
        const x1 = tx1[4];
        const x2 = tx2[4];
        const w1 = lastItem.width || 0;
        
        const isNewline = Math.abs(y1 - y2) > 5;
        // Check for gap between end of last item and start of this one.
        const isSpace = !isNewline && (x2 - (x1 + w1)) > 0.5;
        
        needsSpace = isNewline || isSpace;
      }

      if (needsSpace && !pageText.endsWith(" ") && !str.startsWith(" ")) {
        pageText += " ";
      }
    }

    segs.push({ itemIndex: idx, start: pageText.length, len: str.length });
    pageText += str;
    lastItem = item;
  });

  const range = findBestRange(pageText, quote);
  if (!range) return [];


  const rects: HighlightRect[] = [];
  for (const seg of segs) {
    const segEnd = seg.start + seg.len;
    if (segEnd <= range.start || seg.start >= range.end) continue;
    const item = textItems[seg.itemIndex];
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    // Vertical scale = sqrt(b^2 + d^2); for unrotated text this is |d|.
    const fontHeight =
      Math.hypot(transform[1], transform[3]) || item.height || 10;
    // transform[4]=e is the left x; transform[5]=f is the baseline y (PDF,
    // origin bottom-left). Convert to top-left origin screen coords.
    const left = transform[4];
    const top = pageHeight - transform[5] - fontHeight;
    const width =
      typeof item.width === "number" && item.width > 0
        ? item.width
        : (item.str?.length || 1) * fontHeight * 0.5;
    rects.push({
      left,
      top,
      width: Math.max(width, 4),
      height: Math.max(fontHeight, 6),
    });
  }
  return rects;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  pdfData,
  initialPage,
  highlightQuote,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const [pdfDoc, setPdfDoc] = useState<null | any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultPageSize, setDefaultPageSize] = useState<{ width: number; height: number } | null>(null);
  const [pageLabels, setPageLabels] = useState<string[] | null>(null);
  const [inputVal, setInputVal] = useState("");
  const renderTasksRef = useRef<any[]>([]);
  const renderedPagesRef = useRef<Map<number, number>>(new Map()); // pageNum -> zoom level
  const hasScrolledRef = useRef(false);
  const lastZoomRef = useRef(zoom);
  const lastInitialPageRef = useRef(initialPage);
  // Citation highlight: rects keyed by page number, in PDF scale-1 units.
  const [highlightRects, setHighlightRects] = useState<Map<number, HighlightRect[]>>(
    new Map()
  );
  // Cache of TextContent items per page so we don't re-extract on every render.
  const textContentCacheRef = useRef<Map<number, any[]>>(new Map());
  // Mirror the latest quote into a ref so async closures read a fresh value.
  const highlightQuoteRef = useRef(highlightQuote);
  useEffect(() => {
    highlightQuoteRef.current = highlightQuote;
  }, [highlightQuote]);
  if (initialPage !== undefined) {
    if (initialPage !== lastInitialPageRef.current) {
      lastInitialPageRef.current = initialPage;
      hasScrolledRef.current = false;
    }
  }

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    hasScrolledRef.current = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

        const doc = await pdfjsLib.getDocument({ data: pdfData.slice(0) }).promise;
        if (cancelled) return;
        
        // Fetch page 1 to get default dimensions for the placeholders
        try {
          const page1 = await doc.getPage(1);
          const vp = page1.getViewport({ scale: 1.0 });
          setDefaultPageSize({ width: vp.width, height: vp.height });
        } catch {
          // ignore error if page 1 fails
        }

        setPdfDoc(doc);
        setNumPages(doc.numPages);

        let labels: string[] | null = null;
        try {
          labels = await doc.getPageLabels();
          setPageLabels(labels);
        } catch {
          // ignore page labels error
        }

        let targetPage = 1;
        if (initialPage !== undefined) {
          // initialPage is already 1-based (from citation text like "p. 75")
          if (labels) {
            const idx = labels.indexOf(initialPage.toString());
            if (idx !== -1) {
              targetPage = idx + 1;
            } else {
              targetPage = Math.min(Math.max(initialPage, 1), doc.numPages);
            }
          } else {
            targetPage = Math.min(Math.max(initialPage, 1), doc.numPages);
          }
        }
        setCurrentPage(targetPage);
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load PDF: ${e}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      renderTasksRef.current.forEach((t) => t.cancel());
      renderTasksRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfData]);

  // Cancel running renders and clear cache when document or zoom changes
  useEffect(() => {
    renderTasksRef.current.forEach((t) => t.cancel());
    renderTasksRef.current = [];
    renderedPagesRef.current.clear();
  }, [pdfDoc, zoom]);

  // Intersection Observer to render pages on demand as they scroll into view
  useEffect(() => {
    if (!containerRef.current || !pdfDoc || loading) return;

    const renderPage = async (pageNum: number) => {
      // If already rendered at this zoom, skip
      if (renderedPagesRef.current.get(pageNum) === zoom) return;

      const canvas = canvasRefs.current.get(pageNum);
      if (!canvas) return;

      try {
        renderedPagesRef.current.set(pageNum, zoom); // mark as rendering/rendered
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: zoom * window.devicePixelRatio });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / window.devicePixelRatio}px`;
        canvas.style.height = `${viewport.height / window.devicePixelRatio}px`;

        const renderTask = page.render({ canvasContext: ctx, viewport });
        renderTasksRef.current.push(renderTask);
        await renderTask.promise;
      } catch {
        // If failed/cancelled, remove from rendered map so it can retry
        renderedPagesRef.current.delete(pageNum);
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const pageNum = parseInt((entry.target as HTMLElement).dataset.page || "0", 10);
            if (pageNum >= 1 && pageNum <= numPages) {
              renderPage(pageNum);
            }
          }
        });
      },
      {
        root: containerRef.current,
        rootMargin: "800px 0px", // Render pages within 800px of viewport
        threshold: 0.01,
      }
    );

    const pageElements = containerRef.current.querySelectorAll("[data-page]");
    pageElements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, [pdfDoc, numPages, zoom, loading]);

  // Scroll to initial page when dimensions are known
  useLayoutEffect(() => {
    if (initialPage !== undefined && containerRef.current && defaultPageSize && !loading && !hasScrolledRef.current) {
      // initialPage is already 1-based
      let targetPage = initialPage;
      if (pageLabels) {
        const idx = pageLabels.indexOf(initialPage.toString());
        if (idx !== -1) {
          targetPage = idx + 1;
        }
      }
      const target = containerRef.current.querySelector(
        `[data-page="${targetPage}"]`
      );
      if (target) {
        hasScrolledRef.current = true;
        target.scrollIntoView({ behavior: "auto", block: "start" });
      }
    }
  }, [initialPage, defaultPageSize, numPages, pageLabels, loading]);

  // Extract text on the cited page (and its neighbour) and compute yellow
  // highlight rects for the best match against `highlightQuote`. Runs
  // independently of canvas rendering, so highlighting works even before a
  // page is scrolled into the lazy-render window.
  useEffect(() => {
    if (!pdfDoc || !highlightQuote) {
      setHighlightRects(new Map());
      textContentCacheRef.current.clear();
      return;
    }
    let cancelled = false;

    (async () => {
      const target = resolveTargetPage(initialPage, numPages, pageLabels);
      // Search the cited page first, then fall back to its neighbours.
      const candidates = Array.from(
        new Set([
          target,
          Math.min(target + 1, numPages),
          Math.max(target - 1, 1),
        ])
      ).filter((p) => p >= 1 && p <= numPages);

      const next = new Map<number, HighlightRect[]>();
      for (const pageNum of candidates) {
        if (cancelled) return;
        try {
          let items = textContentCacheRef.current.get(pageNum);
          if (!items) {
            const page = await pdfDoc.getPage(pageNum);
            const tc = await page.getTextContent();
            items = tc.items ?? [];
            textContentCacheRef.current.set(pageNum, items as any[]);
          }
          const vp = (await pdfDoc.getPage(pageNum)).getViewport({ scale: 1.0 });
          const rects = computePdfHighlightRects(items as any[], highlightQuote, vp.height);
          if (rects.length > 0) {
            next.set(pageNum, rects);
            break; // first page with a match wins
          }
        } catch {
          // ignore extraction failures on individual pages
        }
      }
      if (!cancelled) setHighlightRects(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, highlightQuote, initialPage, numPages, pageLabels]);

  // Keep input value in sync with current page changes
  useEffect(() => {
    const label = pageLabels && pageLabels[currentPage - 1] ? pageLabels[currentPage - 1] : currentPage.toString();
    setInputVal(label);
  }, [currentPage, pageLabels]);

  // Scroll to current page when zoom changes to maintain context
  useLayoutEffect(() => {
    if (zoom !== lastZoomRef.current) {
      const scaleRatio = zoom / lastZoomRef.current;
      lastZoomRef.current = zoom;
      
      // Synchronously resize canvases to prevent layout shifts while async render happens
      canvasRefs.current.forEach((canvas) => {
        if (canvas.style.width && canvas.style.height) {
          const w = parseFloat(canvas.style.width);
          const h = parseFloat(canvas.style.height);
          if (!isNaN(w) && !isNaN(h)) {
            canvas.style.width = `${w * scaleRatio}px`;
            canvas.style.height = `${h * scaleRatio}px`;
          }
        }
      });

      if (containerRef.current && defaultPageSize) {
        const target = containerRef.current.querySelector(
          `[data-page="${currentPage}"]`
        );
        if (target) {
          target.scrollIntoView({ behavior: "auto", block: "start" });
        }
      }
    }
  }, [zoom, currentPage, defaultPageSize]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        setCurrentPage((p) => Math.min(p + 1, numPages));
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentPage((p) => Math.max(p - 1, 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [numPages]);

  const canZoomIn = zoom < ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  const canZoomOut = zoom > ZOOM_LEVELS[0];

  const zoomIn = useCallback(() => {
    const nextZoom = ZOOM_LEVELS.find((v) => v > zoom);
    if (nextZoom !== undefined) {
      setZoom(nextZoom);
    }
  }, [zoom]);

  const zoomOut = useCallback(() => {
    const prevZoom = [...ZOOM_LEVELS].reverse().find((v) => v < zoom);
    if (prevZoom !== undefined) {
      setZoom(prevZoom);
    }
  }, [zoom]);

  const handleFitWidth = useCallback(async () => {
    if (!containerRef.current || !pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const vp = page.getViewport({ scale: 1.0 });
      const availableWidth = containerRef.current.clientWidth - 32;
      if (availableWidth > 0) {
        const targetZoom = availableWidth / vp.width;
        setZoom(Math.max(0.1, Number(targetZoom.toFixed(2))));
      }
    } catch {
      if (defaultPageSize) {
        const availableWidth = containerRef.current.clientWidth - 32;
        const targetZoom = availableWidth / defaultPageSize.width;
        setZoom(Math.max(0.1, Number(targetZoom.toFixed(2))));
      }
    }
  }, [pdfDoc, currentPage, defaultPageSize]);

  const handleFitHeight = useCallback(async () => {
    if (!containerRef.current || !pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(currentPage);
      const vp = page.getViewport({ scale: 1.0 });
      const availableHeight = containerRef.current.clientHeight - 32;
      if (availableHeight > 0) {
        const targetZoom = availableHeight / vp.height;
        setZoom(Math.max(0.1, Number(targetZoom.toFixed(2))));
      }
    } catch {
      if (defaultPageSize) {
        const availableHeight = containerRef.current.clientHeight - 32;
        const targetZoom = availableHeight / defaultPageSize.height;
        setZoom(Math.max(0.1, Number(targetZoom.toFixed(2))));
      }
    }
  }, [pdfDoc, currentPage, defaultPageSize]);

  const handleGoToPage = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      let pageNum = -1;
      const term = inputVal.trim();
      if (!term) return;

      if (pageLabels) {
        const idx = pageLabels.findIndex((l) => l.toLowerCase() === term.toLowerCase());
        if (idx !== -1) {
          pageNum = idx + 1;
        }
      }

      if (pageNum === -1) {
        const parsed = parseInt(term, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
          pageNum = parsed;
        }
      }

      if (pageNum >= 1 && pageNum <= numPages) {
        setCurrentPage(pageNum);
        const target = containerRef.current?.querySelector(
          `[data-page="${pageNum}"]`
        );
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [numPages, inputVal, pageLabels]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-sm text-muted-foreground">Loading PDF…</span>
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
    <div className="flex h-full flex-col">
      {/* Page navigation toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              setCurrentPage((p) => Math.max(p - 1, 1));
              const target = containerRef.current?.querySelector(
                `[data-page="${Math.max(currentPage - 1, 1)}"]`
              );
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            disabled={currentPage <= 1}
          >
            <ChevronLeft size={16} />
          </Button>

          <form onSubmit={handleGoToPage} className="flex items-center gap-1">
            <Input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="h-7 w-12 text-center text-sm"
            />
            <span className="text-sm text-muted-foreground">/ {numPages}</span>
          </form>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              setCurrentPage((p) => Math.min(p + 1, numPages));
              const target = containerRef.current?.querySelector(
                `[data-page="${Math.min(currentPage + 1, numPages)}"]`
              );
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            disabled={currentPage >= numPages}
          >
            <ChevronRight size={16} />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={zoomOut}
            disabled={!canZoomOut}
          >
            <ZoomOut size={16} />
          </Button>
          <span className="w-14 text-center text-sm text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={zoomIn}
            disabled={!canZoomIn}
          >
            <ZoomIn size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 h-7 px-2 text-xs"
            onClick={() => setZoom(1.0)}
            disabled={zoom === 1.0}
          >
            <Maximize2 size={14} className="mr-1" />
            1:1
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleFitWidth}
            disabled={!defaultPageSize}
          >
            <ArrowLeftRight size={14} className="mr-1" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={handleFitHeight}
            disabled={!defaultPageSize}
          >
            <ArrowUpDown size={14} className="mr-1" />
          </Button>
        </div>
      </div>

      {/* PDF pages */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-zinc-100 p-4 dark:bg-zinc-900"
        onScroll={() => {
          // Track current visible page based on scroll position
          if (!containerRef.current) return;
          const pages = containerRef.current.querySelectorAll<HTMLElement>(
            "[data-page]"
          );
          const containerRect = containerRef.current.getBoundingClientRect();
          const containerCenter = containerRect.top + containerRect.height / 2;
          
          let bestPage = 1;
          for (const page of pages) {
            const rect = page.getBoundingClientRect();
            // If the top of the page is below the vertical center of the container,
            // we stop, and use the previous page we saw as the current one.
            if (rect.top > containerCenter) {
              break;
            }
            bestPage = parseInt(page.dataset.page || "1", 10);
          }
          setCurrentPage(bestPage);
        }}
      >
        <div className="mx-auto flex flex-col items-center gap-4">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
            <div 
              key={pageNum} 
              data-page={pageNum} 
              className="relative bg-white shadow-md flex items-center justify-center"
              style={defaultPageSize ? {
                width: defaultPageSize.width * zoom,
                minHeight: defaultPageSize.height * zoom,
              } : undefined}
            >
              <canvas
                ref={(el) => {
                  if (el) {
                    canvasRefs.current.set(pageNum, el);
                  } else {
                    canvasRefs.current.delete(pageNum);
                  }
                }}
                className="max-w-full"
              />
              <div
                className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white"
              >
                {pageLabels && pageLabels[pageNum - 1] ? pageLabels[pageNum - 1] : pageNum}
              </div>
              {/* Citation highlight overlays (scale-1 coords × current zoom) */}
              {highlightRects.get(pageNum)?.map((rect, i) => (
                <div
                  key={`hl-${pageNum}-${i}`}
                  className="pdf-highlight-rect"
                  style={{
                    left: rect.left * zoom,
                    top: rect.top * zoom,
                    width: rect.width * zoom,
                    height: rect.height * zoom,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
