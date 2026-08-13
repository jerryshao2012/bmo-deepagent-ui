"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { normalizeDocumentCitationPath } from "@/app/components/viewers/documentUtils";
import { SyncedMarkdownAttachment } from "@/app/components/SyncedMarkdownAttachment";
import { SyncedMarkdownImage } from "@/app/components/SyncedMarkdownImage";
import {
  parseSyncedAttachmentHref,
  parseSyncedAttachmentSize,
  parseSyncedImageSource,
} from "@/lib/markdown-images";
import { useEffect, useState } from "react";

interface MermaidProps {
  chart: string;
}

const Mermaid: React.FC<MermaidProps> = ({ chart }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "loose",
          flowchart: {
            useMaxWidth: false,
            htmlLabels: false,
          },
        });

        // Pre-process the chart syntax to upgrade legacy 'graph' to 'flowchart'
        // and automatically inject 'direction TB' into subgraphs of vertical flowcharts.
        let processedChart = chart.trim();

        // Upgrade legacy 'graph' to 'flowchart' for better subgraph layout support
        processedChart = processedChart.replace(/^\s*graph\b/i, "flowchart");

        const isVertical = /^\s*(graph|flowchart)\s+(TD|TB)/i.test(processedChart);
        if (isVertical) {
          const lines = processedChart.split("\n");
          const processedLines: string[] = [];

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            processedLines.push(line);

            if (/^\s*subgraph\s+/i.test(line)) {
              let hasDirection = false;
              for (let j = i + 1; j < lines.length; j++) {
                const nextLine = lines[j].trim();
                if (nextLine === "" || nextLine.startsWith("%%")) continue;
                if (/^end\b/i.test(nextLine)) break;
                if (/^direction\s+/i.test(nextLine)) {
                  hasDirection = true;
                  break;
                }
              }

              if (!hasDirection) {
                const indentMatch = /^(\s*)/.exec(line);
                const indent = indentMatch ? indentMatch[1] : "";
                processedLines.push(`${indent}    direction TB`);
              }
            }
          }
          processedChart = processedLines.join("\n");
        }

        // Unique ID for mermaid render to prevent target element mismatches
        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(id, processedChart);

        if (isMounted) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        console.error("Mermaid rendering error:", err);
        if (isMounted) {
          setError("Failed to render diagram");
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  useEffect(() => {
    if (svg && containerRef.current) {
      const svgElement = containerRef.current.querySelector("svg");
      if (svgElement) {
        svgElement.style.maxWidth = "none";
        svgElement.style.height = "auto";
        svgElement.style.display = "block";
        svgElement.style.marginLeft = "auto";
        svgElement.style.marginRight = "auto";
      }
    }
  }, [svg]);

  if (error) {
    return (
      <div className="p-4 bg-rose-950/30 text-rose-400 rounded-lg text-xs font-mono border border-rose-900/50 my-4 text-left">
        <p className="font-semibold text-rose-300">Mermaid Error:</p>
        <pre className="mt-1 whitespace-pre-wrap overflow-x-auto text-[11px] leading-relaxed">{chart}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="p-4 bg-[#1e1e1e] border border-zinc-800 rounded-lg text-xs text-zinc-500 font-mono animate-pulse my-4 text-center">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-svg-container p-6 bg-[#18181b] rounded-xl border border-zinc-800 shadow-md my-4 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

/**
 * Normalises document citation patterns produced by the LLM so they render
 * consistently as:  (`/file.pdf`, p. N)
 *
 * Citation patterns handled (all file extensions: .pdf .docx .pptx .xlsx,
 * including their .pdf.md / .pdf.txt wiki-raw variants).
 *
 * All patterns produce a plain markdown link  [label](/path.ext)  where the
 * href is the actual file path.  Page / slide info is kept in the label text.
 * A capture-phase click handler on the container div intercepts these links
 * and opens the document viewer dialog instead of navigating the browser.
 */
function preprocessMarkdown(content: string): string {
  if (!content) return content;

  const toDocumentHref = (path: string, query?: string): string => {
    const encodedPath = encodeURI(path);
    return query ? `${encodedPath}?${query}` : encodedPath;
  };

  // Shared: matches a document path with a supported extension.
  // Covers /raw/file.pdf.md and /file.pdf alike.
  const DOC = /\/[A-Za-z0-9._\-/ ]+\.(?:pdf|docx|pptx|xlsx)(?:\.(?:md|txt))?/i.source;

  // Strip backticks surrounding document paths so they can be processed and rendered as clickable links
  let result = content.replace(new RegExp(`\`(${DOC})\``, "gi"), "$1");

  // Multi-page citations (e.g. (/bmo_ar2025.pdf, pp. 91, 100))
  // Transform them into individual clickable page links so that each page number opens its respective page.
  result = result.replace(
    new RegExp(`\\((?:Source:\\s+)?(${DOC}),\\s*(?:p\\.?|pp\\.?|page|pages)\\s*(\\d+(?:\\s*,\\s*\\d+)+)\\)`, "gi"),
    (match, path: string, pageListStr: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      const hasSource = match.toLowerCase().includes("source:");
      const pages = pageListStr.split(",").map(p => p.trim());
      const links = pages.map((p, idx) => {
        if (idx === 0) {
          return `[${normalizedPath}, p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        } else {
          return `[p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        }
      });
      const prefix = hasSource ? "Source: " : "";
      return `(${prefix}${links.join(", ")})`;
    }
  );

  result = result.replace(
    new RegExp(`\\(\\[(${DOC})\\]\\((?:p\\.?|pp\\.?|page|pages)\\s*(\\d+(?:\\s*,\\s*\\d+)+)\\)\\)`, "gi"),
    (match, path: string, pageListStr: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      const pages = pageListStr.split(",").map(p => p.trim());
      const links = pages.map((p, idx) => {
        if (idx === 0) {
          return `[${normalizedPath}, p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        } else {
          return `[p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        }
      });
      return `(${links.join(", ")})`;
    }
  );

  result = result.replace(
    new RegExp(`\\[(${DOC})\\]\\((?:p\\.?|pp\\.?|page|pages)\\s*(\\d+(?:\\s*,\\s*\\d+)+)\\)`, "gi"),
    (match, path: string, pageListStr: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      const pages = pageListStr.split(",").map(p => p.trim());
      const links = pages.map((p, idx) => {
        if (idx === 0) {
          return `[${normalizedPath}, p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        } else {
          return `[p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        }
      });
      return links.join(", ");
    }
  );

  // Pattern 0: [label]([/file.ext](/file.ext)) or [label]([/file.ext](page-ref)) — double-nested link
  // e.g. [bmo_ar2025.pdf, p. 30]([/bmo_ar2025.pdf](/bmo_ar2025.pdf))  →  [bmo_ar2025.pdf, p. 30](/bmo_ar2025.pdf)
  result = result.replace(
    new RegExp(`\\[([^\\]]+)\\]\\(\\[(${DOC})\\]\\(([^)]+)\\)\\)`, "gi"),
    (match, label: string, path: string, pageRef: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      const cleanPageRef = pageRef.trim();
      if (
        cleanPageRef === path ||
        normalizeDocumentCitationPath(cleanPageRef) === normalizedPath ||
        /^https?:\/\//i.test(cleanPageRef)
      ) {
        return `[${label}](${toDocumentHref(normalizedPath)})`;
      }
      return `[${label}, ${cleanPageRef}](${toDocumentHref(normalizedPath)})`;
    },
  );

  // Pattern 1: ([/file.ext](page-ref)) — broken markdown link inside outer parens
  // e.g. ([/bmo_ar2025.pdf](p. 30))  →  [/bmo_ar2025.pdf, p. 30](/bmo_ar2025.pdf)
  result = result.replace(
    new RegExp(`\\(\\[(${DOC})\\]\\(([^)]+)\\)\\)`, "gi"),
    (match, path: string, pageRef: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      if (/^https?:\/\//i.test(pageRef.trim())) return match;
      const cleanPageRef = pageRef.trim();
      if (
        cleanPageRef === path ||
        normalizeDocumentCitationPath(cleanPageRef) === normalizedPath
      ) {
        return `[${normalizedPath}](${toDocumentHref(normalizedPath)})`;
      }
      const label = `${normalizedPath}, ${cleanPageRef}`.replace(/\|/g, "\\|");
      return `[${label}](${toDocumentHref(normalizedPath)})`;
    },
  );

  // Pattern 2: [/file.ext](page-ref) — bare broken markdown link (no outer parens)
  // e.g. [/bmo_ar2025.pdf](p. 30)  →  [/bmo_ar2025.pdf, p. 30](/bmo_ar2025.pdf)
  result = result.replace(
    new RegExp(`\\[(${DOC})\\]\\(([^)]+)\\)`, "gi"),
    (match, path: string, pageRef: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      if (/^https?:\/\//i.test(pageRef.trim())) return match;
      const cleanPageRef = pageRef.trim();
      if (
        cleanPageRef === path ||
        normalizeDocumentCitationPath(cleanPageRef) === normalizedPath
      ) {
        return `[${normalizedPath}](${toDocumentHref(normalizedPath)})`;
      }
      const label = `${normalizedPath}, ${cleanPageRef}`.replace(/\|/g, "\\|");
      return `[${label}](${toDocumentHref(normalizedPath)})`;
    },
  );

  // Pattern 3: (Source: /file.ext, p. N) — plain-text "Source:" prefix citation
  // e.g. (Source: /bmo_ar2025.pdf, p. 69)  →  (Source: [/bmo_ar2025.pdf, p. 69](/bmo_ar2025.pdf))
  result = result.replace(
    new RegExp(`\\(Source:\\s+(${DOC})([^)]*)\\)`, "gi"),
    (match, path: string, rest: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      const label = `${normalizedPath}${rest}`.replace(/\|/g, "\\|");
      return `(Source: [${label}](${toDocumentHref(normalizedPath)}))`;
    },
  );

  // Pattern 4: (/file.ext, p. N) — plain path citation in parens
  // e.g. (/bmo_ar2025.pdf, p. 100)  →  ([/bmo_ar2025.pdf, p. 100](/bmo_ar2025.pdf))
  // Negative lookahead (?!`) prevents double-wrapping already-fixed citations.
  result = result.replace(
    new RegExp(`\\((?![\`\\(])(${DOC})([^)]*)\\)`, "gi"),
    (match, path: string, rest: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      const label = `${normalizedPath}${rest}`.replace(/\|/g, "\\|");
      return `([${label}](${toDocumentHref(normalizedPath)}))`;
    },
  );

  // Pattern 5: Bare document citations (e.g. /bmo_ar2025.pdf, p. 22 or /bmo_ar2025.pdf: p. 29, p. 69 or just /bmo_ar2025.pdf)
  // Negative lookbehind ensures it's not already inside/part of a markdown link target/destination
  result = result.replace(
    new RegExp(`(?<![a-zA-Z0-9([\\]/:-])(${DOC})((?:[,:]\\s*(?:p\\.?|pp\\.?|page|pages)?\\s*\\d+(?:\\s*(?:[-–,:]|\\bto\\b)\\s*(?:p\\.?|pp\\.?|page|pages)?\\s*\\d+)*)+)?`, "gi"),
    (match, path: string, pageSuffix: string) => {
      const normalizedPath = normalizeDocumentCitationPath(path);
      if (!pageSuffix) {
        return `[${normalizedPath}](${toDocumentHref(normalizedPath)})`;
      }
      const hasRange = /[-–]|\bto\b/i.test(pageSuffix);
      if (hasRange) {
        const matchPage = pageSuffix.match(/\d+/);
        const firstPage = matchPage ? matchPage[0] : "";
        const label = `${normalizedPath}${pageSuffix}`.replace(/\|/g, "\\|");
        return `[${label}](${toDocumentHref(normalizedPath, `page=${firstPage}`)})`;
      }
      const pages = pageSuffix.match(/\d+/g) || [];
      const links = pages.map((p, idx) => {
        if (idx === 0) {
          return `[${normalizedPath}, p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        } else {
          return `[p. ${p}](${toDocumentHref(normalizedPath, `page=${p}`)})`;
        }
      });
      return links.join(", ");
    }
  );

  return result;
}


interface MarkdownContentProps {
  content: string;
  className?: string;
  light?: boolean;
  syncedAssetContext?: {
    markdownId: string;
    allowDownload: boolean;
  };
  onDocumentClick?: (
    filePath: string,
    page?: number,
    slide?: number,
    quote?: string
  ) => void;
}

// Regex matching any bare document-path href produced by preprocessMarkdown.
const DOC_HREF_RE = /^(\/[A-Za-z0-9._\-/ ]+\.(?:pdf|docx|pptx|xlsx)(?:\.(?:md|txt))?)(?:\?([^#]*))?(?:#(.*))?$/i;

/**
 * Derive a highlight `quote` from the response text surrounding a citation
 * link. We take the block-level ancestor (<p>/<li>/<td>/…), locate the link
 * inside it, pick the sentence that contains it, then strip the citation
 * label/parenthetical so the quote is just the referenced prose.
 *
 * Returns the cleaned quote, or undefined if nothing useful could be derived.
 */
function extractSurroundingQuote(anchor: HTMLAnchorElement): string | undefined {
  const block = anchor.closest("p, li, td, blockquote, dd, dt, div");
  if (!block) return undefined;

  const blockText = block.textContent ?? "";
  const linkText = (anchor.textContent ?? "").trim();
  if (!blockText) return undefined;

  // Offset of the link within the block's flat text, via a Range.
  let linkOffset = -1;
  try {
    const range = document.createRange();
    range.selectNodeContents(block);
    const linkRange = document.createRange();
    linkRange.selectNodeContents(anchor);
    // Measure text up to the start of the link.
    const upto = range.cloneRange();
    upto.setEnd(
      anchor.parentNode ? anchor : block,
      Array.from(block.childNodes).indexOf((anchor.parentNode ?? anchor) as unknown as ChildNode)
    );
    linkOffset = upto.toString().length;
  } catch {
    // fall through to indexOf
  }
  if (linkOffset === -1) {
    linkOffset = blockText.indexOf(linkText);
  }

  // Split into sentences and pick the one containing the link.
  // Avoid splitting on abbreviations like p., pp., e.g., i.e., etc.
  const sentences = blockText.split(/(?<!\b(?:p|pp|e\.g|i\.e|al|vs|etc)\b\.)(?<=[.!?])\s+/i);

  let cumulative = 0;
  let target = "";
  let targetIndex = -1;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const sStart = blockText.indexOf(s, cumulative);
    const sEnd = sStart + s.length;
    if (linkOffset >= sStart && linkOffset < sEnd) {
      target = s;
      targetIndex = i;
      break;
    }
    cumulative = sEnd;
  }

  if (!target) {
    target = blockText;
    targetIndex = sentences.length - 1;
  }

  // Remove the citation label and common surrounding citation artifacts.
  let quote = target;
  if (linkText) {
    quote = quote.replace(linkText, " ");
  }
  quote = quote
    .replace(/\(\s*(?:Source:\s*)?\[[^\]]*\]\([^)]*\)\s*\)/gi, " ") // ([…](…))
    .replace(/\(\s*Source:\s*\]/gi, " ")
    .replace(/\(\s*Source:\s*/gi, " ")
    .replace(/\)\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Determine if the quote is mostly just citation noise (paths, page references, digits, parentheses)
  // by checking a heavily stripped version of it.
  const cleanDOC = /[A-Za-z0-9._\-/]+\.(?:pdf|docx|pptx|xlsx)(?:\.(?:md|txt))?/gi;
  let testQuote = quote.replace(cleanDOC, " ");
  testQuote = testQuote.replace(/\b(?:p|pp|page|pages|slide|slides)\b/gi, " ");
  testQuote = testQuote.replace(/\b\d+\b/gi, " ");
  testQuote = testQuote.replace(new RegExp('[(),/#?=&:|-]', 'g'), " ");
  testQuote = testQuote.replace(/\s+/g, " ").trim();

  // If the quote is too short or is mostly citation noise, fall back to
  // the preceding sentence (because citations are often isolated in their own sentence).
  if (quote.length < 15 || testQuote.length < 10) {
    if (targetIndex > 0) {
      quote = sentences[targetIndex - 1];
    } else {
      quote = blockText.replace(linkText, " ").replace(/\s+/g, " ").trim();
    }
  }

  return quote || undefined;
}

export const MarkdownContent = React.memo<MarkdownContentProps>(
  ({
    content,
    className = "",
    light = false,
    onDocumentClick,
    syncedAssetContext,
  }) => {
    // Capture-phase click handler: intercepts ALL anchor clicks inside this
    // container before the browser (or Next.js router) can navigate.
    const handleLinkCapture = React.useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!onDocumentClick) return;
        const anchor = (e.target as HTMLElement).closest("a");
        if (!anchor) return;
        let href = anchor.getAttribute("href") ?? "";

        // Decode URL-encoded characters (e.g. %5B -> [) to handle raw markdown links
        try {
          href = decodeURIComponent(href);
        } catch {
          // ignore malformed URIs and keep the original href
        }

        // Extract the clean document path if the href is nested (e.g. [/file.pdf](/file.pdf))
        const nestedMatch = href.match(/\[?(\/[A-Za-z0-9._\-/ ]+\.(?:pdf|docx|pptx|xlsx)(?:\.(?:md|txt))?)\]?(?:\([^)]*\))?/i);
        const cleanHref = normalizeDocumentCitationPath(
          nestedMatch ? nestedMatch[1] : href
        );

        const m = DOC_HREF_RE.exec(cleanHref);
        if (!m) return;

        e.preventDefault();
        e.stopPropagation();

        const filePath = m[1];
        const qs = m[2] ?? "";
        const hash = m[3] ?? "";
        const params = new URLSearchParams(qs);
        const hashParams = new URLSearchParams(hash);
        
        let page: number | undefined;
        let slide: number | undefined;

        // 1. First try to parse page from visible text, as LLMs often hallucinate wrong URL params
        const text = anchor.textContent ?? "";
        const slideM = text.match(/slide\s*(\d+)/i);
        const pageM = text.match(/(?:p\.?|pp\.?|page|pages)\s*(\d+)/i);
        
        if (slideM) {
          slide = parseInt(slideM[1], 10);
        } else if (pageM) {
          page = parseInt(pageM[1], 10);
        }

        // 2. Fallback to URL query or hash params if text doesn't contain a page
        if (!page && !slide) {
          const pageStr = params.get("page") || hashParams.get("page");
          const slideStr = params.get("slide") || hashParams.get("slide");
          if (pageStr) page = parseInt(pageStr, 10);
          if (slideStr) slide = parseInt(slideStr, 10);
        }

        // 3. Derive a highlight `quote` from the sentence surrounding the link.
        const quote = extractSurroundingQuote(anchor);

        onDocumentClick(filePath, page, slide, quote);
      },
      [onDocumentClick]
    );

    return (
      <div
        className={cn(
          "markdown-content min-w-0 max-w-full overflow-hidden break-words text-sm leading-relaxed",
          light ? "text-zinc-800 bg-white" : "text-foreground",
          className
        )}
        onClickCapture={handleLinkCapture}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1({ children, className, ...props }) {
              return (
                <h1
                  className={cn(
                    "text-2xl font-bold mt-7 mb-4 pb-2 border-b",
                    light ? "text-zinc-950 border-zinc-200" : "text-foreground border-border/50",
                    className
                  )}
                  {...props}
                >
                  {children}
                </h1>
              );
            },
            h2({ children, className, ...props }) {
              return (
                <h2
                  className={cn(
                    "text-xl font-semibold mt-6 mb-3",
                    light ? "text-zinc-900" : "text-foreground",
                    className
                  )}
                  {...props}
                >
                  {children}
                </h2>
              );
            },
            h3({ children, className, ...props }) {
              return (
                <h3
                  className={cn(
                    "text-lg font-semibold mt-5 mb-2",
                    light ? "text-zinc-800" : "text-foreground",
                    className
                  )}
                  {...props}
                >
                  {children}
                </h3>
              );
            },
            h4({ children, className, ...props }) {
              return (
                <h4
                  className={cn(
                    "text-base font-semibold mt-4 mb-2",
                    light ? "text-zinc-800" : "text-foreground",
                    className
                  )}
                  {...props}
                >
                  {children}
                </h4>
              );
            },
            h5({ children, className, ...props }) {
              return (
                <h5
                  className={cn(
                    "text-sm font-semibold mt-4 mb-2",
                    light ? "text-zinc-800" : "text-foreground",
                    className
                  )}
                  {...props}
                >
                  {children}
                </h5>
              );
            },
            h6({ children, className, ...props }) {
              return (
                <h6
                  className={cn(
                    "text-xs font-semibold mt-4 mb-2 uppercase tracking-wider",
                    light ? "text-zinc-600" : "text-foreground/80",
                    className
                  )}
                  {...props}
                >
                  {children}
                </h6>
              );
            },
            p({ children, className, ...props }) {
              return (
                <p
                  className={cn(
                    "mb-4 leading-relaxed last:mb-0",
                    light ? "text-zinc-800" : "text-foreground/90",
                    className
                  )}
                  {...props}
                >
                  {children}
                </p>
              );
            },
            strong({ children, className, ...props }) {
              return (
                <strong
                  className={cn(
                    "font-bold",
                    light ? "text-zinc-950" : "text-foreground",
                    className
                  )}
                  {...props}
                >
                  {children}
                </strong>
              );
            },
            em({ children, className, ...props }) {
              return (
                <em
                  className={cn(
                    "italic",
                    light ? "text-zinc-800" : "text-foreground/95",
                    className
                  )}
                  {...props}
                >
                  {children}
                </em>
              );
            },
            del({ children, className, ...props }) {
              return (
                <del
                  className={cn(
                    "line-through",
                    light ? "text-zinc-400" : "text-foreground/60",
                    className
                  )}
                  {...props}
                >
                  {children}
                </del>
              );
            },
            img({ src, alt, className, ...props }) {
              const assetId =
                typeof src === "string" ? parseSyncedImageSource(src) : null;
              if (assetId && syncedAssetContext) {
                return (
                  <SyncedMarkdownImage
                    markdownId={syncedAssetContext.markdownId}
                    assetId={assetId}
                    alt={alt}
                    allowDownload={syncedAssetContext.allowDownload}
                    light={light}
                  />
                );
              }
              return (
                <span className="block my-6 max-w-full text-center">
                  <img
                    src={src}
                    alt={alt}
                    className={cn(
                      "inline-block max-w-full h-auto rounded-lg border shadow-sm",
                      light ? "border-zinc-200" : "border-border/40",
                      className
                    )}
                    {...props}
                  />
                  {alt && (
                    <span
                      className={cn(
                        "block mt-2 text-xs italic",
                        light ? "text-zinc-500" : "text-foreground/60"
                      )}
                    >
                      {alt}
                    </span>
                  )}
                </span>
              );
            },
            code({
              className,
              children,
              ...props
            }: {
              className?: string;
              children?: React.ReactNode;
            }) {
              const isInline = !className || !className.startsWith("language-");
              if (!isInline) {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              }

              return (
                <code
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[0.875em] border",
                    light
                      ? "bg-zinc-100 text-purple-600 border-zinc-200"
                      : "bg-muted/50 text-rose-600 dark:text-rose-400 border-border/30",
                    className
                  )}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre({ children }: { children?: React.ReactNode }) {
              const codeElement = React.Children.toArray(children).find(
                (child) => React.isValidElement(child)
              );

              if (React.isValidElement(codeElement)) {
                const codeProps = codeElement.props as any;
                const className = codeProps.className || "";
                const codeText = String(codeProps.children || "").replace(/\n$/, "");
                const match = /language-(\w+)/.exec(className);

                if (match && match[1] === "mermaid") {
                  return <Mermaid chart={codeText} />;
                }

                return (
                  <div className="my-4 max-w-full overflow-hidden last:mb-0">
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match ? match[1] : "text"}
                      PreTag="div"
                      className="max-w-full rounded-md text-sm"
                      wrapLines={true}
                      wrapLongLines={true}
                      lineProps={{
                        style: {
                          wordBreak: "break-all",
                          whiteSpace: "pre-wrap",
                          overflowWrap: "break-word",
                        },
                      }}
                      customStyle={{
                        margin: 0,
                        maxWidth: "100%",
                        overflowX: "auto",
                        fontSize: "0.875rem",
                      }}
                    >
                      {codeText}
                    </SyntaxHighlighter>
                  </div>
                );
              }

              return (
                <div className="my-4 max-w-full overflow-hidden last:mb-0">
                  {children}
                </div>
              );
            },
            a({
              href,
              title,
              className,
              children,
              ...props
            }: {
              href?: string;
              title?: string;
              className?: string;
              children?: React.ReactNode;
            }) {
              const attachmentId = parseSyncedAttachmentHref(href);
              if (attachmentId && syncedAssetContext) {
                const filename =
                  React.Children.toArray(children)
                    .filter(
                      (child): child is string | number =>
                        typeof child === "string" || typeof child === "number"
                    )
                    .join("") || "Attachment";
                return (
                  <SyncedMarkdownAttachment
                    markdownId={syncedAssetContext.markdownId}
                    assetId={attachmentId}
                    filename={filename}
                    size={parseSyncedAttachmentSize(title)}
                    allowDownload={syncedAssetContext.allowDownload}
                    light={light}
                  />
                );
              }

              // Document links (/path.pdf) are intercepted by the container's
              // onClickCapture handler — no special handling needed here.
              // Just render all links normally; external ones open in a new tab.
              return (
                <a
                  href={href}
                  title={title}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "no-underline hover:underline font-medium text-blue-600 dark:text-blue-400",
                    className
                  )}
                  {...props}
                >
                  {children}
                </a>
              );
            },
            blockquote({
              children,
              className,
              ...props
            }: {
              children?: React.ReactNode;
              className?: string;
            }) {
              let alertType: "note" | "tip" | "important" | "warning" | "caution" | null = null;
              let cleanChildren = children;

              const processAlert = (node: any): { type: typeof alertType; cleanNode: any } => {
                if (!node) return { type: null, cleanNode: null };
                
                if (typeof node === "string") {
                  const match = node.trim().match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]/i);
                  if (match) {
                    const type = match[1].toLowerCase() as any;
                    const cleanText = node.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]\s*/i, "");
                    return { type, cleanNode: cleanText };
                  }
                }
                
                if (React.isValidElement(node)) {
                  const element = node as React.ReactElement<any>;
                  if (element.props && element.props.children) {
                    const childrenArray = React.Children.toArray(element.props.children);
                    if (childrenArray.length > 0) {
                      const firstChildResult = processAlert(childrenArray[0]);
                      if (firstChildResult.type) {
                        const newChildren = [
                          firstChildResult.cleanNode,
                          ...childrenArray.slice(1)
                        ].filter(Boolean);
                        
                        return {
                          type: firstChildResult.type,
                          cleanNode: React.cloneElement(element, {
                            ...element.props,
                            children: newChildren.length === 1 ? newChildren[0] : newChildren
                          })
                        };
                      }
                    }
                  }
                }
                
                return { type: null, cleanNode: node };
              };

              const childrenArray = React.Children.toArray(children);
              if (childrenArray.length > 0) {
                const result = processAlert(childrenArray[0]);
                if (result.type) {
                  alertType = result.type;
                  cleanChildren = [result.cleanNode, ...childrenArray.slice(1)].filter(Boolean);
                }
              }

              if (alertType) {
                const config = {
                  note: {
                    border: "border-l-4 border-blue-500",
                    bg: light ? "bg-blue-50/50" : "bg-blue-500/5 dark:bg-blue-500/10",
                    text: light ? "text-blue-800" : "text-blue-700 dark:text-blue-400",
                    title: "Note",
                    icon: (
                      <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )
                  },
                  tip: {
                    border: "border-l-4 border-emerald-500",
                    bg: light ? "bg-emerald-50/50" : "bg-emerald-500/5 dark:bg-emerald-500/10",
                    text: light ? "text-emerald-800" : "text-emerald-700 dark:text-emerald-400",
                    title: "Tip",
                    icon: (
                      <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    )
                  },
                  important: {
                    border: "border-l-4 border-purple-500",
                    bg: light ? "bg-purple-50/50" : "bg-purple-500/5 dark:bg-purple-500/10",
                    text: light ? "text-purple-800" : "text-purple-700 dark:text-purple-400",
                    title: "Important",
                    icon: (
                      <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )
                  },
                  warning: {
                    border: "border-l-4 border-amber-500",
                    bg: light ? "bg-amber-50/50" : "bg-amber-500/5 dark:bg-amber-500/10",
                    text: light ? "text-amber-800" : "text-amber-700 dark:text-amber-400",
                    title: "Warning",
                    icon: (
                      <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )
                  },
                  caution: {
                    border: "border-l-4 border-rose-500",
                    bg: light ? "bg-rose-50/50" : "bg-rose-500/5 dark:bg-rose-500/10",
                    text: light ? "text-rose-800" : "text-rose-700 dark:text-rose-400",
                    title: "Caution",
                    icon: (
                      <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )
                  }
                }[alertType];

                return (
                  <div
                    className={cn(
                      "my-5 p-4 rounded-r-md border-y border-r",
                      light ? "border-zinc-200" : "border-border/40",
                      config.border,
                      config.bg
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center font-semibold mb-2 text-xs uppercase tracking-wider",
                        config.text
                      )}
                    >
                      {config.icon}
                      {config.title}
                    </div>
                    <div
                      className={cn(
                        "text-sm [&>p]:mb-0 [&>p]:leading-relaxed",
                        light ? "text-zinc-800" : "text-foreground/90"
                      )}
                    >
                      {cleanChildren}
                    </div>
                  </div>
                );
              }

              return (
                <blockquote
                  className={cn(
                    "my-4 border-l-4 pl-4 italic p-2 py-1 rounded-r-sm",
                    light
                      ? "text-zinc-600 border-zinc-300 bg-zinc-50"
                      : "text-foreground/80 border-border/80 bg-muted/20",
                    className
                  )}
                  {...props}
                >
                  {children}
                </blockquote>
              );
            },
            ul({
              children,
              className,
              ...props
            }: {
              children?: React.ReactNode;
              className?: string;
            }) {
              const isTaskList = className?.includes("contains-task-list");
              return (
                <ul
                  className={cn(
                    "my-4 pl-6 space-y-1.5",
                    isTaskList ? "list-none pl-4" : "list-disc",
                    light ? "text-zinc-800" : "text-foreground/90",
                    className
                  )}
                  {...props}
                >
                  {children}
                </ul>
              );
            },
            ol({
              children,
              className,
              ...props
            }: {
              children?: React.ReactNode;
              className?: string;
            }) {
              return (
                <ol
                  className={cn(
                    "my-4 pl-6 list-decimal space-y-1.5",
                    light ? "text-zinc-800" : "text-foreground/90",
                    className
                  )}
                  {...props}
                >
                  {children}
                </ol>
              );
            },
            li({ children, className, ...props }) {
              return (
                <li
                  className={cn(
                    light ? "text-zinc-800" : "text-foreground/90",
                    className
                  )}
                  {...props}
                >
                  {children}
                </li>
              );
            },
            input({ checked, type, className, ...props }) {
              if (type === "checkbox") {
                return (
                  <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0 rounded align-middle focus:ring-0 focus:ring-offset-0 disabled:opacity-80",
                      light
                        ? "border-zinc-300 bg-white text-primary"
                        : "border-border bg-background text-primary",
                      className
                    )}
                    {...props}
                  />
                );
              }
              return <input type={type} className={className} {...props} />;
            },
            table({ children, className, ...props }) {
              return (
                <div
                  className={cn(
                    "my-5 overflow-x-auto rounded-lg border shadow-sm",
                    light ? "border-zinc-200 bg-white" : "border-border/60 bg-surface"
                  )}
                >
                  <table
                    className={cn(
                      "w-full border-collapse text-left text-sm",
                      light ? "text-zinc-800" : "text-foreground",
                      className
                    )}
                    {...props}
                  >
                    {children}
                  </table>
                </div>
              );
            },
            thead({ children, className, ...props }) {
              return (
                <thead
                  className={cn(
                    "border-b",
                    light ? "bg-zinc-50 border-zinc-200" : "bg-muted/30 border-border/80",
                    className
                  )}
                  {...props}
                >
                  {children}
                </thead>
              );
            },
            tbody({ children, className, ...props }) {
              return (
                <tbody
                  className={cn(
                    "divide-y",
                    light
                      ? "divide-zinc-200 [&>tr:nth-child(even)]:bg-zinc-50/50"
                      : "divide-border/40 [&>tr:nth-child(even)]:bg-muted/10",
                    className
                  )}
                  {...props}
                >
                  {children}
                </tbody>
              );
            },
            tr({ children, className, ...props }) {
              return (
                <tr
                  className={cn(
                    "transition-colors",
                    light ? "hover:bg-zinc-50" : "hover:bg-muted/5",
                    className
                  )}
                  {...props}
                >
                  {children}
                </tr>
              );
            },
            th({ children, className, ...props }) {
              return (
                <th
                  className={cn(
                    "px-4 py-3 font-semibold border-r last:border-r-0",
                    light
                      ? "text-zinc-900 border-zinc-200"
                      : "text-foreground border-border/40",
                    className
                  )}
                  {...props}
                >
                  {children}
                </th>
              );
            },
            td({ children, className, ...props }) {
              return (
                <td
                  className={cn(
                    "px-4 py-2.5 border-r last:border-r-0",
                    light
                      ? "text-zinc-800 border-zinc-200"
                      : "text-foreground/90 border-border/40",
                    className
                  )}
                  {...props}
                >
                  {children}
                </td>
              );
            },
            hr() {
              return (
                <hr
                  className={cn(
                    "my-6 border-t-2 w-full",
                    light ? "border-black" : "border-black dark:border-zinc-700"
                  )}
                />
              );
            },
          }}
        >
          {preprocessMarkdown(content)}
        </ReactMarkdown>
      </div>
    );
  }
);

MarkdownContent.displayName = "MarkdownContent";
