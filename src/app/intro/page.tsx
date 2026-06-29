"use client";

import NextImage from "next/image";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const dynamic = "force-dynamic";
import { useSearchParams } from "next/navigation";
import {
  Shield,
  Activity,
  Terminal,
  Search,
  ChevronRight,
  Zap,
  Play,
  CheckCircle,
  FileText,
  FolderTree,
  Lock,
  ArrowUpRight,
  MessageSquare,
  Trash2,
  ClipboardPaste,
  Copy,
  Check,
  LogOut,
} from "lucide-react";

function IntroPageContent() {
  const searchParams = useSearchParams();
  const [threadId, setThreadId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<number>(0);
  const [scrollY, setScrollY] = useState(0);
  const [visibleSections, setVisibleSections] = useState<
    Record<string, boolean>
  >({
    hero: true,
    chip: true,
    tandem: true,
    sandbox: true,
    accessories: true,
    specs: true,
    cta: true,
  });

  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<
    "connected" | "disconnected" | "connecting" | "fallback"
  >("disconnected");
  const [sharedText, setSharedText] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [isTelemetryFullscreen, setIsTelemetryFullscreen] =
    useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedHtml, setCopiedHtml] = useState<boolean>(false);
  const [activeTelemetryTab, setActiveTelemetryTab] = useState<string>("edit");
  const [selectedLayer, setSelectedLayer] = useState<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Function to clear session cookies
  const handleClearCookies = () => {
    // Clear session_token cookie
    document.cookie =
      "session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";

    // Also clear localStorage items
    localStorage.removeItem("last_thread_id");
    localStorage.removeItem("last_used_provider");

    // Clear all markdown thread data
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("markdown_thread_")) {
        localStorage.removeItem(key);
      }
    });

    toast.success("Session cookies cleared. Please refresh the page.");
  };

  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const hasFallenBackRef = useRef<boolean>(false);
  const pollingIntervalRef = useRef<number | null>(null);
  const sharedTextRef = useRef<string>("");
  const lastPollPushedRef = useRef<string | null>(null);

  // Keep sharedTextRef in sync for the polling interval callback
  useEffect(() => {
    sharedTextRef.current = sharedText;
  }, [sharedText]);

  // Prevent background body scroll when the telemetry dialog is open
  useEffect(() => {
    if (isDialogOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setIsTelemetryFullscreen(false);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isDialogOpen]);

  // Load initial content from localStorage once threadId resolves
  useEffect(() => {
    if (threadId) {
      hasFallenBackRef.current = false;
      const cached = localStorage.getItem(`markdown_thread_${threadId}`);
      if (cached) {
        setSharedText(cached);
      }
    }
  }, [threadId]);

  const startFallbackSSE = useCallback(() => {
    if (!threadId) return;
    if (eventSourceRef.current) return;

    hasFallenBackRef.current = true;
    setWsStatus("fallback");
    console.log(
      "Initiating HTTP streaming (SSE) fallback for thread:",
      threadId
    );

    const eventSource = new EventSource(
      `/api/ws-fallback?threadId=${threadId}`
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("sync", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "sync") {
          setSharedText(data.content);
          if (data.content) {
            localStorage.setItem(`markdown_thread_${threadId}`, data.content);
          } else {
            localStorage.removeItem(`markdown_thread_${threadId}`);
          }
        }
      } catch (err) {
        console.error("SSE error parsing message:", err);
      }
    });

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        // Fatal: server returned non-200, or close() was called explicitly
        console.error(
          "[SSE Fallback] Connection permanently closed. Will not auto-reconnect."
        );
        hasFallenBackRef.current = false; // Allow future WS reconnection attempts
        eventSourceRef.current = null;
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        // Expected: EventSource is auto-reconnecting after a timeout or transient failure
        console.log("[SSE Fallback] Reconnecting to SSE stream...");
        setWsStatus("fallback");
      }
    };

    // ── Cross-instance polling fallback ──────────────────────────────
    // On serverless platforms (Vercel) different function instances don't
    // share memory, so real-time SSE push may not reach all subscribers.
    // This polling loop exchanges content via the ?poll=1&push=… endpoint
    // every few seconds, providing eventual-consistency catch-up.
    //
    // To avoid ping-pong overwrites, we only push when the local content
    // has changed since the last push, and we track the last received
    // remote content so we don't push it back.
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    lastPollPushedRef.current = null;
    pollingIntervalRef.current = window.setInterval(async () => {
      try {
        const currentContent = sharedTextRef.current;
        const hasChanged = currentContent !== lastPollPushedRef.current;
        const encoded = encodeURIComponent(currentContent);
        const pushParam = hasChanged ? `&push=${encoded}` : "";
        const res = await fetch(
          `/api/ws-fallback?threadId=${threadId}&poll=1${pushParam}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.type === "sync") {
          if (hasChanged) {
            lastPollPushedRef.current = currentContent;
          }
          const remoteContent: string = data.content ?? "";
          if (remoteContent && remoteContent !== currentContent) {
            console.log("[SSE Poll] Received remote content update");
            sharedTextRef.current = remoteContent;
            lastPollPushedRef.current = remoteContent;
            setSharedText(remoteContent);
            localStorage.setItem(
              `markdown_thread_${threadId}`,
              remoteContent
            );
          }
        }
      } catch {
        // Silently ignore transient poll failures
      }
    }, 3000);
  }, [threadId]);

  const sendFallbackUpdate = useCallback(
    async (val: string, immediate = false) => {
      try {
        await fetch("/api/ws-fallback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            threadId,
            type: "update",
            content: val,
            immediate,
          }),
        });
      } catch (err) {
        console.error("Failed to send content update via HTTP fallback:", err);
      }
    },
    [threadId]
  );

  const connectWS = useCallback(() => {
    if (!threadId) return;

    // If we have already fallen back to HTTP, do not attempt WS reconnection
    if (hasFallenBackRef.current) {
      return;
    }

    // If socket is already open or currently connecting, skip
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close any active fallback EventSource before attempting WS
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setWsStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws?threadId=${threadId}`;

    console.log("Attempting WebSocket connection for thread:", threadId);
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
    } catch (e) {
      console.error(
        "WebSocket constructor failed, falling back to HTTP stream:",
        e
      );
      startFallbackSSE();
      return;
    }

    ws.onopen = () => {
      console.log("WebSocket connected for thread:", threadId);
      setSocket(ws);
      setWsStatus("connected");

      // Retrieve local offline content from localStorage and initialize sync on the server
      const localContent =
        localStorage.getItem(`markdown_thread_${threadId}`) || "";
      ws?.send(JSON.stringify({ type: "init", content: localContent }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "sync") {
          setSharedText(data.content);
          if (data.content) {
            localStorage.setItem(`markdown_thread_${threadId}`, data.content);
          } else {
            localStorage.removeItem(`markdown_thread_${threadId}`);
          }
        }
      } catch (err) {
        console.error("WS error parsing message:", err);
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      setSocket(null);
      wsRef.current = null;

      // If we have already triggered fallback, ignore this close event
      if (hasFallenBackRef.current) {
        return;
      }

      // Automatically fallback if closing while still in connecting state
      // Otherwise schedule standard reconnection
      console.log(
        "WebSocket connection failed or closed, falling back to HTTP stream..."
      );
      startFallbackSSE();
    };

    ws.onerror = (error) => {
      console.error("WebSocket error, falling back to HTTP stream:", error);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setSocket(null);
      startFallbackSSE();
    };
  }, [threadId, startFallbackSSE]);

  // Main connection management effect
  useEffect(() => {
    connectWS();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      setSocket(null);
      setWsStatus("disconnected");
    };
  }, [threadId, connectWS]);

  // Trigger immediate reconnect when the telemetry dialog is opened if it's currently disconnected
  useEffect(() => {
    if (isDialogOpen && wsStatus === "disconnected") {
      console.log(
        "Telemetry dialog opened while disconnected. Triggering instant reconnect..."
      );
      connectWS();
    }
  }, [isDialogOpen, wsStatus, connectWS]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setSharedText(val);
    if (val) {
      localStorage.setItem(`markdown_thread_${threadId}`, val);
    } else {
      localStorage.removeItem(`markdown_thread_${threadId}`);
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "update", content: val }));
    } else if (wsStatus === "fallback") {
      sendFallbackUpdate(val);
    }
  };

  const handleRemove = () => {
    setSharedText("");
    localStorage.removeItem(`markdown_thread_${threadId}`);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "update", content: "" }));
    } else if (wsStatus === "fallback") {
      sendFallbackUpdate("");
    }
    toast.success("Content removed from local and server storage.");
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setSharedText(text);
      if (text) {
        localStorage.setItem(`markdown_thread_${threadId}`, text);
        // Save to server immediately if content is not empty
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({ type: "update", content: text, immediate: true })
          );
        } else if (wsStatus === "fallback") {
          sendFallbackUpdate(text, true);
        }
      } else {
        localStorage.removeItem(`markdown_thread_${threadId}`);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "update", content: "" }));
        } else if (wsStatus === "fallback") {
          sendFallbackUpdate("");
        }
      }
    } catch (err) {
      console.error("Failed to read from clipboard:", err);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sharedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  const handleCopyHtml = async () => {
    try {
      if (previewRef.current) {
        const rawHtml = previewRef.current.innerHTML;

        // Create a temporary element to inline styles
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = rawHtml;

        // Convert SVG to PNG helper to ensure Microsoft Word handles it as a standard static image
        const svgToPng = (
          svgElement: SVGSVGElement
        ): Promise<{
          pngDataUrl: string;
          width: number;
          height: number;
        } | null> => {
          return new Promise((resolve) => {
            try {
              const rect = svgElement.getBoundingClientRect();
              let width = rect.width || svgElement.clientWidth;
              let height = rect.height || svgElement.clientHeight;

              if (!width || !height) {
                const viewBox = svgElement.getAttribute("viewBox");
                if (viewBox) {
                  const parts = viewBox.split(" ").map(Number);
                  if (parts.length === 4) {
                    width = parts[2];
                    height = parts[3];
                  }
                }
              }

              if (!width) width = 800;
              if (!height) height = 600;

              const svgString = new XMLSerializer().serializeToString(
                svgElement
              );

              // Safe base64 encoding for UTF-8 SVG string
              const utf8Bytes = new TextEncoder().encode(svgString);
              let binary = "";
              for (let idx = 0; idx < utf8Bytes.length; idx++) {
                binary += String.fromCharCode(utf8Bytes[idx]);
              }
              const base64Data = window.btoa(binary);
              const dataUrl = `data:image/svg+xml;base64,${base64Data}`;

              const img = new Image();
              img.onload = () => {
                try {
                  const canvas = document.createElement("canvas");
                  const scale = 2; // Render at 2x scale for Retina/HD quality
                  canvas.width = width * scale;
                  canvas.height = height * scale;

                  const ctx = canvas.getContext("2d");
                  if (ctx) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = "high";

                    // Draw a dark background matching the container (#18181b)
                    ctx.fillStyle = "#18181b";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);

                    // Draw the SVG image scaled
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    const pngDataUrl = canvas.toDataURL("image/png");
                    resolve({ pngDataUrl, width, height });
                  } else {
                    resolve(null);
                  }
                } catch (e) {
                  console.error("Canvas draw error:", e);
                  resolve(null);
                }
              };

              img.onerror = (e: Event | string) => {
                console.error("Image load error:", e);
                resolve(null);
              };

              img.src = dataUrl;
            } catch (err) {
              console.error("SVG to PNG conversion error:", err);
              resolve(null);
            }
          });
        };

        // Convert all rendered SVGs inside tempDiv to static PNGs for Word clipboard compatibility
        const liveContainers = previewRef.current.querySelectorAll(
          ".mermaid-svg-container"
        );
        const tempContainers = tempDiv.querySelectorAll(
          ".mermaid-svg-container"
        );

        for (let i = 0; i < liveContainers.length; i++) {
          const liveContainer = liveContainers[i];
          const tempContainer = tempContainers[i];
          if (!liveContainer || !tempContainer) continue;

          const svgEl = liveContainer.querySelector("svg");
          if (svgEl) {
            const result = await svgToPng(svgEl as SVGSVGElement);
            if (result && result.pngDataUrl) {
              // Store the image on the local dev server so that Word can retrieve it over HTTP
              try {
                const response = await fetch("/api/store-mermaid-image", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ image: result.pngDataUrl }),
                });
                const storeResult = await response.json();
                if (storeResult && storeResult.success && storeResult.id) {
                  // Get current origin (e.g., http://localhost:3000)
                  const origin = window.location.origin;
                  const imageUrl = `${origin}/api/mermaid-image/${storeResult.id}.png`;
                  tempContainer.innerHTML = `<img src="${imageUrl}" width="${result.width}" height="${result.height}" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border-radius: 8px;" />`;
                } else {
                  // Fallback to local Data URI if server endpoint fails
                  tempContainer.innerHTML = `<img src="${result.pngDataUrl}" width="${result.width}" height="${result.height}" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border-radius: 8px;" />`;
                }
              } catch (e) {
                console.error("Failed to store image on dev server:", e);
                // Fallback to local Data URI if upload fails
                tempContainer.innerHTML = `<img src="${result.pngDataUrl}" width="${result.width}" height="${result.height}" style="display: block; margin: 0 auto; max-width: 100%; height: auto; border-radius: 8px;" />`;
              }
            }
          }
        }

        // Inline CSS styling rules for Markdown components to preserve formatting when pasted (light theme: white background, black text)
        const h1s = tempDiv.querySelectorAll("h1");
        h1s.forEach((el) =>
          el.setAttribute(
            "style",
            "color: #09090b; font-size: 1.8em; font-weight: 700; margin-top: 24px; margin-bottom: 16px; border-bottom: 1px solid #e4e4e7; padding-bottom: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const h2s = tempDiv.querySelectorAll("h2");
        h2s.forEach((el) =>
          el.setAttribute(
            "style",
            "color: #18181b; font-size: 1.5em; font-weight: 600; margin-top: 20px; margin-bottom: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const h3s = tempDiv.querySelectorAll("h3");
        h3s.forEach((el) =>
          el.setAttribute(
            "style",
            "color: #27272a; font-size: 1.25em; font-weight: 600; margin-top: 16px; margin-bottom: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const paragraphs = tempDiv.querySelectorAll("p");
        paragraphs.forEach((el) =>
          el.setAttribute(
            "style",
            "color: #3f3f46; font-size: 14px; line-height: 1.6; margin-top: 0; margin-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const links = tempDiv.querySelectorAll("a");
        links.forEach((el) =>
          el.setAttribute(
            "style",
            "color: #2563eb; text-decoration: underline; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const blockquotes = tempDiv.querySelectorAll("blockquote");
        blockquotes.forEach((el) =>
          el.setAttribute(
            "style",
            "color: #71717a; border-left: 4px solid #d4d4d8; background-color: #fafafa; padding: 8px 16px; margin: 16px 0; font-style: italic; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const inlineCodes = tempDiv.querySelectorAll("code");
        inlineCodes.forEach((el) => {
          const isCodeBlock =
            el.parentElement &&
            el.parentElement.tagName.toLowerCase() === "div";
          if (isCodeBlock) {
            // Style the parent div of the code block to have a dark background (so syntax highlighting remains readable)
            el.parentElement.setAttribute(
              "style",
              "background-color: #282c34; border: 1px solid rgba(0, 0, 0, 0.15); border-radius: 8px; padding: 16px; margin: 16px 0; overflow-x: auto; font-family: monospace; font-size: 14px; color: #abb2bf; line-height: 1.5; text-align: left;"
            );
            el.setAttribute(
              "style",
              "background: transparent; color: inherit; border: none; padding: 0; font-family: monospace; font-size: inherit;"
            );
          } else {
            // Style inline code with light theme
            el.setAttribute(
              "style",
              "background-color: #f4f4f5; color: #b700b7; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em; border: 1px solid #e4e4e7;"
            );
          }
        });

        // Inline CSS styling for Mermaid diagrams when pasted
        const mermaidContainers = tempDiv.querySelectorAll(
          ".mermaid-svg-container"
        );
        mermaidContainers.forEach((el) => {
          el.setAttribute(
            "style",
            "display: block; padding: 24px; background-color: #18181b; border-radius: 12px; border: 1px solid #27272a; margin: 16px 0; overflow-x: auto;"
          );
          const svgEl = el.querySelector("svg");
          if (svgEl) {
            svgEl.setAttribute(
              "style",
              "max-width: none; height: auto; display: block; margin: 0 auto;"
            );
          }
        });

        const uls = tempDiv.querySelectorAll("ul");
        uls.forEach((el) =>
          el.setAttribute(
            "style",
            "margin: 16px 0; padding-left: 24px; list-style-type: disc; color: #3f3f46; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const ols = tempDiv.querySelectorAll("ol");
        ols.forEach((el) =>
          el.setAttribute(
            "style",
            "margin: 16px 0; padding-left: 24px; list-style-type: decimal; color: #3f3f46; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const lis = tempDiv.querySelectorAll("li");
        lis.forEach((el) =>
          el.setAttribute(
            "style",
            "margin-bottom: 6px; font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const tables = tempDiv.querySelectorAll("table");
        tables.forEach((el) =>
          el.setAttribute(
            "style",
            "width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e4e4e7; color: #3f3f46; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
          )
        );

        const ths = tempDiv.querySelectorAll("th");
        ths.forEach((el) =>
          el.setAttribute(
            "style",
            "border: 1px solid #e4e4e7; padding: 8px 12px; font-weight: 600; text-align: left; background-color: #f4f4f5; color: #09090b;"
          )
        );

        const tds = tempDiv.querySelectorAll("td");
        tds.forEach((el) =>
          el.setAttribute(
            "style",
            "border: 1px solid #e4e4e7; padding: 8px 12px;"
          )
        );

        const contentHtml = tempDiv.innerHTML;

        // Wrap/cover the HTML inside a clean white block container
        const blockHtml = `
<div style="background-color: #ffffff; color: #18181b; padding: 24px; border: 1px solid #e4e4e7; border-radius: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 100%; box-sizing: border-box; margin: 16px 0;">
  ${contentHtml}
</div>
        `.trim();

        // Write to clipboard as formatted text/html and fallback text/plain
        if (
          typeof window !== "undefined" &&
          window.ClipboardItem &&
          navigator.clipboard
        ) {
          const htmlBlob = new Blob([blockHtml], { type: "text/html" });
          const textBlob = new Blob([blockHtml], { type: "text/plain" });

          await navigator.clipboard.write([
            new window.ClipboardItem({
              "text/html": htmlBlob,
              "text/plain": textBlob,
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(blockHtml);
        }

        setCopiedHtml(true);
        setTimeout(() => setCopiedHtml(false), 2000);
        toast.success("HTML rendering result copied as styled block!");
      }
    } catch (err) {
      console.error("Failed to copy HTML to clipboard:", err);
      toast.error("Failed to copy HTML to clipboard.");
    }
  };

  // Ref elements for interactive 3D mouse parallax
  const stackRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // Generate 6-digit Thread ID if not present in query params
  useEffect(() => {
    const tid = searchParams.get("thread_id");
    if (tid && /^\d{6}$/.test(tid)) {
      setThreadId(tid);
    } else {
      // Check localStorage for existing thread ID first
      const savedThreadId = localStorage.getItem("last_thread_id");
      const generatedId =
        savedThreadId && /^\d{6}$/.test(savedThreadId)
          ? savedThreadId
          : String(Math.floor(100000 + Math.random() * 900000));

      setThreadId(generatedId);

      // Save to localStorage for persistence across refreshes
      localStorage.setItem("last_thread_id", generatedId);

      // Update URL search parameters without reloading
      const url = new URL(window.location.href);
      url.searchParams.set("thread_id", generatedId);
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  // Track scroll state for animations
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Intersection observer for Apple-style fade-in-on-scroll
  useEffect(() => {
    // Run observer binding in a short timeout to guarantee Next.js DOM has settled
    const timer = setTimeout(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              setVisibleSections((prev) => ({
                ...prev,
                [entry.target.id]: true,
              }));
            }
          });
        },
        { threshold: 0.15 }
      );

      const sectionIds = [
        "hero",
        "chip",
        "tandem",
        "sandbox",
        "accessories",
        "specs",
        "cta",
      ];
      sectionIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
          observer.observe(el);

          // Viewport boundary check: if it is already in view on load, show immediately
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            setVisibleSections((prev) => ({ ...prev, [id]: true }));
          }
        }
      });

      return () => observer.disconnect();
    }, 150);

    return () => clearTimeout(timer);
  }, []);

  // Handle mouse move for interactive card 3D tilt
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!stackRef.current) return;
    const rect = stackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    // Normalize and scale tilt factors
    const tiltX = (y / (rect.height / 2)) * -12; // tilt angle degrees
    const tiltY = (x / (rect.width / 2)) * 12;
    setTilt({ x: tiltX, y: tiltY });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#000000] font-sans text-[#f5f5f7]">
      {/* Styles for scroll effects, custom gradients, and 3D card perspectives */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #000;
        }

        .font-outfit {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        
        .font-mono {
          font-family: 'JetBrains Mono', monospace;
        }

        /* Apple-style smooth scroll transitions */
        .apple-fade {
          opacity: 0;
          transform: translateY(40px);
          transition: opacity 1.2s cubic-bezier(0.15, 1, 0.3, 1), 
                      transform 1.2s cubic-bezier(0.15, 1, 0.3, 1);
        }

        .apple-fade.visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* Custom Telemetry Tooltips */
        .tooltip-wrapper {
          position: relative;
          display: inline-block;
        }
        .tooltip-box {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%) translateY(4px);
          margin-bottom: 8px;
          visibility: hidden;
          opacity: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
          z-index: 9999;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .tooltip-wrapper:hover .tooltip-box {
          visibility: visible;
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        .tooltip-box-bottom {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%) translateY(-4px);
          margin-top: 8px;
          visibility: hidden;
          opacity: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          pointer-events: none;
          z-index: 9999;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .tooltip-wrapper:hover .tooltip-box-bottom {
          visibility: visible;
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        .tooltip-box-bottom.tooltip-align-right {
          left: auto;
          right: 0;
          transform: translateX(0) translateY(-4px);
          align-items: flex-end;
        }
        .tooltip-wrapper:hover .tooltip-box-bottom.tooltip-align-right {
          transform: translateX(0) translateY(0);
        }
        .tooltip-box-bottom.tooltip-align-right .tooltip-arrow {
          margin-right: 12px;
        }

        .intro-device {
          box-shadow:
            0 34px 90px rgba(0, 0, 0, 0.5),
            inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        }

        .hero-screen {
          background:
            linear-gradient(145deg, rgba(17, 85, 204, 0.35), transparent 42%),
            linear-gradient(315deg, rgba(45, 212, 191, 0.2), transparent 42%),
            #050608;
        }
      `,
        }}
      />

      {/* Navigation - Apple Header Style */}
      <header
        className={`fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b px-6 transition-all duration-300 ${
          scrollY > 50
            ? "border-white/10 bg-black/85 backdrop-blur-md"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="flex items-center gap-6">
          <a
            href="#"
            className="flex items-center gap-2 text-white transition hover:opacity-85"
          >
            <NextImage
              src="/deep-agent-logo.svg"
              alt="Deep Agent"
              width={24}
              height={24}
              className="rounded-full"
              priority
            />
            <span className="font-outfit text-sm font-semibold uppercase tracking-tight">
              Deep Agent
            </span>
          </a>
          <span className="hidden h-4 w-px bg-white/20 sm:block" />
          <span className="font-outfit hidden text-xs uppercase tracking-wider text-white/50 sm:block">
            Introduction
          </span>
        </div>

        <nav className="hidden items-center gap-8 text-xs font-normal text-[#e8e8ed] md:flex">
          <a
            href="#hero"
            className="transition hover:text-white"
          >
            Overview
          </a>
          <a
            href="#chip"
            className="transition hover:text-white"
          >
            Highlights
          </a>
          <a
            href="#tandem"
            className="transition hover:text-white"
          >
            Performance
          </a>
          <a
            href="#sandbox"
            className="transition hover:text-white"
          >
            Isolation
          </a>
          <a
            href="#specs"
            className="transition hover:text-white"
          >
            Tech Specs
          </a>
        </nav>

        <div className="flex items-center gap-4">
          {/* Clear Cookies Button */}
          <div className="tooltip-wrapper">
            <button
              onClick={handleClearCookies}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-white/70 shadow-md transition hover:bg-zinc-700 hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
            <div className="tooltip-box-bottom">
              <div className="z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-white/10 bg-zinc-900" />
              <div className="whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-white shadow-xl">
                CLEAR SESSION COOKIES
              </div>
            </div>
          </div>

          <div className="flex select-none items-center gap-0.5 font-mono text-xs text-white/40">
            <div className="tooltip-wrapper">
              <span
                onClick={() => setIsDialogOpen(true)}
                className="cursor-pointer underline decoration-white/30 decoration-dotted underline-offset-2 transition hover:text-white"
              >
                Thread
              </span>
              <div className="tooltip-box-bottom">
                <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-white/10 bg-zinc-900" />
                <div className="whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-white shadow-xl">
                  MARKDOWN ONLINE PREVIEW
                </div>
              </div>
            </div>
            : #{threadId}
          </div>
          <div className="tooltip-wrapper">
            <a
              href={`/chat?threadId=${threadId}`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0071e3] text-white shadow-md shadow-blue-500/20 transition hover:bg-[#147fe5]"
            >
              <MessageSquare className="h-4 w-4" />
            </a>
            <div className="tooltip-box-bottom">
              <div className="z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-white/10 bg-zinc-900" />
              <div className="whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-white shadow-xl">
                LAUNCH CHAT
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 1. HERO SECTION (Apple "Thinpossible" style) */}
      <section
        id="hero"
        className="relative flex min-h-screen flex-col items-center justify-center px-6 pb-10 pt-28 text-center"
      >
        <div
          className={`apple-fade w-full max-w-6xl ${
            visibleSections["hero"] ? "visible" : ""
          }`}
        >
          <h1 className="font-outfit text-5xl font-semibold leading-none text-white sm:text-7xl md:text-8xl">
            Harness Engineering
          </h1>

          <p className="font-outfit mt-5 text-3xl font-semibold leading-tight text-[#f5f5f7] sm:text-5xl md:text-6xl">
            A production harness for AI work.
          </p>

          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-[#a1a1a6] sm:text-xl">
            Applying Sutton's <em>Bitter Lesson</em> to agent architecture.
            While core model prompts represent probabilistic suggestions, the
            harness establishes the deterministic governance plane.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={`/chat?threadId=${threadId}`}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#0071e3] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#147fe5]"
            >
              Launch Deep Agent
              <MessageSquare className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-14 flex justify-center">
            <div
              ref={stackRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              className="relative w-full max-w-5xl cursor-pointer px-2 py-6"
              style={{ perspective: "1000px" }}
            >
              <div
                className="intro-device relative overflow-hidden rounded-[2rem] border border-white/15 bg-[#101014] p-2 transition-all duration-300 ease-out sm:rounded-[2.5rem] sm:p-3"
                style={{
                  transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                  transformStyle: "preserve-3d",
                }}
              >
                <div className="hero-screen min-h-[440px] overflow-hidden rounded-[1.55rem] border border-white/10 p-4 text-left sm:min-h-[560px] sm:rounded-[2rem] sm:p-6">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div className="flex items-center gap-3">
                      <NextImage
                        src="/deep-agent-logo.svg"
                        alt="Deep Agent"
                        width={34}
                        height={34}
                        className="rounded-full"
                      />
                      <div>
                        <div className="text-sm font-semibold text-white">
                          Agent workspace
                        </div>
                        <div className="font-mono text-[10px] uppercase text-white/45">
                          Thread #{threadId || "000000"}
                        </div>
                      </div>
                    </div>
                    <div className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 font-mono text-[10px] uppercase text-emerald-300 sm:flex">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      Harness online
                    </div>
                  </div>

                  <div className="grid gap-4 pt-5 lg:grid-cols-[1.25fr_0.75fr]">
                    <div className="rounded-2xl border border-white/10 bg-black/35 p-5 sm:p-7">
                      <div className="mb-10 flex items-start justify-between gap-6">
                        <div>
                          <p className="font-mono text-xs uppercase text-[#6bd1ff]">
                            Plan - Act - Verify
                          </p>
                          <h2 className="mt-3 text-3xl font-semibold leading-tight text-white sm:text-5xl">
                            Structure around the model.
                          </h2>
                        </div>
                        <div className="hidden rounded-full bg-white px-3 py-1 text-xs font-semibold text-black sm:block">
                          HE-1
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {[
                          [
                            "01",
                            "Plan",
                            "Breaks work into explicit checkpoints.",
                          ],
                          [
                            "02",
                            "Execute",
                            "Runs tools inside bounded workflows.",
                          ],
                          ["03", "Verify", "Checks output before handoff."],
                        ].map(([step, title, copy]) => (
                          <button
                            key={step}
                            onClick={() => setSelectedLayer(Number(step))}
                            className={`rounded-2xl border p-4 text-left transition ${
                              selectedLayer === Number(step)
                                ? "border-white/50 bg-white text-black"
                                : "border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                            }`}
                          >
                            <div className="font-mono text-[10px] uppercase opacity-60">
                              {step}
                            </div>
                            <div className="mt-5 text-lg font-semibold">
                              {title}
                            </div>
                            <p className="mt-2 text-xs leading-relaxed opacity-70">
                              {copy}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-center gap-3 text-white">
                          <Shield className="h-5 w-5 text-[#7ee7d3]" />
                          <h3 className="font-semibold">Isolation layer</h3>
                        </div>
                        <p className="mt-4 text-sm leading-relaxed text-[#a1a1a6]">
                          Tool calls, files, approvals, and budgets are kept in
                          controlled lanes so autonomous work stays observable.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <div className="flex items-center gap-3 text-white">
                          <FileText className="h-5 w-5 text-[#6bd1ff]" />
                          <h3 className="font-semibold">Durable context</h3>
                        </div>
                        <p className="mt-4 text-sm leading-relaxed text-[#a1a1a6]">
                          Work survives beyond a prompt through files,
                          checkpoints, and reviewable artifacts.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. THE CHIP SECTION (Apple's M4 Chip style) */}
      <section
        id="chip"
        className="relative flex min-h-screen flex-col items-center justify-center bg-[#f5f5f7] px-6 py-24 text-[#1d1d1f]"
      >
        <div
          className={`apple-fade w-full max-w-6xl ${
            visibleSections["chip"] ? "visible" : ""
          }`}
        >
          <div className="mb-12 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-4xl font-semibold leading-tight sm:text-6xl">
                Get the highlights.
              </h2>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[#6e6e73]">
                Deep Agent wraps model intelligence in durable planning, scoped
                tools, and verification steps that make complex work
                inspectable.
              </p>
            </div>
            <a
              href="#specs"
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#0066cc] hover:opacity-80"
            >
              See tech specs
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-h-[360px] rounded-[28px] bg-white p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eaf4ff] text-[#0071e3]">
                <Zap className="h-6 w-6" />
              </div>
              <h3 className="mt-16 text-3xl font-semibold leading-tight">
                HE-1 harness.
                <br />
                Built around execution.
              </h3>
              <p className="mt-5 text-sm leading-relaxed text-[#6e6e73]">
                A structural compiler manages tools, schedules execution steps,
                and validates model output loops.
              </p>
            </div>

            <div className="min-h-[360px] rounded-[28px] bg-[#1d1d1f] p-8 text-white shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-[#7ee7d3]">
                <Shield className="h-6 w-6" />
              </div>
              <h3 className="mt-16 text-3xl font-semibold leading-tight">
                Isolation.
                <br />
                Control without drama.
              </h3>
              <p className="mt-5 text-sm leading-relaxed text-[#a1a1a6]">
                Agent code runs behind container, process, and approval
                boundaries so sensitive systems stay protected.
              </p>
            </div>

            <div className="min-h-[360px] rounded-[28px] bg-white p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#fff3d6] text-[#b26900]">
                <Activity className="h-6 w-6" />
              </div>
              <h3 className="mt-16 text-3xl font-semibold leading-tight">
                Verification.
                <br />
                Before confidence.
              </h3>
              <p className="mt-5 text-sm leading-relaxed text-[#6e6e73]">
                Planning and execution loops check state, outputs, syntax, and
                budgets before work is presented as complete.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. TANDEM LOOP ARCHITECTURE (Apple's Tandem OLED style) */}
      <section
        id="tandem"
        className="relative flex min-h-screen flex-col items-center justify-center bg-[#000] px-6 py-24"
      >
        <div
          className={`apple-fade w-full max-w-6xl ${
            visibleSections["tandem"] ? "visible" : ""
          }`}
        >
          <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <div>
              <p className="font-mono text-xs uppercase text-[#86868b]">
                Performance by design
              </p>
              <h2 className="mt-4 text-5xl font-semibold leading-none text-white sm:text-7xl">
                Tandem loops.
                <br />
                One result.
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#a1a1a6]">
                The planner loop and execution loop run as distinct systems: one
                decides what should happen, the other proves what did happen.
              </p>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-[#111113] p-4 shadow-2xl shadow-black/40 sm:p-6">
              <div className="rounded-[24px] border border-white/10 bg-black p-5 sm:p-8">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/[0.06] p-6">
                    <Activity className="h-7 w-7 text-[#7ee7d3]" />
                    <h3 className="mt-12 text-2xl font-semibold text-white">
                      Planning loop
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-[#a1a1a6]">
                      Writes checklists, reads files, chooses tools, and keeps
                      the task state legible.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.06] p-6">
                    <Terminal className="h-7 w-7 text-[#6bd1ff]" />
                    <h3 className="mt-12 text-2xl font-semibold text-white">
                      Execution loop
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-[#a1a1a6]">
                      Runs commands, inspects output, fixes failures, and
                      verifies claims against evidence.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  {[
                    ["State", "Durable"],
                    ["Tools", "Scoped"],
                    ["Claims", "Verified"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                    >
                      <div className="font-mono text-[10px] uppercase text-[#86868b]">
                        {label}
                      </div>
                      <div className="mt-6 text-2xl font-semibold text-white">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. SANDBOX CONFINEMENT (Apple iPad thinness style) */}
      <section
        id="sandbox"
        className="relative flex min-h-screen flex-col items-center justify-center bg-[#f5f5f7] px-6 py-24"
      >
        <div
          className={`apple-fade w-full max-w-6xl ${
            visibleSections["sandbox"] ? "visible" : ""
          }`}
        >
          <div className="text-center">
            <p className="font-mono text-xs uppercase text-[#6e6e73]">
              Security isolation
            </p>
            <h2 className="mt-4 text-5xl font-semibold leading-none text-[#1d1d1f] sm:text-7xl">
              Thin boundary.
              <br />
              Serious containment.
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#6e6e73]">
              Autonomous code should not run on a bare host. The harness keeps
              the agent workspace close to the model and far from sensitive
              systems.
            </p>
          </div>

          <div className="mx-auto mt-16 grid max-w-5xl gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[32px] bg-white p-8 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eaf4ff] text-[#0071e3]">
                  <Shield className="h-5 w-5" />
                </div>
                <h3 className="text-2xl font-semibold text-[#1d1d1f]">
                  Isolated sandbox
                </h3>
              </div>
              <div className="mt-12 grid gap-3 sm:grid-cols-3">
                {["Filesystem scoped", "Process limits", "Approval gates"].map(
                  (item) => (
                    <div
                      key={item}
                      className="rounded-2xl border border-[#d2d2d7] p-4"
                    >
                      <CheckCircle className="h-5 w-5 text-[#0071e3]" />
                      <p className="mt-10 text-sm font-semibold text-[#1d1d1f]">
                        {item}
                      </p>
                    </div>
                  )
                )}
              </div>
            </div>

            <div className="rounded-[32px] bg-[#1d1d1f] p-8 text-white shadow-sm">
              <Lock className="h-7 w-7 text-[#7ee7d3]" />
              <h3 className="mt-20 text-3xl font-semibold leading-tight">
                Host systems stay out of reach.
              </h3>
              <p className="mt-5 text-sm leading-relaxed text-[#a1a1a6]">
                Servers, credentials, enterprise files, and operational
                databases remain outside the agent execution boundary.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. ACCESSORIES & MCP (Apple Pencil Pro / Magic Keyboard style) */}
      <section
        id="accessories"
        className="relative flex min-h-screen flex-col items-center justify-center bg-[#000] px-6 py-24"
      >
        <div
          className={`apple-fade w-full max-w-6xl ${
            visibleSections["accessories"] ? "visible" : ""
          }`}
        >
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
            <div className="flex flex-col justify-between rounded-[32px] bg-[#f5f5f7] p-8 text-[#1d1d1f]">
              <div>
                <p className="font-mono text-xs uppercase text-[#6e6e73]">
                  Tool ecosystem
                </p>
                <h2 className="mt-4 text-5xl font-semibold leading-none sm:text-6xl">
                  Tools that connect when the work needs them.
                </h2>
              </div>
              <p className="mt-12 text-lg leading-relaxed text-[#6e6e73]">
                Model Context Protocol registers tools through standardized
                contracts, then keeps the workspace auditable as the agent moves
                from research to execution.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-7 text-left">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[#7ee7d3]">
                  <FolderTree className="h-5 w-5" />
                </div>
                <h4 className="mt-20 text-2xl font-semibold text-white">
                  Durable Filesystem Workspace
                </h4>
                <p className="mt-4 text-sm leading-relaxed text-[#a1a1a6]">
                  The agent keeps a workspace structure where it files planning
                  checklists, drafts, code files, and final artifacts, leaving a
                  completely auditable workspace history.
                </p>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/[0.06] p-7 text-left">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[#6bd1ff]">
                  <Search className="h-5 w-5" />
                </div>
                <h4 className="mt-20 text-2xl font-semibold text-white">
                  Tool Pruning Filters
                </h4>
                <p className="mt-4 text-sm leading-relaxed text-[#a1a1a6]">
                  Filters and prunes unnecessary tools dynamically based on the
                  step of the plan. Minimizes context pollution and improves
                  execution speeds.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. TECHNICAL COMPARISON & SPECS SHEET (Apple teardown style) */}
      <section
        id="specs"
        className="relative flex min-h-screen flex-col items-center justify-center bg-[#050505] px-6 py-24"
      >
        <div
          className={`apple-fade mx-auto w-full max-w-4xl ${
            visibleSections["specs"] ? "visible" : ""
          }`}
        >
          <div className="mb-12 text-center">
            <h2 className="font-outfit mb-4 text-xs font-bold uppercase tracking-widest text-[#86868b]">
              Specs Teardown
            </h2>
            <h3 className="font-outfit text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Harness vs. Bare Model
            </h3>
            <p className="mt-2 text-xs text-[#86868b]">
              Compare raw model completions to systemic HE-1 constraints.
            </p>
          </div>

          <div className="mb-8 flex justify-center">
            <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setActiveTab(0)}
                className={`font-outfit rounded-full px-6 py-1.5 text-xs font-semibold transition ${
                  activeTab === 0
                    ? "bg-white text-black"
                    : "text-[#86868b] hover:text-white"
                }`}
              >
                Harness Specifications
              </button>
              <button
                onClick={() => setActiveTab(1)}
                className={`font-outfit rounded-full px-6 py-1.5 text-xs font-semibold transition ${
                  activeTab === 1
                    ? "bg-white text-black"
                    : "text-[#86868b] hover:text-white"
                }`}
              >
                Baseline Prompts
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/60 backdrop-blur-md">
            {activeTab === 0 ? (
              <div className="divide-y divide-white/5">
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-[#86868b] sm:w-1/3">
                    CORE ORCHESTRATION
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      State-Machine execution
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      Driven by pregel state-machines (LangGraph framework).
                      Runs execution loops asynchronously with safe checkpoints.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-[#86868b] sm:w-1/3">
                    CONTAINER ISOLATION
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      Isolated Docker & WASM
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      Confinement of agent tool usage inside isolated
                      containers. High safety prevents data leakage or raw
                      execution failures.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-[#86868b] sm:w-1/3">
                    WORKSPACE PERSISTENCE
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      Durable Local Workspace
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      Maintains checklist state documents (like `tracker.md` or
                      `AGENTS.md`) directly in the agent's filesystem workspace.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-[#86868b] sm:w-1/3">
                    OUTPUT COMPLIANCE
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      Double-Loop Syntactic Validators
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      Syntax lints, schema verifiers, and output checkers run
                      automatically. Re-routes execution errors directly to the
                      planner.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-rose-400 sm:w-1/3">
                    CORE ORCHESTRATION
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      Ephemeral Session Prompts
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      Relies strictly on continuous prompt instructions in chat
                      threads. High risk of instruction drift over long chat
                      history.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-rose-400 sm:w-1/3">
                    CONTAINER ISOLATION
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      Direct Host Shells
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      Dangerous connection directly to developer hosts or lack
                      of tool execution support. High vulnerability to bad
                      terminal actions.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-rose-400 sm:w-1/3">
                    WORKSPACE PERSISTENCE
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      Ephemeral RAM Memory
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      Zero physical filesystem state. Memory decays or gets
                      completely lost when context limits are reached.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col p-6 sm:flex-row">
                  <div className="font-mono text-xs tracking-wider text-rose-400 sm:w-1/3">
                    OUTPUT COMPLIANCE
                  </div>
                  <div className="mt-2 sm:mt-0 sm:w-2/3">
                    <h4 className="font-outfit text-sm font-bold text-white">
                      Blind Output Completion
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-[#86868b]">
                      No compile checks. Outputs markdown sheets blindly without
                      running syntactic verification loops.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 7. CALL TO ACTION SECTION (Apple Upgrade style) */}
      <section
        id="cta"
        className="relative flex min-h-[80vh] flex-col items-center justify-center bg-black px-6 py-24 text-center"
      >
        <div
          className={`apple-fade max-w-4xl ${
            visibleSections["cta"] ? "visible" : ""
          }`}
        >
          <h2 className="font-outfit text-5xl font-extrabold tracking-tight text-white sm:text-7xl">
            Get started. <br />
            <span className="bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
              Build your Harness today.
            </span>
          </h2>

          <p className="mx-auto mt-6 max-w-lg text-base text-[#86868b] sm:text-lg">
            Create structured, durable AI agents governed by isolated systems.
            Move beyond simple text instructions.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={`/chat?threadId=${threadId}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold text-black shadow-lg shadow-white/5 transition hover:bg-neutral-200 sm:w-auto"
            >
              Launch Deep Agent
              <Play className="h-4 w-4 fill-current" />
            </a>
          </div>

          <div className="mt-12 font-mono text-xs uppercase tracking-widest text-white/30">
            <a
              href="https://medium.com/@jerry.shao/harness-engineering-building-production-grade-ai-systems-beyond-prompts-and-context-5fcdffdd6b4c"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 border-b border-white/10 pb-0.5 transition-colors duration-200 hover:border-white/40 hover:text-white"
            >
              Harness Engineering: Building Production-Grade AI Systems Beyond
              Prompts and Context
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>

      {/* Real-time Telemetry Sync Editor Modal Dialog */}
      {isDialogOpen && (
        <div
          className={cn(
            "fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md duration-300 animate-in fade-in",
            isTelemetryFullscreen ? "p-0" : "p-4"
          )}
        >
          <div
            className={cn(
              "relative flex flex-col border border-white/10 bg-zinc-950/90 shadow-2xl transition-all duration-300 duration-300 ease-in-out animate-in zoom-in-95",
              isTelemetryFullscreen
                ? "h-screen max-h-none w-screen max-w-none rounded-none border-none p-6 sm:p-8"
                : "h-[85vh] w-full max-w-6xl rounded-3xl p-6 sm:p-8"
            )}
          >
            {/* Modal Header */}
            <div className="mb-6 flex select-none items-center justify-between border-b border-white/5 pb-4">
              <div className="flex min-w-0 items-center gap-3">
                {/* macOS-style Window Control Dots */}
                <div className="group/dots mr-2 flex shrink-0 items-center gap-[6px] px-1 py-1">
                  <button
                    onClick={() => setIsDialogOpen(false)}
                    className="relative flex h-3 w-3 items-center justify-center rounded-full border border-[#E0443E] bg-[#FF5F56] transition-colors focus:outline-none active:bg-[#BF403A]"
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
                    className="relative flex h-3 w-3 items-center justify-center rounded-full border border-[#DFA023] bg-[#FFBD2E] transition-colors focus:outline-none active:bg-[#C08E1A]"
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
                    onClick={() => setIsTelemetryFullscreen((prev) => !prev)}
                    className="relative flex h-3 w-3 items-center justify-center rounded-full border border-[#1AAB29] bg-[#27C93F] transition-colors focus:outline-none active:bg-[#12821B]"
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

                {/* Divider */}
                <div className="mr-2 h-4 w-[1px] shrink-0 bg-white/10" />

                <div className="flex items-center gap-3">
                  <h3 className="font-outfit text-xl font-bold leading-none text-white">
                    Markdown Online Preview
                  </h3>
                  <button
                    onClick={() => {
                      if (
                        wsStatus === "disconnected" ||
                        wsStatus === "fallback"
                      ) {
                        toast.promise(
                          new Promise<void>((resolve) => {
                            hasFallenBackRef.current = false;
                            connectWS();
                            resolve();
                          }),
                          {
                            loading: "Connecting to WebSocket...",
                            success: "Reconnection attempt initiated!",
                            error: "Failed to start reconnection.",
                          }
                        );
                      }
                    }}
                    className={cn(
                      "flex select-none items-center gap-2 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider transition-all duration-300",
                      wsStatus === "connected" &&
                        "cursor-default border border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
                      wsStatus === "fallback" &&
                        "cursor-default border border-sky-500/20 bg-sky-500/10 text-sky-400",
                      wsStatus === "connecting" &&
                        "animate-pulse cursor-default border border-amber-500/20 bg-amber-500/10 text-amber-400",
                      wsStatus === "disconnected" &&
                        "cursor-pointer border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 active:scale-95"
                    )}
                    title={
                      wsStatus === "connected"
                        ? "Websocket Synced (Connected)"
                        : wsStatus === "fallback"
                        ? "HTTP Stream Synced (Fallback)"
                        : wsStatus === "connecting"
                        ? "Websocket Connecting..."
                        : "Websocket Disconnected (Click to Reconnect)"
                    }
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        wsStatus === "connected" &&
                          "animate-pulse bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
                        wsStatus === "fallback" &&
                          "animate-pulse bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]",
                        wsStatus === "connecting" &&
                          "animate-pulse bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]",
                        wsStatus === "disconnected" &&
                          "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                      )}
                    />
                    {wsStatus.toUpperCase()}
                  </button>
                </div>
              </div>
            </div>

            {/* Custom Text Area Container - Stretches to fill remaining space */}
            <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/40 transition duration-300 focus-within:border-indigo-500/60">
              <Tabs
                value={activeTelemetryTab}
                onValueChange={setActiveTelemetryTab}
                className="flex h-full w-full flex-col gap-0"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-zinc-950/60 px-4 py-2">
                  <TabsList className="grid w-full max-w-[320px] grid-cols-2">
                    <TabsTrigger value="edit">Markdown</TabsTrigger>
                    <TabsTrigger value="preview">Review Markdown</TabsTrigger>
                  </TabsList>

                  {/* Telemetry Action Icons Row */}
                  <div className="flex items-center gap-3">
                    {activeTelemetryTab === "edit" ? (
                      <>
                        {/* Copy Button */}
                        <div className="tooltip-wrapper">
                          <button
                            onClick={handleCopy}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 transition duration-200 hover:bg-white/10 hover:text-white"
                          >
                            {copied ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <div className="tooltip-box-bottom">
                            <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-white/10 bg-zinc-900" />
                            <div className="whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-white shadow-xl">
                              {copied
                                ? "COPIED TO CLIPBOARD"
                                : "COPY TO CLIPBOARD"}
                            </div>
                          </div>
                        </div>

                        {/* Paste Button */}
                        <div className="tooltip-wrapper">
                          <button
                            onClick={handlePaste}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 transition duration-200 hover:bg-white/10 hover:text-white"
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />
                          </button>
                          <div className="tooltip-box-bottom">
                            <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-white/10 bg-zinc-900" />
                            <div className="whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-white shadow-xl">
                              PASTE FROM CLIPBOARD
                            </div>
                          </div>
                        </div>

                        {/* Remove Button */}
                        <div className="tooltip-wrapper">
                          <button
                            onClick={handleRemove}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 transition duration-200 hover:bg-rose-500/20 hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div className="tooltip-box-bottom tooltip-align-right">
                            <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-rose-500/20 bg-zinc-900" />
                            <div className="whitespace-nowrap rounded-md border border-rose-500/20 bg-zinc-900 px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-rose-400 shadow-xl">
                              REMOVE THREAD CONTENT
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      /* Copy HTML Button (Matches the style of others) */
                      <div className="tooltip-wrapper">
                        <button
                          onClick={handleCopyHtml}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-white/60 transition duration-200 hover:bg-white/10 hover:text-white"
                        >
                          {copiedHtml ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <div className="tooltip-box-bottom tooltip-align-right">
                          <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-white/10 bg-zinc-900" />
                          <div className="whitespace-nowrap rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-white shadow-xl">
                            {copiedHtml
                              ? "COPIED PREVIEW HTML"
                              : "COPY PREVIEW HTML"}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tab content area */}
                <TabsContent
                  value="edit"
                  className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
                >
                  <textarea
                    value={sharedText}
                    onChange={handleTextChange}
                    placeholder="Type, paste, or telemetry sync here..."
                    className="w-full flex-1 resize-none border-0 bg-transparent p-6 font-mono text-sm leading-relaxed text-white/95 placeholder-white/20 outline-none focus:ring-0"
                  />
                </TabsContent>

                <TabsContent
                  value="preview"
                  className="relative flex min-h-0 flex-1 flex-col bg-transparent data-[state=inactive]:hidden"
                >
                  {sharedText ? (
                    <ScrollArea className="min-h-0 w-full flex-1 bg-transparent">
                      <div
                        ref={previewRef}
                        className="m-4 min-h-[calc(100%-2rem)] rounded-2xl border border-zinc-200 bg-white p-8 text-left text-zinc-900 shadow-lg"
                      >
                        <MarkdownContent
                          content={sharedText}
                          light={true}
                        />
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  ) : (
                    <div className="absolute left-0 right-0 top-0 p-6 text-left font-mono text-sm leading-relaxed text-white/30">
                      <p>No content to preview.</p>
                      <p className="mt-1 text-xs text-white/20">
                        Write or paste text in the Markdown tab first.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IntroPage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-black font-mono text-white/50">
          Loading Harness Engine...
        </div>
      }
    >
      <IntroPageContent />
    </React.Suspense>
  );
}
