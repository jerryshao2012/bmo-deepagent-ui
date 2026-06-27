"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileText,
  Loader2,
  Highlighter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PdfViewer } from "@/app/components/viewers/PdfViewer";
import { DocxViewer } from "@/app/components/viewers/DocxViewer";
import { XlsxViewer } from "@/app/components/viewers/XlsxViewer";
import { PptxViewer } from "@/app/components/viewers/PptxViewer";
import {
  downloadDocument,
  fetchDocumentArrayBuffer,
} from "@/app/components/viewers/documentUtils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarButton,
  ToolbarSeparator,
  WindowControlDots,
} from "@/components/ui/toolbar";

export interface DocumentViewerState {
  filePath: string;
  page?: number;
  slide?: number;
  /** Surrounding-sentence quote used to highlight the referenced passage. */
  quote?: string;
}

interface DocumentViewerPanelProps {
  state: DocumentViewerState | null;
  threadId: string;
  onClose: () => void;
}

type DocType = "pdf" | "docx" | "xlsx" | "pptx" | "unsupported";

function detectDocType(filePath: string): DocType {
  // Strip any trailing .md/.txt wiki-raw suffix before detecting the type.
  const cleaned = filePath.replace(/\.(?:md|txt)$/i, "");
  const ext = cleaned.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "xlsx":
      return "xlsx";
    case "xls":
      return "xlsx";
    case "pptx":
      return "pptx";
    case "ppt":
      return "pptx";
    default:
      return "unsupported";
  }
}

export const DocumentViewerPanel: React.FC<DocumentViewerPanelProps> = ({
  state,
  threadId,
  onClose,
}) => {
  const [docData, setDocData] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [highlightEnabled, setHighlightEnabled] = useState(true);

  // Reset highlight enabled to true when state or file changes
  useEffect(() => {
    setHighlightEnabled(true);
  }, [state?.filePath]);

  const docType = useMemo(
    () => (state ? detectDocType(state.filePath) : "unsupported"),
    [state]
  );

  // Fetch binary when dialog opens or the target file changes
  useEffect(() => {
    if (!state) {
      setDocData(null);
      setError(null);
      return;
    }
    if (docType === "unsupported") return;
    // PPTX uses the extract endpoint (text), not the binary endpoint.
    if (docType === "pptx") return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDocumentArrayBuffer(state.filePath, threadId);
        if (!cancelled) setDocData(data);
      } catch (e) {
        if (!cancelled) setError(`Failed to load document: ${e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, threadId, docType]);

  // Reset fullscreen on close
  useEffect(() => {
    if (!state) setIsFullscreen(false);
  }, [state]);

  // Lock scroll on background body when mounted
  useEffect(() => {
    if (!state) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [state]);

  const handleDownload = async () => {
    if (!state) return;
    try {
      await downloadDocument(state.filePath, threadId);
    } catch (e) {
      console.error("Failed to download document:", e);
      toast.error("Failed to download document");
    }
  };

  if (!state) return null;

  const currentQuote = highlightEnabled ? state.quote : undefined;

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full bg-background/95 backdrop-blur-md overflow-hidden",
        isFullscreen ? "fixed inset-0 z-50 p-6" : "p-4"
      )}
    >
        <Toolbar variant="transparent" className="mb-4 pb-4 border-b border-border">
          <ToolbarGroup>
            <WindowControlDots
              onClose={onClose}
              onMinimize={() => toast.info("Minimize is not supported in browser dialog")}
              onMaximize={() => setIsFullscreen((prev) => !prev)}
            />
            <ToolbarSeparator />
            <FileText className="text-primary/50 h-5 w-5 shrink-0 ml-1" />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-medium text-primary">
              {state.filePath.replace(/^\/+/, "")}
            </span>
          </ToolbarGroup>
          <ToolbarGroup>
            {state.quote && (
              <ToolbarButton
                onClick={() => setHighlightEnabled((prev) => !prev)}
                tooltip={highlightEnabled ? "Turn off highlights" : "Highlight referenced text"}
                className={cn(
                  "h-8 w-8 rounded-md transition-all duration-200",
                  highlightEnabled
                    ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:text-amber-600"
                    : "text-muted-foreground hover:!text-zinc-100 hover:!bg-zinc-800"
                )}
              >
                <Highlighter size={16} />
              </ToolbarButton>
            )}
            <ToolbarButton
              onClick={handleDownload}
              tooltip="Download file"
              className="h-8 w-8 rounded-md text-muted-foreground hover:!text-zinc-100 hover:!bg-zinc-800 transition-all duration-200"
            >
              <Download size={16} />
            </ToolbarButton>
          </ToolbarGroup>
        </Toolbar>

        {/* Viewer body */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          {docType === "unsupported" ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Preview not supported for this file type.
                <button
                  onClick={handleDownload}
                  className="ml-1 text-blue-600 hover:underline"
                >
                  Download
                </button>{" "}
                to view it.
              </p>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-3 text-sm text-muted-foreground">
                Loading document…
              </span>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-red-500">{error}</p>
            </div>
          ) : docType === "pdf" && docData ? (
            <PdfViewer
              pdfData={docData}
              initialPage={state.page}
              highlightQuote={currentQuote}
            />
          ) : docType === "docx" && docData ? (
            <DocxViewer
              docxData={docData}
              initialPage={state.page}
              highlightQuote={currentQuote}
            />
          ) : docType === "xlsx" && docData ? (
            <XlsxViewer xlsxData={docData} highlightQuote={currentQuote} />
          ) : docType === "pptx" ? (
            <PptxViewer
              filePath={state.filePath}
              threadId={threadId}
              initialSlide={state.slide ?? state.page}
              highlightQuote={currentQuote}
            />
          ) : null}
        </div>
    </div>
  );
};
