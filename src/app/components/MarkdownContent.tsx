"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
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

interface MarkdownContentProps {
  content: string;
  className?: string;
  light?: boolean;
}

export const MarkdownContent = React.memo<MarkdownContentProps>(
  ({ content, className = "", light = false }) => {
    return (
      <div
        className={cn(
          "prose min-w-0 max-w-full overflow-hidden break-words text-sm leading-relaxed",
          light
            ? "text-zinc-800 [&_h1:first-child]:mt-0 [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:font-semibold [&_h1]:text-zinc-950 [&_h2:first-child]:mt-0 [&_h2]:mb-4 [&_h2]:mt-6 [&_h2]:font-semibold [&_h2]:text-zinc-900 [&_h3:first-child]:mt-0 [&_h3]:mb-4 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-zinc-850 [&_h4:first-child]:mt-0 [&_h4]:mb-4 [&_h4]:mt-6 [&_h4]:font-semibold [&_h4]:text-zinc-800 [&_h5:first-child]:mt-0 [&_h5]:mb-4 [&_h5]:mt-6 [&_h5]:font-semibold [&_h5]:text-zinc-800 [&_h6:first-child]:mt-0 [&_h6]:mb-4 [&_h6]:mt-6 [&_h6]:font-semibold [&_h6]:text-zinc-800 [&_p:last-child]:mb-0 [&_p]:mb-4 [&_code]:before:content-none [&_code]:after:content-none [&_code]:bg-zinc-100 [&_code]:text-purple-600 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:border [&_code]:border-zinc-200 [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:font-normal"
            : "dark:prose-invert text-inherit [&_h1:first-child]:mt-0 [&_h1]:mb-4 [&_h1]:mt-6 [&_h1]:font-semibold [&_h1]:text-white [&_h2:first-child]:mt-0 [&_h2]:mb-4 [&_h2]:mt-6 [&_h2]:font-semibold [&_h2]:text-white [&_h3:first-child]:mt-0 [&_h3]:mb-4 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-white [&_h4:first-child]:mt-0 [&_h4]:mb-4 [&_h4]:mt-6 [&_h4]:font-semibold [&_h4]:text-white [&_h5:first-child]:mt-0 [&_h5]:mb-4 [&_h5]:mt-6 [&_h5]:font-semibold [&_h5]:text-white [&_h6:first-child]:mt-0 [&_h6]:mb-4 [&_h6]:mt-6 [&_h6]:font-semibold [&_h6]:text-white [&_p:last-child]:mb-0 [&_p]:mb-4 [&_code]:before:content-none [&_code]:after:content-none [&_code]:bg-white/10 [&_code]:text-indigo-300 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:border [&_code]:border-white/5 [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:font-normal",
          className
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({
              className,
              children,
              ...props
            }: {
              className?: string;
              children?: React.ReactNode;
            }) {
              return (
                <code
                  className={cn(
                    "rounded-md px-1.5 py-0.5 font-mono text-[0.9em] font-normal before:content-none after:content-none",
                    light
                      ? "bg-zinc-100 text-purple-600 border border-zinc-200"
                      : "bg-white/10 text-indigo-300 border border-white/5"
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
              children,
            }: {
              href?: string;
              children?: React.ReactNode;
            }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("no-underline hover:underline", light ? "text-blue-600" : "text-primary")}
                >
                  {children}
                </a>
              );
            },
            blockquote({ children }: { children?: React.ReactNode }) {
              return (
                <blockquote className={cn("my-4 border-l-4 pl-4 italic", light ? "text-zinc-500 border-zinc-300" : "text-primary/50 border-border")}>
                  {children}
                </blockquote>
              );
            },
            ul({ children }: { children?: React.ReactNode }) {
              return (
                <ul className={cn("my-4 pl-6 [&>li:last-child]:mb-0 [&>li]:mb-1", light ? "text-zinc-700 list-disc" : "")}>
                  {children}
                </ul>
              );
            },
            ol({ children }: { children?: React.ReactNode }) {
              return (
                <ol className={cn("my-4 pl-6 [&>li:last-child]:mb-0 [&>li]:mb-1", light ? "text-zinc-700 list-decimal" : "")}>
                  {children}
                </ol>
              );
            },
            table({ children }: { children?: React.ReactNode }) {
              return (
                <div className="my-4 overflow-x-auto">
                  <table className={cn(
                    "w-full border-collapse [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold",
                    light
                      ? "[&_th]:bg-zinc-100 [&_td]:border-zinc-200 [&_th]:border-zinc-200 [&_th]:text-zinc-950 text-zinc-800"
                      : "[&_th]:bg-surface [&_td]:border-border [&_th]:border-border"
                  )}>
                    {children}
                  </table>
                </div>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }
);

MarkdownContent.displayName = "MarkdownContent";
