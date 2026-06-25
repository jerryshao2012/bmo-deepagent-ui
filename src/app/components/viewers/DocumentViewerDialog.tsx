"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileText,
  Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PdfViewer } from "@/app/components/viewers/PdfViewer";
import { DocxViewer } from "@/app/components/viewers/DocxViewer";
import { XlsxViewer } from "@/app/components/viewers/XlsxViewer";
import { PptxViewer } from "@/app/components/viewers/PptxViewer";
import {
  buildDocumentDownloadUrl,
  fetchDocumentArrayBuffer,
} from "@/app/components/viewers/documentUtils";

export interface DocumentViewerState {
  filePath: string;
  page?: number;
  slide?: number;
}

interface DocumentViewerDialogProps {
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
    case "xls":
      return "xlsx";
    case "pptx":
    case "ppt":
      return "pptx";
    default:
      return "unsupported";
  }
}

export const DocumentViewerDialog: React.FC<DocumentViewerDialogProps> = ({
  state,
  threadId,
  onClose,
}) => {
  const [docData, setDocData] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const handleDownload = () => {
    if (!state) return;
    const url = buildDocumentDownloadUrl(state.filePath, threadId);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.filePath.replace(/^\/+/, "");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!state) return null;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "!max-w-none flex flex-col p-6 transition-all duration-300 ease-in-out border border-border shadow-2xl backdrop-blur-md bg-background/95",
          isFullscreen
            ? "h-screen max-h-screen w-screen rounded-none border-none p-6"
            : "h-[85vh] max-h-[85vh] w-[92vw] rounded-xl"
        )}
      >
        <DialogTitle className="sr-only">
          {state.filePath}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Document viewer for Deep Research files.
        </DialogDescription>

        {/* Header bar */}
        <div className="mb-4 flex items-center justify-between border-b border-border pb-4 select-none">
          <div className="flex min-w-0 items-center gap-2">
            {/* macOS-style Window Control Dots */}
            <div className="flex items-center gap-[6px] mr-2 shrink-0 group/dots py-1 px-1">
              <button
                onClick={onClose}
                className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#FF5F56] border border-[#E0443E] active:bg-[#BF403A] focus:outline-none transition-colors"
                aria-label="Close"
              >
                <svg
                  className="absolute h-[5px] w-[5px] text-[#4C0002] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100"
                  viewBox="0 0 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                >
                  <path d="M1 1l4 4M5 1L1 5" />
                </svg>
              </button>
              <button
                onClick={() =>
                  toast.info("Minimize is not supported in browser dialog")
                }
                className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#FFBD2E] border border-[#DFA023] active:bg-[#C08E1A] focus:outline-none transition-colors"
                aria-label="Minimize"
              >
                <svg
                  className="absolute h-[5px] w-[5px] text-[#5C3E00] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100"
                  viewBox="0 0 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                >
                  <path d="M1 3h4" />
                </svg>
              </button>
              <button
                onClick={() => setIsFullscreen((prev) => !prev)}
                className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#27C93F] border border-[#1AAB29] active:bg-[#12821B] focus:outline-none transition-colors"
                aria-label="Toggle Fullscreen"
              >
                <svg
                  className="absolute h-[5px] w-[5px] text-[#003300] opacity-0 transition-opacity duration-150 group-hover/dots:opacity-100"
                  viewBox="0 0 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                >
                  <path d="M1.5 4.5l3-3 M1.5 2.5v2h2 M4.5 3.5v-2h-2" />
                </svg>
              </button>
            </div>
            <div className="h-4 w-[1px] bg-border mr-2 shrink-0" />
            <FileText className="text-primary/50 h-5 w-5 shrink-0" />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-base font-medium text-primary">
              {state.filePath}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              onClick={handleDownload}
              variant="ghost"
              size="sm"
              className="h-8 px-2"
            >
              <Download size={16} className="mr-1" />
              Download
            </Button>
          </div>
        </div>

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
            <PdfViewer pdfData={docData} initialPage={state.page} />
          ) : docType === "docx" && docData ? (
            <DocxViewer docxData={docData} initialPage={state.page} />
          ) : docType === "xlsx" && docData ? (
            <XlsxViewer xlsxData={docData} />
          ) : docType === "pptx" ? (
            <PptxViewer
              filePath={state.filePath}
              threadId={threadId}
              initialSlide={state.slide ?? state.page}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};
