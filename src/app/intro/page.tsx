"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";

export const dynamic = "force-dynamic";
import { useSearchParams } from "next/navigation";
import {
  Shield,
  Activity,
  Terminal,
  ChevronRight,
  CheckCircle,
  FileText,
  FolderTree,
  Lock,
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
  const [scrollY, setScrollY] = useState(0);

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
  const crossDeployPollRef = useRef<number | null>(null);
  const lastBackendSyncRef = useRef<string | null>(null);

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

  // ── Cross-deployment sync via LangGraph backend ─────────────────────
  // When the same thread is opened on two different deployments (e.g.
  // Azure Container Apps + Vercel), the in-process WebSocket/SSE bridge
  // cannot reach across deployments.  We use the LangGraph backend's
  // thread state as a shared key-value store for markdown content.

  const syncContentToBackend = useCallback(
    async (content: string) => {
      if (!threadId) return;
      if (content === lastBackendSyncRef.current) return;
      const config = getConfig();
      if (!config) return;
      try {
        const token = getBrowserSessionToken();
        const cleanUrl = config.deploymentUrl.replace(/\/+$/, "");
        const res = await fetch(`${cleanUrl}/chat_threads/${threadId}/state`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": token || "",
          },
          body: JSON.stringify({
            values: { markdown_content: content },
          }),
        });
        if (res.ok) {
          lastBackendSyncRef.current = content;
        }
      } catch {
        // Silently ignore — cross-deploy sync is best-effort
      }
    },
    [threadId]
  );

  const startCrossDeployPolling = useCallback(() => {
    if (!threadId) return;
    if (crossDeployPollRef.current) {
      clearInterval(crossDeployPollRef.current);
    }
    lastBackendSyncRef.current = null;

    crossDeployPollRef.current = window.setInterval(async () => {
      const config = getConfig();
      if (!config) return;
      try {
        const token = getBrowserSessionToken();
        const cleanUrl = config.deploymentUrl.replace(/\/+$/, "");
        const res = await fetch(`${cleanUrl}/chat_threads/${threadId}/state`, {
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": token || "",
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        const remoteContent: string =
          data?.values?.markdown_content ?? "";
        const localContent = sharedTextRef.current;
        if (
          remoteContent &&
          remoteContent !== localContent &&
          remoteContent !== lastBackendSyncRef.current
        ) {
          console.log(
            "[Cross-Deploy] Received remote content from backend"
          );
          sharedTextRef.current = remoteContent;
          lastBackendSyncRef.current = remoteContent;
          lastPollPushedRef.current = remoteContent;
          setSharedText(remoteContent);
          localStorage.setItem(
            `markdown_thread_${threadId}`,
            remoteContent
          );
        }
      } catch {
        // Silently ignore transient failures
      }
    }, 4000);
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
    startCrossDeployPolling();

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
      if (crossDeployPollRef.current) {
        clearInterval(crossDeployPollRef.current);
        crossDeployPollRef.current = null;
      }
      setSocket(null);
      setWsStatus("disconnected");
    };
  }, [threadId, connectWS, startCrossDeployPolling]);

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
    syncContentToBackend(val);
  };

  const handleRemove = () => {
    setSharedText("");
    localStorage.removeItem(`markdown_thread_${threadId}`);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "update", content: "" }));
    } else if (wsStatus === "fallback") {
      sendFallbackUpdate("");
    }
    syncContentToBackend("");
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
        syncContentToBackend(text);
      } else {
        localStorage.removeItem(`markdown_thread_${threadId}`);
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "update", content: "" }));
        } else if (wsStatus === "fallback") {
          sendFallbackUpdate("");
        }
        syncContentToBackend("");
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

  // State for interactive features in the redesigned Klarity-style layout
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<number>(1);

  // Intersection observer to track the active phase as user scrolls
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (entry.target.id === "phase1") setActivePhase(1);
            if (entry.target.id === "phase2") setActivePhase(2);
            if (entry.target.id === "phase3") setActivePhase(3);
          }
        });
      },
      { threshold: 0.3 }
    );

    const phases = ["phase1", "phase2", "phase3"];
    phases.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden font-sans antialiased selection:bg-primary/10 selection:text-primary" style={{ backgroundColor: "var(--color-background)", color: "var(--color-text-primary)" }}>
      {/* Premium styles for custom shadows, gradients, and typography */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .font-serif-header {
          font-family: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-weight: 600;
          letter-spacing: -0.02em;
        }

        .font-mono {
          font-family: "Geist Mono", "SF Mono", Monaco, monospace;
        }

        /* Scroll reveal transitions */
        .apple-fade {
          opacity: 0;
          transform: translateY(30px);
          transition: opacity 1s cubic-bezier(0.16, 1, 0.3, 1),
                      transform 1s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .apple-fade.visible {
          opacity: 1;
          transform: translateY(0);
        }

        /* Subtle card elevation */
        .card-elevated {
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
        }

        .card-elevated:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        }

        /* Glassmorphism overlays */
        .glass-card {
          background: rgba(255, 255, 255, 0.65);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(0, 0, 0, 0.06);
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

        .node-pulse {
          animation: pulse-glow 2s infinite;
        }
        @keyframes pulse-glow {
          0%, 100% {
            box-shadow: 0 0 0 0px rgba(255, 138, 66, 0.4);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(255, 138, 66, 0);
          }
        }

        /* High contrast text selection rule for telemetry preview dialog */
        .markdown-preview-dialog-selection *::selection {
          background-color: #2563eb !important;
          color: #ffffff !important;
        }
      `,
        }}
      />

      {/* Navigation Header (Klarity Style) */}
      <header
        className={`fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b px-6 transition-all duration-300 ${
          scrollY > 40
            ? "border-border bg-[var(--color-background)]/90 backdrop-blur-xl shadow-sm"
            : "border-transparent bg-transparent"
        }`}
      >
        <div className="flex items-center gap-6">
          <a
            href="#"
            className="flex items-center gap-2.5 transition hover:opacity-85"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF8A42] p-1.5 shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 121.42 145.86" fill="white" className="h-full w-full">
                <path d="M113.99,0h-28.74l-42,59.59h-20.73V0H0v78.67h42.19l48.65,67.19h30.57l-58.36-76.02L113.99,0Z"></path>
                <path d="M22.51,129.03H0v16.81h22.51v-16.81Z"></path>
                <path d="M38.73,95.39H0v16.81h38.73v-16.81Z"></path>
              </svg>
            </div>
            <span className="font-outfit text-md font-bold uppercase tracking-tight text-foreground">
              Deep Agent
            </span>
          </a>
          <span className="hidden h-4 w-px bg-stone-200 sm:block" />
          <div className="hidden items-center gap-6 text-xs font-semibold text-muted-foreground sm:flex">
            <a href="#phase1" className={cn("transition hover:text-foreground", activePhase === 1 && "text-[#FF8A42]")}>Phase 1: Discover</a>
            <a href="#phase2" className={cn("transition hover:text-foreground", activePhase === 2 && "text-[#FF8A42]")}>Phase 2: Structure</a>
            <a href="#phase3" className={cn("transition hover:text-foreground", activePhase === 3 && "text-[#FF8A42]")}>Phase 3: Verify</a>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Clear Session Cookies */}
          <div className="tooltip-wrapper">
            <button
              onClick={handleClearCookies}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-muted-foreground border border-stone-200 shadow-sm transition hover:bg-stone-200 hover:text-foreground"
              title="Clear Session Data"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
            <div className="tooltip-box-bottom">
              <div className="z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-stone-200 bg-white" />
              <div className="whitespace-nowrap rounded-md border border-stone-200 bg-white px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-stone-700 shadow-lg">
                CLEAR COOKIES
              </div>
            </div>
          </div>

          <div className="hidden select-none items-center gap-1 font-mono text-xs text-stone-500 sm:flex">
            <div className="tooltip-wrapper">
              <span
                onClick={() => setIsDialogOpen(true)}
                className="cursor-pointer underline decoration-stone-300 decoration-dotted underline-offset-2 transition hover:text-foreground"
              >
                Collab Thread
              </span>
            </div>
            : #{threadId}
          </div>

          <a
            href={`/chat?threadId=${threadId}`}
            className="flex h-9 items-center gap-2 rounded-full bg-[#FF8A42] px-4 py-2 font-semibold text-white card-elevated transition hover:scale-[1.02] active:scale-95"
          >
            <span className="text-xs">Launch Workspace</span>
            <MessageSquare className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      {/* 1. HERO SECTION */}
      <section
        id="hero"
        className="relative flex min-h-[92vh] flex-col items-center justify-center px-6 pb-12 pt-28 text-center"
      >
        <div className="apple-fade visible w-full max-w-4xl">
          <p className="text-xs font-bold uppercase tracking-widest text-[#FF8A42] mb-4">
            The AI Agentic Control Loop
          </p>
          <h1 className="font-serif-header text-5xl font-extrabold leading-[1.1] text-foreground sm:text-7xl lg:text-8xl">
            Discover. Structure.<br />Verify. Continuously.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Raw language models operate on suggestion. Deep Agent implements a deterministic harness 
            providing boundaries, continuous planning, and double-loop verification.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={`/chat?threadId=${threadId}`}
              className="flex h-11 items-center gap-2 rounded-full bg-[#FF8A42] px-6 py-3 font-semibold text-white card-elevated transition hover:scale-[1.03]"
            >
              See the Workspace in Action
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>

          {/* Interactive Screen Preview */}
          <div className="mt-16 flex justify-center">
            <div
              ref={stackRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              className="relative w-full max-w-5xl cursor-pointer px-2 py-4"
              style={{ perspective: "1000px" }}
            >
              <div
                className="relative overflow-hidden rounded-[2rem] border border-stone-200 bg-white p-3 shadow-2xl transition-all duration-300 ease-out"
                style={{
                  transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                  transformStyle: "preserve-3d",
                }}
              >
                <div className="min-h-[360px] overflow-hidden rounded-[1.6rem] border border-stone-100 bg-stone-950 p-4 text-left sm:min-h-[460px] sm:p-6">
                  {/* Mock Shell Window */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full bg-[#FF5F56]" />
                      <span className="h-3.5 w-3.5 rounded-full bg-[#FFBD2E]" />
                      <span className="h-3.5 w-3.5 rounded-full bg-[#27C93F]" />
                      <span className="ml-4 font-mono text-xs text-white/40">deep-agent@sandbox:~</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-[#FF8A42]/20 bg-[#FF8A42]/10 px-3 py-1 font-mono text-[10px] uppercase text-[#FF8A42]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF8A42] animate-ping" />
                      Harness Online
                    </div>
                  </div>

                  <div className="grid gap-6 pt-4 lg:grid-cols-[1.3fr_0.7fr]">
                    <div className="rounded-xl border border-white/5 bg-black/40 p-4 font-mono text-xs text-stone-300 sm:p-6">
                      <div className="mb-4 text-[#FF8A42] font-semibold">// INITIALIZING DOUBLE-LOOP SYSTEM CONTROL</div>
                      <div className="space-y-2">
                        <p><span className="text-emerald-400">✔</span> Ingested workspace rules from <span className="underline cursor-pointer text-sky-400 hover:text-sky-300">CLAUDE.md</span></p>
                        <p><span className="text-emerald-400">✔</span> Read checklist target: <span className="text-stone-400">"Redesign marketing landing page"</span></p>
                        <p><span className="text-amber-400">⟲</span> Spawning subagent (ID: exec-092) for Sandboxed Command line execution</p>
                        <div className="mt-4 rounded border border-white/10 bg-white/[0.02] p-3 text-stone-400">
                          <span className="text-white/60">$</span> agy build --strict
                          <p className="mt-1 text-emerald-400">Building workspace artifacts... Success.</p>
                          <p className="text-[#FF8A42]">Lint check: 0 errors, 2 warnings resolved.</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col justify-between rounded-xl bg-white/[0.03] p-4 border border-white/5 text-stone-200">
                      <div>
                        <div className="font-mono text-[10px] uppercase text-stone-400">Plan Status</div>
                        <h4 className="mt-2 text-xl font-bold font-serif-header text-white">Verification checkpoints:</h4>
                        <ul className="mt-4 space-y-2 text-xs text-stone-300">
                          <li className="flex items-center gap-2">
                            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[10px]">✓</span>
                            <span>Build conformance checks</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-[10px]">✓</span>
                            <span>Syntactic output compliance</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-[10px]">⟲</span>
                            <span>Verify changes on staging</span>
                          </li>
                        </ul>
                      </div>
                      <div className="mt-6 rounded-lg bg-stone-900 p-2.5 text-center font-mono text-[10px] text-white/50 border border-white/5">
                        Active Thread: #{threadId}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. THE THREE PHASES (Klarity Scroll Flow) */}
      <section className="bg-white border-t border-stone-200/40">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
          
          {/* Phase 1: Discover */}
          <div id="phase1" className="grid gap-12 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-[#FF8A42] font-semibold uppercase tracking-widest text-xs mb-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF8A42]/10 text-[#FF8A42]">1</span>
                Phase 1: Discover
              </div>
              <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
                Observe operations and ingest runbooks passively.
              </h2>
              <p className="mt-6 text-muted-foreground leading-relaxed text-md">
                Deep Agent doesn't require complex integration maps. It connects directly to your repository workspace, 
                reads local code rules, and watches tools execute on behalf of tasks to capture complete contexts in days.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex gap-4 items-start">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-800 shrink-0">
                    <Activity className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground">Observation Companion</h4>
                    <p className="text-xs text-stone-500 mt-1">Watches tools execute passively, profiling execution costs and caching schemas.</p>
                  </div>
                </div>
                <div className="flex gap-4 items-start">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-800 shrink-0">
                    <MessageSquare className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground">Collaborative Ingestion</h4>
                    <p className="text-xs text-stone-500 mt-1">Real-time collaborative workspace synchronizes rules directly between developer and model.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Mock of Phase 1 */}
            <div className="rounded-3xl border border-stone-200/80 bg-stone-50 p-6 shadow-sm">
              <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-4">
                  <span className="text-xs font-bold text-stone-800 uppercase tracking-wider">Repository Rules Ingest</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-500 node-pulse" />
                </div>
                <div className="space-y-3 font-mono text-xs text-muted-foreground">
                  <div className="bg-stone-50 p-3 rounded-lg border border-stone-200/50">
                    <p className="text-[#FF8A42] font-semibold"># CLAUDE.md rule matched:</p>
                    <p className="mt-1">"Always run verification build test before committing any new component."</p>
                  </div>
                  <div className="flex justify-between items-center bg-stone-50 px-3 py-2 rounded-lg border border-stone-200/50">
                    <span>Checking workspace status...</span>
                    <span className="text-emerald-500 font-semibold">Ready</span>
                  </div>
                  <div className="relative border border-stone-200 rounded-lg p-3 bg-stone-900 text-white">
                    <div className="text-[10px] text-white/50">// Collaborative telemetry input</div>
                    <p className="mt-2 text-stone-200">"Build dynamic process graph node component representing workspace flow."</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <hr className="my-10 border-stone-100" />

          {/* Phase 2: Structure */}
          <div id="phase2" className="grid gap-12 py-16 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
            {/* Node Tree Visualizer */}
            <div className="relative rounded-3xl border border-stone-200 bg-[#FAF7F0] p-8 min-h-[400px] flex items-center justify-center overflow-hidden">
              <svg className="absolute inset-0 h-full w-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                {/* Connecting lines with highlight on hover */}
                <path d="M 120 180 Q 220 180 320 120" stroke={hoveredNode === "A" || hoveredNode === "C" ? "#FF8A42" : "#e2e8f0"} strokeWidth="2.5" fill="none" className="transition-all duration-300" />
                <path d="M 120 180 Q 220 180 320 240" stroke={hoveredNode === "A" || hoveredNode === "D" ? "#FF8A42" : "#e2e8f0"} strokeWidth="2.5" fill="none" className="transition-all duration-300" />
                <path d="M 320 120 Q 420 120 520 180" stroke={hoveredNode === "C" || hoveredNode === "B" ? "#FF8A42" : "#e2e8f0"} strokeWidth="2.5" fill="none" className="transition-all duration-300" />
                <path d="M 320 240 Q 420 240 520 180" stroke={hoveredNode === "D" || hoveredNode === "B" ? "#FF8A42" : "#e2e8f0"} strokeWidth="2.5" fill="none" className="transition-all duration-300" />
              </svg>

              <div className="relative z-10 grid grid-cols-3 gap-x-20 gap-y-12 w-full max-w-xl">
                {/* Col 1 */}
                <div className="flex items-center justify-center">
                  <div
                    onMouseEnter={() => setHoveredNode("A")}
                    onMouseLeave={() => setHoveredNode(null)}
                    className={cn(
                      "cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 w-36",
                      hoveredNode === "A" ? "border-[#FF8A42] scale-105 shadow-md" : "border-stone-200"
                    )}
                  >
                    <FolderTree className="h-5 w-5 mx-auto text-[#FF8A42]" />
                    <h5 className="mt-2 text-xs font-bold text-stone-800">Process Source</h5>
                    <p className="text-[10px] text-stone-400 mt-1">Repository Ingest</p>
                  </div>
                </div>

                {/* Col 2 */}
                <div className="flex flex-col gap-8 justify-center">
                  <div
                    onMouseEnter={() => setHoveredNode("C")}
                    onMouseLeave={() => setHoveredNode(null)}
                    className={cn(
                      "cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 w-36",
                      hoveredNode === "C" ? "border-[#FF8A42] scale-105 shadow-md" : "border-stone-200"
                    )}
                  >
                    <Terminal className="h-5 w-5 mx-auto text-sky-500" />
                    <h5 className="mt-2 text-xs font-bold text-stone-800">Planning loop</h5>
                    <p className="text-[10px] text-stone-400 mt-1">task.md checkpoints</p>
                  </div>
                  <div
                    onMouseEnter={() => setHoveredNode("D")}
                    onMouseLeave={() => setHoveredNode(null)}
                    className={cn(
                      "cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 w-36",
                      hoveredNode === "D" ? "border-[#FF8A42] scale-105 shadow-md" : "border-stone-200"
                    )}
                  >
                    <Shield className="h-5 w-5 mx-auto text-emerald-500" />
                    <h5 className="mt-2 text-xs font-bold text-stone-800">Docker Sandbox</h5>
                    <p className="text-[10px] text-stone-400 mt-1">Isolate commands</p>
                  </div>
                </div>

                {/* Col 3 */}
                <div className="flex items-center justify-center">
                  <div
                    onMouseEnter={() => setHoveredNode("B")}
                    onMouseLeave={() => setHoveredNode(null)}
                    className={cn(
                      "cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 w-36",
                      hoveredNode === "B" ? "border-[#FF8A42] scale-105 shadow-md" : "border-stone-200"
                    )}
                  >
                    <CheckCircle className="h-5 w-5 mx-auto text-amber-500" />
                    <h5 className="mt-2 text-xs font-bold text-stone-800">Process Index</h5>
                    <p className="text-[10px] text-stone-400 mt-1">Verified outcome</p>
                  </div>
                </div>
              </div>

              {/* Dynamic status helper */}
              <div className="absolute bottom-4 left-4 right-4 text-center">
                <span className="text-[10px] font-mono text-stone-400 bg-white/80 border border-stone-200/50 px-3 py-1 rounded-full shadow-sm">
                  {hoveredNode === "A" && "Source: Local code files + developer guidelines."}
                  {hoveredNode === "C" && "Planning: Decomposes goals into a checklist of actions."}
                  {hoveredNode === "D" && "Execution Confinement: Bounded isolated process loops."}
                  {hoveredNode === "B" && "Output: Indexed state verified against original objectives."}
                  {!hoveredNode && "Hover nodes to preview the active process tree connections."}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-[#FF8A42] font-semibold uppercase tracking-widest text-xs mb-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF8A42]/10 text-[#FF8A42]">2</span>
                Phase 2: Structure
              </div>
              <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
                Structure inputs into an auditable process index.
              </h2>
              <p className="mt-6 text-muted-foreground leading-relaxed text-md">
                Every task checkpoint, tool output, and code file edits are compiled into structured 
                markdown indexes. Keep track of what changed without digging through logs.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex gap-3 items-center">
                  <Check className="h-4.5 w-4.5 text-[#FF8A42] bg-[#FF8A42]/10 rounded-full p-0.5" />
                  <span className="text-sm font-semibold text-stone-800">Dynamic file-tree change tracking</span>
                </div>
                <div className="flex gap-3 items-center">
                  <Check className="h-4.5 w-4.5 text-[#FF8A42] bg-[#FF8A42]/10 rounded-full p-0.5" />
                  <span className="text-sm font-semibold text-stone-800">Always synchronized local state documentation</span>
                </div>
                <div className="flex gap-3 items-center">
                  <Check className="h-4.5 w-4.5 text-[#FF8A42] bg-[#FF8A42]/10 rounded-full p-0.5" />
                  <span className="text-sm font-semibold text-stone-800">Clean, queryable node dependency mappings</span>
                </div>
              </div>
            </div>
          </div>

          <hr className="my-10 border-stone-100" />

          {/* Phase 3: Verify */}
          <div id="phase3" className="grid gap-12 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <div className="flex items-center gap-2 text-[#FF8A42] font-semibold uppercase tracking-widest text-xs mb-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF8A42]/10 text-[#FF8A42]">3</span>
                Phase 3: Verify
              </div>
              <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
                Ensure safety before handoff.
              </h2>
              <p className="mt-6 text-muted-foreground leading-relaxed text-md">
                Continuous double-loop verification handles testing, linting, and safety checks inside 
                isolated environments. If anything breaks, the execution error triggers correction.
              </p>

              <div className="mt-8 space-y-4">
                <div className="flex gap-4 items-start">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-800 shrink-0">
                    <Shield className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground">Isolated Confinement</h4>
                    <p className="text-xs text-stone-500 mt-1">Tool command lines are confined inside isolated sandboxes to guard host files.</p>
                  </div>
                </div>
                <div className="flex gap-4 items-start">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-800 shrink-0">
                    <Lock className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground">Human-in-the-Loop Gates</h4>
                    <p className="text-xs text-stone-500 mt-1">Tool approvals and critical checks request validation before final execution.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Comparison specs grid */}
            <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
              <h4 className="font-serif-header text-lg font-bold text-stone-800 mb-4 text-center">Engine Harness vs. Bare API Model</h4>
              <div className="overflow-hidden rounded-2xl border border-stone-200 bg-stone-50 divide-y divide-stone-200">
                <div className="grid grid-cols-2 p-4 text-xs font-semibold text-stone-700 bg-stone-100/70">
                  <span>HE-1 HARNESS LAYER</span>
                  <span>EPHEMERAL MODEL API</span>
                </div>
                <div className="grid grid-cols-2 p-4 text-xs">
                  <div>
                    <h5 className="font-bold text-foreground">Durable Checkpointing</h5>
                    <p className="text-stone-500 mt-1">State machine manages structured checklists (`task.md` / `AGENTS.md`) preserved locally.</p>
                  </div>
                  <div className="pl-4 border-l border-stone-200 text-stone-500">
                    <h5 className="font-bold text-stone-400">RAM Context Only</h5>
                    <p className="mt-1">Zero local storage. Instructions degrade as chat context grows longer.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 p-4 text-xs">
                  <div>
                    <h5 className="font-bold text-foreground">Container Confinement</h5>
                    <p className="text-stone-500 mt-1">All commands execute inside isolated WASM or Docker containers.</p>
                  </div>
                  <div className="pl-4 border-l border-stone-200 text-stone-500">
                    <h5 className="font-bold text-stone-400">Direct Host Access</h5>
                    <p className="mt-1">Dangerously runs shell commands directly on host machines without boundaries.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 p-4 text-xs">
                  <div>
                    <h5 className="font-bold text-foreground">Syntax Loop Validators</h5>
                    <p className="text-stone-500 mt-1">Automatic syntax checkers catch compile errors and re-route corrections.</p>
                  </div>
                  <div className="pl-4 border-l border-stone-200 text-stone-500">
                    <h5 className="font-bold text-stone-400">Blind Completion</h5>
                    <p className="mt-1">No compile checks. Outputs code chunks blindly with no verification loop.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* 3. CTA & FOOTER */}
      <section className="relative flex min-h-[60vh] flex-col items-center justify-center bg-stone-950 px-6 py-24 text-center text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,138,66,0.06)_0%,transparent_70%)] pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <p className="text-[#FF8A42] font-mono text-xs uppercase tracking-widest mb-3">Enterprise-Grade Trust</p>
          <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Power your AI workflows<br />with deterministic safety.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-stone-400 leading-relaxed text-sm">
            Launch the workspace, initialize your collaborative thread, and build production-grade agent loops today.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href={`/chat?threadId=${threadId}`}
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#FF8A42] px-8 py-3 font-semibold text-white card-elevated transition hover:scale-[1.03]"
            >
              Launch Workspace
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-12 font-mono text-[10px] uppercase tracking-widest text-white/35">
            <a
              href="https://medium.com/@jerry.shao/harness-engineering-building-production-grade-ai-systems-beyond-prompts-and-context-5fcdffdd6b4c"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 border-b border-white/10 pb-0.5 transition-colors duration-200 hover:border-white/40 hover:text-white"
            >
              Harness Engineering: Building Production-Grade AI Systems Beyond Prompts and Context
              <ChevronRight className="h-3 w-3 rotate-[-45deg]" />
            </a>
          </div>
        </div>
      </section>

      {/* Real-time Telemetry Sync Editor Modal Dialog (Retained exactly) */}
      {isDialogOpen && (
        <div
          className={cn(
            "fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-md duration-300 animate-in fade-in",
            isTelemetryFullscreen ? "p-0" : "p-4"
          )}
        >
          <div
            className={cn(
              "relative flex flex-col border border-[#d5dee9] bg-[#f5f7fb] shadow-2xl transition-all duration-300 ease-in-out animate-in zoom-in-95 markdown-preview-dialog-selection",
              isTelemetryFullscreen
                ? "h-screen max-h-none w-screen max-w-none rounded-none border-none p-6 sm:p-8"
                : "h-[85vh] w-full max-w-6xl rounded-3xl p-6 sm:p-8"
            )}
          >
            {/* Modal Header */}
            <div className="mb-6 flex select-none items-center justify-between border-b border-[#d5dee9] pb-4">
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
                <div className="mr-2 h-4 w-[1px] shrink-0 bg-zinc-300" />

                <div className="flex items-center gap-3">
                  <h3 className="font-outfit text-xl font-bold leading-none text-zinc-900">
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
                        "cursor-default border border-emerald-200 bg-emerald-50 text-emerald-700",
                      wsStatus === "fallback" &&
                        "cursor-default border border-sky-200 bg-sky-50 text-sky-700",
                      wsStatus === "connecting" &&
                        "animate-pulse cursor-default border border-amber-200 bg-amber-50 text-amber-700",
                      wsStatus === "disconnected" &&
                        "cursor-pointer border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-95"
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
                          "animate-pulse bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]",
                        wsStatus === "fallback" &&
                          "animate-pulse bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.6)]",
                        wsStatus === "connecting" &&
                          "animate-pulse bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]",
                        wsStatus === "disconnected" &&
                          "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                      )}
                    />
                    {wsStatus.toUpperCase()}
                  </button>
                </div>
              </div>
            </div>

            {/* Custom Text Area Container - Stretches to fill remaining space */}
            <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border-0 bg-transparent transition duration-300 focus-within:border-indigo-500/60 selection:bg-primary selection:text-primary-foreground">
              <Tabs
                value={activeTelemetryTab}
                onValueChange={setActiveTelemetryTab}
                className="flex h-full w-full flex-col gap-0"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-[#d5dee9] bg-transparent px-4 py-2">
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
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-200/40 text-zinc-600 transition duration-200 hover:bg-zinc-200 hover:text-zinc-900"
                          >
                            {copied ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <div className="tooltip-box-bottom">
                            <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-[#d5dee9] bg-white" />
                            <div className="whitespace-nowrap rounded-md border border-[#d5dee9] bg-white px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-zinc-700 shadow-xl">
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
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-200/40 text-zinc-600 transition duration-200 hover:bg-zinc-200 hover:text-zinc-900"
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />
                          </button>
                          <div className="tooltip-box-bottom">
                            <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-[#d5dee9] bg-white" />
                            <div className="whitespace-nowrap rounded-md border border-[#d5dee9] bg-white px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-zinc-700 shadow-xl">
                              PASTE FROM CLIPBOARD
                            </div>
                          </div>
                        </div>

                        {/* Remove Button */}
                        <div className="tooltip-wrapper">
                          <button
                            onClick={handleRemove}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-200/40 text-zinc-600 transition duration-200 hover:bg-rose-500/10 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <div className="tooltip-box-bottom tooltip-align-right">
                            <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-rose-200 bg-white" />
                            <div className="whitespace-nowrap rounded-md border border-rose-200 bg-white px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-rose-600 shadow-xl">
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
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-200/40 text-zinc-600 transition duration-200 hover:bg-zinc-200 hover:text-zinc-900"
                        >
                          {copiedHtml ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <div className="tooltip-box-bottom tooltip-align-right">
                          <div className="tooltip-arrow z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-[#d5dee9] bg-white" />
                          <div className="whitespace-nowrap rounded-md border border-[#d5dee9] bg-white px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-zinc-700 shadow-xl">
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
                  className="flex min-h-0 flex-1 flex-col bg-[#f5f7fb] data-[state=inactive]:hidden p-4"
                >
                  <div className="flex-1 flex flex-col rounded-2xl border border-[#d5dee9] bg-white p-6 text-left text-zinc-900 shadow-sm overflow-hidden">
                    <textarea
                      value={sharedText}
                      onChange={handleTextChange}
                      placeholder="Type, paste, or telemetry sync here..."
                      className="w-full flex-1 resize-none border-0 bg-white font-mono text-sm leading-relaxed text-zinc-900 placeholder-zinc-400 outline-none focus:ring-0"
                    />
                  </div>
                </TabsContent>

                <TabsContent
                  value="preview"
                  className="relative flex min-h-0 flex-1 flex-col bg-[#f5f7fb] data-[state=inactive]:hidden"
                >
                  {sharedText ? (
                    <ScrollArea className="min-h-0 w-full flex-1">
                      <div
                        ref={previewRef}
                        className="m-4 min-h-[calc(100%-2rem)] rounded-2xl border border-[#d5dee9] bg-white p-8 text-left text-zinc-900 shadow-sm"
                      >
                        <MarkdownContent
                          content={sharedText}
                          light={true}
                        />
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  ) : (
                    <div className="absolute left-0 right-0 top-0 p-6 text-left font-mono text-sm leading-relaxed text-zinc-400">
                      <p>No content to preview.</p>
                      <p className="mt-1 text-xs text-zinc-300">
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
