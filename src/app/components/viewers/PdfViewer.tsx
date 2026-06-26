"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
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

interface PdfViewerProps {
  pdfData: ArrayBuffer;
  initialPage?: number;
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export const PdfViewer: React.FC<PdfViewerProps> = ({ pdfData, initialPage }) => {
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
  const hasScrolledRef = useRef(false);
  const lastZoomRef = useRef(zoom);
  const lastInitialPageRef = useRef(initialPage !== undefined ? initialPage + 1 : undefined);
  if (initialPage !== undefined) {
    const oneBased = initialPage + 1;
    if (oneBased !== lastInitialPageRef.current) {
      lastInitialPageRef.current = oneBased;
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
        } catch (e) {
          // ignore error if page 1 fails
        }

        setPdfDoc(doc);
        setNumPages(doc.numPages);

        let labels: string[] | null = null;
        try {
          labels = await doc.getPageLabels();
          setPageLabels(labels);
        } catch (e) {
          // ignore page labels error
        }

        let targetPage = 1;
        if (initialPage !== undefined) {
          const oneBased = initialPage + 1;
          if (labels) {
            const idx = labels.indexOf(oneBased.toString());
            if (idx !== -1) {
              targetPage = idx + 1;
            } else {
              targetPage = Math.min(Math.max(oneBased, 1), doc.numPages);
            }
          } else {
            targetPage = Math.min(Math.max(oneBased, 1), doc.numPages);
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
  }, [pdfData]);

  // Render all visible pages
  const renderPages = useCallback(async () => {
    if (!pdfDoc) return;

    // Cancel previous renders
    renderTasksRef.current.forEach((t) => t.cancel());
    renderTasksRef.current = [];

    const pagePromises: Promise<void>[] = [];
    for (let i = 1; i <= numPages; i++) {
      const promise = (async (pageNum: number) => {
        const canvas = canvasRefs.current.get(pageNum);
        if (!canvas) return;

        try {
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
          // Ignore cancelled renders
        }
      })(i);
      pagePromises.push(promise);
    }

    await Promise.all(pagePromises);
  }, [pdfDoc, numPages, zoom, loading]);

  useEffect(() => {
    renderPages();
  }, [renderPages]);

  // Scroll to initial page when dimensions are known
  useLayoutEffect(() => {
    if (initialPage !== undefined && containerRef.current && defaultPageSize && !loading && !hasScrolledRef.current) {
      const oneBased = initialPage + 1;
      let targetPage = oneBased;
      if (pageLabels) {
        const idx = pageLabels.indexOf(oneBased.toString());
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
    } catch (e) {
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
    } catch (e) {
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
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
