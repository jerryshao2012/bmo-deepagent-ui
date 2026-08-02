"use client";

import React, { useEffect, useState } from "react";
import { Download, ImageOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  downloadMarkdownImage,
  fetchMarkdownImage,
} from "@/lib/markdown-images";
import { cn } from "@/lib/utils";

export function SyncedMarkdownImage({
  markdownId,
  assetId,
  alt,
  allowDownload,
  light,
}: {
  markdownId: string;
  assetId: string;
  alt?: string;
  allowDownload: boolean;
  light: boolean;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState(alt || "image");
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let nextObjectUrl: string | null = null;
    setObjectUrl(null);
    setError(false);

    void fetchMarkdownImage(markdownId, assetId, controller.signal)
      .then(({ blob, filename: originalFilename }) => {
        if (!active) return;
        nextObjectUrl = URL.createObjectURL(blob);
        setFilename(originalFilename || alt || "image");
        setObjectUrl(nextObjectUrl);
      })
      .catch((fetchError: unknown) => {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") {
          return;
        }
        if (active) setError(true);
      });

    return () => {
      active = false;
      controller.abort();
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
    };
  }, [markdownId, assetId, alt]);

  if (error) {
    return (
      <span
        className={cn(
          "my-6 flex min-h-24 max-w-full flex-col items-center justify-center rounded-lg border border-dashed px-5 py-6 text-center",
          light
            ? "border-zinc-300 bg-zinc-50 text-zinc-500"
            : "border-border bg-muted/20 text-foreground/60",
        )}
      >
        <ImageOff className="mb-2 h-5 w-5" />
        <span className="text-xs font-medium">Image unavailable</span>
        {alt && <span className="mt-1 text-xs italic">{alt}</span>}
      </span>
    );
  }

  if (!objectUrl) {
    return (
      <span className="my-6 flex min-h-24 max-w-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </span>
    );
  }

  return (
    <span className="group relative my-6 block max-w-full text-center">
      <img
        src={objectUrl}
        alt={alt || filename}
        className={cn(
          "inline-block h-auto max-w-full rounded-lg border shadow-sm",
          light ? "border-zinc-200" : "border-border/40",
        )}
      />
      {allowDownload && (
        <button
          type="button"
          onClick={() => {
            void downloadMarkdownImage(markdownId, assetId, filename).catch(() =>
              toast.error("Failed to download image"),
            );
          }}
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-white/30 bg-black/70 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-black/85 focus:opacity-100 group-hover:opacity-100"
          aria-label={`Download ${filename}`}
          title={`Download ${filename}`}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
      )}
      {alt && (
        <span
          className={cn(
            "mt-2 block text-xs italic",
            light ? "text-zinc-500" : "text-foreground/60",
          )}
        >
          {alt}
        </span>
      )}
    </span>
  );
}
