"use client";

import React, { useState } from "react";
import { Download, File, FileArchive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  markdownArchiveLabel,
  markdownAttachmentLabel,
} from "@/lib/markdown-attachment-types";
import {
  downloadMarkdownAsset,
  formatMarkdownAttachmentSize,
} from "@/lib/markdown-images";
import { cn } from "@/lib/utils";

export function SyncedMarkdownAttachment({
  markdownId,
  assetId,
  filename,
  size,
  allowDownload,
  light,
}: {
  markdownId: string;
  assetId: string;
  filename: string;
  size: number | null;
  allowDownload: boolean;
  light: boolean;
}) {
  const [isDownloading, setIsDownloading] = useState(false);
  const formattedSize = formatMarkdownAttachmentSize(size);
  const attachmentLabel = markdownAttachmentLabel(filename);
  const isArchive = markdownArchiveLabel(filename) !== null;
  const description = formattedSize
    ? `${attachmentLabel} · ${formattedSize}`
    : attachmentLabel;

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadMarkdownAsset(markdownId, assetId, filename);
    } catch {
      toast.error("Failed to download attachment");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <span
      className={cn(
        "my-4 flex w-full max-w-xl items-center gap-3 rounded-xl border px-3.5 py-3 text-left shadow-sm",
        light
          ? "border-zinc-200 bg-zinc-50 text-zinc-900"
          : "border-border/60 bg-muted/20 text-foreground"
      )}
      data-markdown-attachment="true"
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          light
            ? "bg-amber-100 text-amber-700"
            : "bg-amber-500/15 text-amber-400"
        )}
        aria-hidden="true"
      >
        {isArchive ? (
          <FileArchive className="h-5 w-5" />
        ) : (
          <File className="h-5 w-5" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-sm font-semibold"
          title={filename}
        >
          {filename}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-xs",
            light ? "text-zinc-500" : "text-foreground/60"
          )}
        >
          {description}
        </span>
      </span>
      {allowDownload && (
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60",
            light
              ? "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
              : "border-border bg-background/60 text-foreground hover:bg-muted"
          )}
          aria-label={`Download ${filename}`}
          title={`Download ${filename}`}
        >
          {isDownloading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download
        </button>
      )}
    </span>
  );
}
