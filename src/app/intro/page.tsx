"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useSearchParams } from "next/navigation";
import { navigateToIntroPhase, type IntroPhaseId } from "./phase-navigation";
import { PresentationChrome } from "./presentation-chrome";
import { useIntroPresentation } from "./use-intro-presentation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BrowserMarkdownSyncStore } from "@/features/markdown-sync/infrastructure/browser-markdown-sync-store";
import { createConfiguredBackendMarkdownSyncStore } from "@/features/markdown-sync/infrastructure/backend-markdown-sync-store";
import {
  backendMirrorRetryDelay,
  shouldApplyRemoteMarkdown,
} from "@/features/markdown-sync/application/sync-state-machine";
import {
  MarkdownConnectionLifecycle,
  type MarkdownConnectionStatus,
} from "@/features/markdown-sync/application/connection-lifecycle";
import { markdownConnectionPresentation } from "@/features/markdown-sync/application/connection-status-presentation";
import { shouldRecordMarkdownActivity } from "@/features/markdown-sync/application/preview-activity";
import { PreviewFocusRestoration } from "@/features/markdown-sync/application/preview-focus-restoration";
import {
  MarkdownPendingEditCoordinator,
  resolveMarkdownWebSocketSync,
} from "@/features/markdown-sync/application/pending-edit-coordinator";
import { clearRememberedLogin } from "@/lib/remembered-login";
import {
  buildSyncedAssetMarkdown,
  canStartSyncedImageGesture,
  deleteMarkdownAssets,
  insertSyncedImageMarkdown,
  removeSyncedMarkdownWorkspace,
  shouldApplySyncedImageUpload,
  uploadMarkdownAssets,
  validateMarkdownAssetFiles,
} from "@/lib/markdown-images";

export const dynamic = "force-dynamic";
import {
  Shield,
  Activity,
  Terminal,
  ChevronRight,
  CheckCircle,
  FolderTree,
  Lock,
  MessageSquare,
  Trash2,
  ClipboardPaste,
  Copy,
  Check,
  LogOut,
  Loader2,
} from "lucide-react";

const browserMarkdownStore = new BrowserMarkdownSyncStore();

function createMarkdownClientId(): string {
  return `md-${globalThis.crypto.randomUUID()}`;
}

function ThreadQueryObserver({
  onThreadIdChange,
}: {
  onThreadIdChange(threadId: string | null): void;
}) {
  const searchParams = useSearchParams();
  const threadId = searchParams.get("thread_id");

  useEffect(() => {
    onThreadIdChange(threadId);
  }, [onThreadIdChange, threadId]);

  return null;
}

function IntroPageContent() {
  const [threadId, setThreadId] = useState<string>("");
  const syncThreadIdFromQuery = useCallback((tid: string | null) => {
    if (tid && /^\d{6}$/.test(tid)) {
      setThreadId(tid);
      return;
    }

    const savedThreadId = localStorage.getItem("last_thread_id");
    const generatedId =
      savedThreadId && /^\d{6}$/.test(savedThreadId)
        ? savedThreadId
        : String(Math.floor(100000 + Math.random() * 900000));

    setThreadId(generatedId);
    localStorage.setItem("last_thread_id", generatedId);

    const url = new URL(window.location.href);
    url.searchParams.set("thread_id", generatedId);
    window.history.replaceState({}, "", url.toString());
  }, []);

  const [, setSocket] = useState<WebSocket | null>(null);
  const [wsStatus, setWsStatus] =
    useState<MarkdownConnectionStatus>("disconnected");
  const [sharedText, setSharedText] = useState<string>("");
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const presentation = useIntroPresentation({ suspended: isDialogOpen });
  const [autoCloseSeconds, setAutoCloseSeconds] = useState<number | null>(null);
  const [isTelemetryFullscreen, setIsTelemetryFullscreen] =
    useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedHtml, setCopiedHtml] = useState<boolean>(false);
  const [activeTelemetryTab, setActiveTelemetryTab] = useState<string>("edit");
  const [isUploadingAssets, setIsUploadingAssets] = useState(false);
  const [isRemovingAssets, setIsRemovingAssets] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const markdownPreviewTriggerRef = useRef<HTMLButtonElement>(null);
  const focusRestorationRef = useRef<PreviewFocusRestoration | null>(null);
  const restorePreviewFocusPendingRef = useRef(false);
  if (focusRestorationRef.current === null) {
    focusRestorationRef.current = new PreviewFocusRestoration({
      request: (callback) => globalThis.requestAnimationFrame(callback),
      cancel: (handle) => globalThis.cancelAnimationFrame(handle),
    });
  }

  // Function to clear session cookies
  const handleClearCookies = () => {
    // Clear session_token cookie
    document.cookie =
      "session_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";

    // Also clear localStorage items
    localStorage.removeItem("last_thread_id");
    clearRememberedLogin();

    browserMarkdownStore.clearAll();

    toast.success("Session cookies cleared. Please refresh the page.");
  };

  const wsRef = useRef<WebSocket | null>(null);
  const markdownClientIdRef = useRef(createMarkdownClientId());
  const wsAttemptIdRef = useRef<number | null>(null);
  const lifecycleRef = useRef<MarkdownConnectionLifecycle | null>(null);
  const wsStatusRef = useRef<MarkdownConnectionStatus>(wsStatus);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const sharedTextRef = useRef<string>("");
  const lastPollPushedRef = useRef<string | null>(null);
  const fallbackInitializedRef = useRef<boolean>(false);
  const crossDeployPollRef = useRef<number | null>(null);
  const crossDeployPollGenerationRef = useRef(0);
  const crossDeployPollInFlightGenerationRef = useRef<number | null>(null);
  const lastBackendSyncRef = useRef<string | null>(null);
  const contentVersionRef = useRef(0);
  const pendingEditCoordinatorRef = useRef(
    new MarkdownPendingEditCoordinator()
  );
  const pendingBackendContentRef = useRef<string | null>(null);
  const backendWriteInFlightRef = useRef(false);
  const backendFailureCountRef = useRef(0);
  const backendNextRetryAtRef = useRef(0);
  const assetOperationEpochRef = useRef(0);
  const activeAssetUploadPromiseRef = useRef<Promise<void> | null>(null);
  const isRemovingAssetsRef = useRef(false);
  const activeThreadIdRef = useRef(threadId);
  activeThreadIdRef.current = threadId;
  const isDialogOpenRef = useRef(isDialogOpen);
  isDialogOpenRef.current = isDialogOpen;

  const updateWsStatus = useCallback((status: MarkdownConnectionStatus) => {
    wsStatusRef.current = status;
    setWsStatus(status);
  }, []);

  const noteMarkdownActivity = useCallback((event?: React.SyntheticEvent) => {
    if (!shouldRecordMarkdownActivity(event?.target ?? null)) return;
    lifecycleRef.current?.recordActivity();
  }, []);

  const openMarkdownPreview = useCallback(() => {
    focusRestorationRef.current?.cancel();
    restorePreviewFocusPendingRef.current = false;
    isDialogOpenRef.current = true;
    setIsDialogOpen(true);
  }, []);

  const closeMarkdownPreview = useCallback(
    (sourceLifecycle?: MarkdownConnectionLifecycle) => {
      const lifecycle = lifecycleRef.current;
      if (sourceLifecycle && lifecycle !== sourceLifecycle) return;
      isDialogOpenRef.current = false;
      lifecycle?.setDialogOpen(false);
      setAutoCloseSeconds(null);
      restorePreviewFocusPendingRef.current = true;
      setIsDialogOpen(false);
    },
    []
  );

  const applyContent = useCallback(
    (content: string) => {
      contentVersionRef.current += 1;
      sharedTextRef.current = content;
      setSharedText(content);
      void browserMarkdownStore.save(threadId, content);
    },
    [threadId]
  );

  useEffect(() => {
    if (isDialogOpen || !restorePreviewFocusPendingRef.current) return;
    restorePreviewFocusPendingRef.current = false;
    focusRestorationRef.current?.schedule(
      () => markdownPreviewTriggerRef.current?.focus(),
      () => !isDialogOpenRef.current
    );
  }, [isDialogOpen]);

  useEffect(() => {
    return () => {
      focusRestorationRef.current?.cancel();
      restorePreviewFocusPendingRef.current = false;
    };
  }, []);

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
      contentVersionRef.current += 1;
      pendingEditCoordinatorRef.current.switchThread(threadId);
      pendingBackendContentRef.current = null;
      backendFailureCountRef.current = 0;
      backendNextRetryAtRef.current = 0;
      void pendingEditCoordinatorRef.current
        .readCurrent(threadId, () => browserMarkdownStore.load(threadId))
        .then((cachedRead) => {
          if (
            cachedRead.current &&
            cachedRead.value &&
            activeThreadIdRef.current === threadId
          ) {
            applyContent(cachedRead.value);
          }
        });
    }
  }, [threadId, applyContent]);

  // ── Cross-deployment sync via LangGraph backend ─────────────────────
  // When the same thread is opened on two different deployments (e.g.
  // Azure Container Apps + Vercel), the in-process WebSocket/SSE bridge
  // cannot reach across deployments.  We use the LangGraph backend's
  // thread state as a shared key-value store for markdown content.

  const resetBackendMirrorBackoff = useCallback(() => {
    backendFailureCountRef.current = 0;
    backendNextRetryAtRef.current = 0;
  }, []);

  const deferBackendMirrorRetry = useCallback(() => {
    backendFailureCountRef.current += 1;
    backendNextRetryAtRef.current =
      Date.now() + backendMirrorRetryDelay(backendFailureCountRef.current);
  }, []);

  const syncContentToBackend = useCallback(
    async (content: string) => {
      if (!threadId) return;
      const backendStore = createConfiguredBackendMarkdownSyncStore();
      if (!backendStore) return;
      if (
        content === lastBackendSyncRef.current &&
        pendingBackendContentRef.current === null
      ) {
        return;
      }

      pendingBackendContentRef.current = content;
      if (Date.now() < backendNextRetryAtRef.current) return;
      if (backendWriteInFlightRef.current) return;
      backendWriteInFlightRef.current = true;

      try {
        while (pendingBackendContentRef.current !== null) {
          const pendingContent: string = pendingBackendContentRef.current;
          await backendStore.save(threadId, pendingContent);
          if (activeThreadIdRef.current !== threadId) return;

          lastBackendSyncRef.current = pendingContent;
          if (pendingBackendContentRef.current === pendingContent) {
            pendingBackendContentRef.current = null;
          }
          resetBackendMirrorBackoff();
        }
      } catch {
        // Preserve latest pending content and retry without disturbing local sync.
        deferBackendMirrorRetry();
      } finally {
        backendWriteInFlightRef.current = false;
      }
    },
    [threadId, deferBackendMirrorRetry, resetBackendMirrorBackoff]
  );

  const stopCrossDeployPolling = useCallback(() => {
    crossDeployPollGenerationRef.current += 1;
    if (crossDeployPollRef.current) {
      clearInterval(crossDeployPollRef.current);
      crossDeployPollRef.current = null;
    }
  }, []);

  const pollBackendOnce = useCallback(
    async (generation: number) => {
      if (
        !threadId ||
        generation !== crossDeployPollGenerationRef.current ||
        activeThreadIdRef.current !== threadId ||
        Date.now() < backendNextRetryAtRef.current
      ) {
        return;
      }

      if (pendingBackendContentRef.current !== null) {
        void syncContentToBackend(pendingBackendContentRef.current);
        return;
      }
      if (crossDeployPollInFlightGenerationRef.current === generation) return;

      const backendStore = createConfiguredBackendMarkdownSyncStore();
      if (!backendStore) return;
      const requestVersion = contentVersionRef.current;
      crossDeployPollInFlightGenerationRef.current = generation;
      try {
        const backendRead = await pendingEditCoordinatorRef.current.readCurrent(
          threadId,
          () => backendStore.load(threadId)
        );
        if (
          generation !== crossDeployPollGenerationRef.current ||
          activeThreadIdRef.current !== threadId
        ) {
          return;
        }
        if (!backendRead.current) return;
        const remoteContent = backendRead.value;
        resetBackendMirrorBackoff();
        if (
          requestVersion !== contentVersionRef.current ||
          pendingBackendContentRef.current !== null
        ) {
          return;
        }
        const localContent = sharedTextRef.current;
        if (
          shouldApplyRemoteMarkdown(
            remoteContent,
            localContent,
            lastBackendSyncRef.current
          )
        ) {
          console.log("[Cross-Deploy] Received remote content from backend");
          lastBackendSyncRef.current = remoteContent;
          lastPollPushedRef.current = remoteContent;
          const activeSocket = wsRef.current;
          if (activeSocket?.readyState === WebSocket.OPEN) {
            activeSocket.send(
              JSON.stringify({ type: "update", content: remoteContent })
            );
          } else {
            pendingEditCoordinatorRef.current.publish(
              threadId,
              remoteContent,
              false
            );
          }
          applyContent(remoteContent);
        }
      } catch {
        if (
          generation !== crossDeployPollGenerationRef.current ||
          activeThreadIdRef.current !== threadId
        ) {
          return;
        }
        deferBackendMirrorRetry();
      } finally {
        if (crossDeployPollInFlightGenerationRef.current === generation) {
          crossDeployPollInFlightGenerationRef.current = null;
        }
      }
    },
    [
      threadId,
      syncContentToBackend,
      applyContent,
      deferBackendMirrorRetry,
      resetBackendMirrorBackoff,
    ]
  );

  const startCrossDeployPolling = useCallback(() => {
    if (!threadId) return;
    stopCrossDeployPolling();
    const generation = crossDeployPollGenerationRef.current;
    lastBackendSyncRef.current = null;
    void pollBackendOnce(generation);
    crossDeployPollRef.current = window.setInterval(() => {
      void pollBackendOnce(generation);
    }, 4000);
  }, [threadId, pollBackendOnce, stopCrossDeployPolling]);

  const closeWebSocket = useCallback(
    (code: number, reason: string, attemptId?: number) => {
      const socket = wsRef.current;
      const activeAttemptId = wsAttemptIdRef.current;
      if (attemptId !== undefined && activeAttemptId !== attemptId) return;

      wsRef.current = null;
      wsAttemptIdRef.current = null;
      setSocket(null);

      if (!socket) return;
      console.log("[Markdown WS] Closing transport", {
        threadId: activeThreadIdRef.current,
        code,
        reason,
        status: wsStatusRef.current,
        intentional: true,
      });
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(code, reason);
      }
    },
    []
  );

  const abortWebSocketAttempt = useCallback(
    (attemptId: number) => {
      closeWebSocket(4000, "attempt timeout", attemptId);
    },
    [closeWebSocket]
  );

  const stopFallback = useCallback(() => {
    pendingEditCoordinatorRef.current.stopFallback();
    const eventSource = eventSourceRef.current;
    eventSourceRef.current = null;
    if (eventSource) {
      eventSource.onerror = null;
      eventSource.close();
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    fallbackInitializedRef.current = false;
  }, []);

  const stopAllTransports = useCallback(() => {
    closeWebSocket(1000, "hibernate");
    stopFallback();
    stopCrossDeployPolling();
  }, [closeWebSocket, stopFallback, stopCrossDeployPolling]);

  const startFallbackSSE = useCallback(() => {
    if (!threadId) return;
    if (eventSourceRef.current) return;

    fallbackInitializedRef.current = false;
    console.log(
      "Initiating HTTP streaming (SSE) fallback for thread:",
      threadId
    );

    const eventSource = new EventSource(
      `/api/ws-fallback?threadId=${encodeURIComponent(threadId)}`
    );
    eventSourceRef.current = eventSource;
    const fallbackGeneration = pendingEditCoordinatorRef.current.startFallback(
      threadId,
      async (pendingEdit, { signal }) => {
        const response = await fetch("/api/ws-fallback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            threadId: pendingEdit.threadId,
            type: "update",
            content: pendingEdit.content,
            immediate: pendingEdit.immediate,
          }),
          signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP fallback returned ${response.status}`);
        }
      },
      {
        onReady: () => {
          if (
            eventSourceRef.current !== eventSource ||
            activeThreadIdRef.current !== threadId
          ) {
            return;
          }
          fallbackInitializedRef.current = true;
          lifecycleRef.current?.fallbackReady();
        },
        onWriteError: (error) => {
          if (
            eventSourceRef.current === eventSource &&
            activeThreadIdRef.current === threadId
          ) {
            console.error(
              "Failed to send content update via HTTP fallback:",
              error
            );
          }
        },
      }
    );

    eventSource.addEventListener("sync", (event) => {
      if (eventSourceRef.current !== eventSource) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "sync") {
          const incomingContent: string = data.content ?? "";
          let pendingEdit =
            pendingEditCoordinatorRef.current.pendingForThread(threadId);
          if (
            data.initial &&
            !data.authoritative &&
            !data.content &&
            pendingEdit === null &&
            sharedTextRef.current
          ) {
            lastPollPushedRef.current = sharedTextRef.current;
            pendingEdit = pendingEditCoordinatorRef.current.publish(
              threadId,
              sharedTextRef.current,
              true
            );
          }

          if (data.initial && pendingEdit !== null) {
            lastPollPushedRef.current = pendingEdit.content;
            pendingEditCoordinatorRef.current.markFallbackInitialSeen(
              fallbackGeneration
            );
            return;
          }
          if (pendingEdit !== null) {
            return;
          }
          lastPollPushedRef.current = incomingContent;
          applyContent(incomingContent);
          if (data.initial) {
            pendingEditCoordinatorRef.current.markFallbackInitialSeen(
              fallbackGeneration
            );
          }
        }
      } catch (err) {
        console.error("SSE error parsing message:", err);
      }
    });

    eventSource.onerror = () => {
      if (eventSourceRef.current !== eventSource) return;
      if (eventSource.readyState === EventSource.CLOSED) {
        // Fatal: server returned non-200, or close() was called explicitly
        console.error(
          "[SSE Fallback] Connection permanently closed. Will not auto-reconnect."
        );
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        // Expected: EventSource is auto-reconnecting after a timeout or transient failure
        console.log("[SSE Fallback] Reconnecting to SSE stream...");
      }
    };

    // ── Cross-instance polling fallback ──────────────────────────────
    // On serverless platforms (Vercel) different function instances don't
    // share memory, so real-time SSE push may not reach all subscribers.
    // Polling is read-only. Only explicit editor actions use POST, so opening
    // an empty browser cannot publish a delete over another machine's content.
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    lastPollPushedRef.current = sharedTextRef.current;
    pollingIntervalRef.current = window.setInterval(async () => {
      try {
        if (
          eventSourceRef.current !== eventSource ||
          activeThreadIdRef.current !== threadId
        ) {
          return;
        }
        if (
          pendingEditCoordinatorRef.current.pendingForThread(threadId) !== null
        ) {
          pendingEditCoordinatorRef.current.flushFallback(fallbackGeneration);
          return;
        }
        if (!fallbackInitializedRef.current) return;
        const requestVersion = contentVersionRef.current;
        const currentContent = sharedTextRef.current;
        const res = await fetch(
          `/api/ws-fallback?threadId=${encodeURIComponent(threadId)}&poll=1`
        );
        if (
          eventSourceRef.current !== eventSource ||
          activeThreadIdRef.current !== threadId
        ) {
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (
          eventSourceRef.current !== eventSource ||
          activeThreadIdRef.current !== threadId ||
          pendingEditCoordinatorRef.current.pendingForThread(threadId) !==
            null ||
          requestVersion !== contentVersionRef.current
        ) {
          return;
        }
        if (data.type === "sync") {
          const remoteContent: string = data.content ?? "";
          if (remoteContent !== currentContent) {
            console.log("[SSE Poll] Received remote content update");
            lastPollPushedRef.current = remoteContent;
            applyContent(remoteContent);
          }
        }
      } catch {
        // Silently ignore transient poll failures
      }
    }, 3000);
  }, [threadId, applyContent]);

  const connectWS = useCallback(
    (attemptId: number) => {
      if (!threadId) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws?threadId=${threadId}`;

      console.log("Attempting WebSocket connection for thread:", threadId);
      let ws: WebSocket;

      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        wsAttemptIdRef.current = attemptId;
      } catch {
        console.error("WebSocket constructor failed", {
          threadId,
          status: wsStatusRef.current,
        });
        lifecycleRef.current?.connectionFailed(attemptId);
        return;
      }

      ws.onopen = async () => {
        if (wsRef.current !== ws || wsAttemptIdRef.current !== attemptId) {
          return;
        }
        console.log("WebSocket connected for thread:", threadId);
        setSocket(ws);
        lifecycleRef.current?.socketOpened(attemptId);

        // Retrieve local offline content from localStorage and initialize sync on the server
        const localContent = (await browserMarkdownStore.load(threadId)) || "";
        if (
          wsRef.current === ws &&
          wsAttemptIdRef.current === attemptId &&
          ws.readyState === WebSocket.OPEN
        ) {
          ws.send(JSON.stringify({ type: "init", content: localContent }));
        }
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws || wsAttemptIdRef.current !== attemptId)
          return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "sync") {
            const incomingContent: string = data.content ?? "";
            const pendingEdit =
              pendingEditCoordinatorRef.current.pendingForThread(threadId);
            const resolution = resolveMarkdownWebSocketSync({
              incoming: {
                content: incomingContent,
                initial: data.initial,
                clientId: data.clientId,
                operationId: data.operationId,
              },
              localClientId: markdownClientIdRef.current,
              pendingEdit,
            });
            if (
              resolution.action === "resend" &&
              pendingEdit !== null &&
              data.initial === true &&
              ws.readyState === WebSocket.OPEN
            ) {
              ws.send(
                JSON.stringify({
                  type: "update",
                  content: pendingEdit.content,
                  immediate: pendingEdit.immediate,
                  clientId: markdownClientIdRef.current,
                  operationId: pendingEdit.operationId,
                })
              );
              lifecycleRef.current?.initialSyncReady();
              return;
            }
            if (resolution.action !== "apply") return;
            if (resolution.acknowledgeOperationId !== undefined) {
              pendingEditCoordinatorRef.current.acknowledgeWebSocket(
                threadId,
                resolution.acknowledgeOperationId
              );
            }
            applyContent(incomingContent);
            if (data.initial === true) {
              lifecycleRef.current?.initialSyncReady();
            }
          }
        } catch (err) {
          console.error("WS error parsing message:", err);
        }
      };

      ws.onclose = (event) => {
        console.log("[Markdown WS] Transport closed", {
          threadId,
          code: event.code,
          reason: event.reason,
          status: wsStatusRef.current,
          intentional: false,
        });
        if (wsRef.current !== ws || wsAttemptIdRef.current !== attemptId)
          return;
        wsRef.current = null;
        wsAttemptIdRef.current = null;
        setSocket(null);
        lifecycleRef.current?.connectionFailed(attemptId);
      };

      ws.onerror = () => {
        if (wsRef.current !== ws || wsAttemptIdRef.current !== attemptId)
          return;
        wsRef.current = null;
        wsAttemptIdRef.current = null;
        setSocket(null);
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
        lifecycleRef.current?.connectionFailed(attemptId);
      };
    },
    [threadId, applyContent]
  );

  // One controller owns retries, fallback upgrades, and transport hibernation.
  useEffect(() => {
    if (!threadId) return;

    // Callbacks need the instance identity while it is being constructed.
    let lifecycle: MarkdownConnectionLifecycle;
    // eslint-disable-next-line prefer-const
    lifecycle = new MarkdownConnectionLifecycle({
      connectWebSocket: connectWS,
      abortWebSocketAttempt,
      startFallback: startFallbackSSE,
      stopFallback,
      startCrossDeploySync: startCrossDeployPolling,
      stopAllTransports,
      setStatus: updateWsStatus,
      setAutoCloseCountdown: (seconds) => {
        if (lifecycleRef.current !== lifecycle) return;
        setAutoCloseSeconds(seconds);
      },
      requestAutoClose: () => closeMarkdownPreview(lifecycle),
    });
    lifecycleRef.current = lifecycle;

    const syncVisibility = () => {
      lifecycle.setVisibility(document.visibilityState === "visible");
    };
    const handlePageHide = () => lifecycle.setVisibility(false);
    const handlePageShow = () => syncVisibility();

    syncVisibility();
    lifecycle.setDialogOpen(isDialogOpenRef.current);
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      lifecycle.dispose();
      if (lifecycleRef.current === lifecycle) {
        setAutoCloseSeconds(null);
        lifecycleRef.current = null;
      }
    };
  }, [
    threadId,
    abortWebSocketAttempt,
    connectWS,
    startCrossDeployPolling,
    startFallbackSSE,
    stopAllTransports,
    stopFallback,
    updateWsStatus,
    closeMarkdownPreview,
  ]);

  useEffect(() => {
    lifecycleRef.current?.setDialogOpen(isDialogOpen);
  }, [isDialogOpen]);

  const publishContent = useCallback(
    (value: string, immediate = false) => {
      applyContent(value);
      const pendingEdit = pendingEditCoordinatorRef.current.publish(
        threadId,
        value,
        immediate
      );
      const activeSocket = wsRef.current;
      if (activeSocket?.readyState === WebSocket.OPEN) {
        activeSocket.send(
          JSON.stringify({
            type: "update",
            content: pendingEdit.content,
            immediate: pendingEdit.immediate,
            clientId: markdownClientIdRef.current,
            operationId: pendingEdit.operationId,
          })
        );
      } else if (wsStatusRef.current === "fallback") {
        pendingEditCoordinatorRef.current.flushActiveFallback(threadId);
      }
      void syncContentToBackend(value);
    },
    [threadId, applyContent, syncContentToBackend]
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    noteMarkdownActivity();
    publishContent(e.target.value);
  };

  const handleRemove = async () => {
    noteMarkdownActivity();
    if (isRemovingAssetsRef.current) return;
    const markdownIdToRemove = activeThreadIdRef.current;
    assetOperationEpochRef.current += 1;
    isRemovingAssetsRef.current = true;
    setIsRemovingAssets(true);
    const activeUpload = activeAssetUploadPromiseRef.current;

    try {
      await removeSyncedMarkdownWorkspace({
        markdownId: markdownIdToRemove,
        activeUpload,
        publishEmpty: () => publishContent(""),
        deleteNamespace: deleteMarkdownAssets,
      });
      toast.success(
        "Content and synced attachments removed from server storage."
      );
    } catch (error) {
      console.error("Failed to remove synced attachments:", error);
      toast.warning(
        "Content removed, but some attachment storage could not be cleaned up."
      );
    } finally {
      isRemovingAssetsRef.current = false;
      setIsRemovingAssets(false);
    }
  };

  const handlePaste = async () => {
    noteMarkdownActivity();
    try {
      const text = await navigator.clipboard.readText();
      publishContent(text, Boolean(text));
    } catch (err) {
      console.error("Failed to read from clipboard:", err);
    }
  };

  const processMarkdownAssetFiles = (
    files: readonly File[],
    selectionStart: number,
    selectionEnd: number
  ) => {
    if (
      !canStartSyncedImageGesture({
        markdownId: threadId,
        uploadActive: activeAssetUploadPromiseRef.current !== null,
        removalActive: isRemovingAssetsRef.current,
      })
    ) {
      return;
    }

    const { accepted, rejected } = validateMarkdownAssetFiles(files);
    if (accepted.length === 0) {
      if (rejected.length > 0) toast.error(rejected[0].message);
      return;
    }

    const markdownIdAtStart = threadId;
    const contentVersionAtStart = contentVersionRef.current;
    const operationEpoch = assetOperationEpochRef.current;
    setIsUploadingAssets(true);

    const operation = (async () => {
      try {
        const response = await uploadMarkdownAssets(
          markdownIdAtStart,
          accepted
        );
        if (
          !shouldApplySyncedImageUpload({
            markdownIdAtStart,
            currentMarkdownId: activeThreadIdRef.current,
            epochAtStart: operationEpoch,
            currentEpoch: assetOperationEpochRef.current,
          })
        ) {
          return;
        }

        if (response.assets.length > 0) {
          const markdown = buildSyncedAssetMarkdown(response.assets);
          const nextContent = insertSyncedImageMarkdown({
            content: sharedTextRef.current,
            markdown,
            selectionStart,
            selectionEnd,
            contentChanged: contentVersionRef.current !== contentVersionAtStart,
          });
          publishContent(nextContent, true);
        }

        const failureCount = rejected.length + response.errors.length;
        if (failureCount > 0) {
          toast.warning(
            `${failureCount} attachment${
              failureCount === 1 ? "" : "s"
            } could not be uploaded.`
          );
        }
      } catch (error) {
        console.error("Failed to upload Markdown attachments:", error);
        toast.error("Failed to upload attachments.");
      }
    })();

    activeAssetUploadPromiseRef.current = operation;
    void operation.finally(() => {
      if (activeAssetUploadPromiseRef.current === operation) {
        activeAssetUploadPromiseRef.current = null;
        setIsUploadingAssets(false);
      }
    });
  };

  const handleMarkdownAssetPaste = (
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    noteMarkdownActivity();
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    processMarkdownAssetFiles(
      files,
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd
    );
  };

  const handleMarkdownAssetDragOver = (
    event: React.DragEvent<HTMLTextAreaElement>
  ) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleMarkdownAssetDrop = (
    event: React.DragEvent<HTMLTextAreaElement>
  ) => {
    noteMarkdownActivity();
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    processMarkdownAssetFiles(
      files,
      event.currentTarget.selectionStart,
      event.currentTarget.selectionEnd
    );
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
  const [reducePresentationMotion, setReducePresentationMotion] =
    useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotionPreference = () => {
      setReducePresentationMotion(motionQuery.matches);
    };

    syncMotionPreference();
    motionQuery.addEventListener("change", syncMotionPreference);
    return () => {
      motionQuery.removeEventListener("change", syncMotionPreference);
    };
  }, []);

  // Handle mouse move for interactive card 3D tilt
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reducePresentationMotion || !stackRef.current) return;
    const rect = stackRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    // Normalize and scale tilt factors
    const tiltX = (y / (rect.height / 2)) * -12; // tilt angle degrees
    const tiltY = (x / (rect.width / 2)) * 12;
    setTilt({ x: tiltX, y: tiltY });
  };

  const handleMouseLeave = () => {
    if (reducePresentationMotion) return;
    setTilt({ x: 0, y: 0 });
  };

  // State for interactive features in the redesigned Klarity-style layout
  type WorkflowNodeId = "A" | "B" | "C" | "D";

  const [hoveredNode, setHoveredNode] = useState<WorkflowNodeId | null>(null);
  const [focusedNode, setFocusedNode] = useState<WorkflowNodeId | null>(null);
  const activeNode = hoveredNode ?? focusedNode;
  const upperRouteActive =
    activeNode !== null && ["A", "B", "C"].includes(activeNode);
  const lowerRouteActive =
    activeNode !== null && ["A", "B", "D"].includes(activeNode);
  const handlePhaseNavigation = (
    event: React.MouseEvent<HTMLAnchorElement>,
    phaseId: IntroPhaseId
  ) => {
    navigateToIntroPhase(event, phaseId);
  };

  const connectionPresentation = markdownConnectionPresentation(wsStatus);

  return (
    <div
      className="intro-page relative min-h-screen overflow-x-clip font-sans antialiased selection:bg-[#0075BE]/15 selection:text-[#001928]"
      style={{
        backgroundColor: "var(--bmo-surface)",
        color: "var(--bmo-navy)",
      }}
    >
      {/* Premium styles for custom shadows, gradients, and typography */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .intro-page {
          --bmo-blue: #0075be;
          --bmo-navy: #001928;
          --bmo-red: #e31837;
          --bmo-surface: #f3f7fa;
          --bmo-line: #d6e2ea;
          --bmo-surface-deep: #e6f9fe;
          --bmo-soft-line: rgba(0, 25, 40, 0.09);
        }

        .font-serif-header {
          font-family: "Heebo", Arial, sans-serif;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .font-mono {
          font-family: "IBM Plex Mono", monospace;
        }

        .intro-slide {
          min-height: 100dvh;
          position: relative;
          scroll-margin-top: 4rem;
          scroll-snap-align: start;
        }

        /* Ambient Drifting Lights on Slide 1 */
        .ambient-light-field {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 1;
        }

        .ambient-light-a,
        .ambient-light-b,
        .ambient-light-c {
          position: absolute;
          border-radius: 999px;
          filter: blur(55px);
          opacity: 0.45;
          pointer-events: none;
        }

        .ambient-light-a {
          width: 24rem;
          height: 24rem;
          top: 10%;
          left: 15%;
          background: radial-gradient(circle, rgba(0, 158, 201, 0.35) 0%, rgba(0, 117, 190, 0) 70%);
          animation: ambientDriftA 16s ease-in-out infinite alternate;
        }

        .ambient-light-b {
          width: 28rem;
          height: 28rem;
          top: 35%;
          right: 12%;
          background: radial-gradient(circle, rgba(115, 195, 235, 0.3) 0%, rgba(0, 117, 190, 0) 70%);
          animation: ambientDriftB 20s ease-in-out infinite alternate;
        }

        .ambient-light-c {
          width: 20rem;
          height: 20rem;
          bottom: 8%;
          left: 30%;
          background: radial-gradient(circle, rgba(0, 184, 140, 0.22) 0%, rgba(0, 184, 140, 0) 70%);
          animation: ambientDriftC 18s ease-in-out infinite alternate;
        }

        @keyframes ambientDriftA {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(50px, 35px) scale(1.12); }
        }

        @keyframes ambientDriftB {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-45px, -30px) scale(1.08); }
        }

        @keyframes ambientDriftC {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(30px, -40px) scale(1.15); }
        }

        @media (max-width: 639px) {
          .intro-slide {
            padding-right: 3.5rem;
          }
        }

        .intro-presentation-ready .intro-slide .hero-copy,
        .intro-presentation-ready .intro-slide .hero-preview,
        .intro-presentation-ready .intro-slide .chapter-copy,
        .intro-presentation-ready .intro-slide .chapter-visual,
        .intro-presentation-ready .intro-slide .chapter-reveal,
        .intro-presentation-ready .intro-slide .launch-content {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 700ms cubic-bezier(.16, 1, .3, 1),
                      transform 700ms cubic-bezier(.16, 1, .3, 1);
        }

        .intro-presentation-ready .intro-slide.is-active .hero-copy,
        .intro-presentation-ready .intro-slide.is-active .hero-preview,
        .intro-presentation-ready .intro-slide.is-active .chapter-copy,
        .intro-presentation-ready .intro-slide.is-active .chapter-visual,
        .intro-presentation-ready .intro-slide.is-active .chapter-reveal,
        .intro-presentation-ready .intro-slide.is-active .launch-content {
          opacity: 1;
          transform: translateY(0);
        }

        .intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="2"] {
          transition-delay: 120ms;
        }

        .intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="3"] {
          transition-delay: 220ms;
        }

        .intro-presentation-initializing.intro-presentation-ready .intro-slide .hero-copy,
        .intro-presentation-initializing.intro-presentation-ready .intro-slide .hero-preview,
        .intro-presentation-initializing.intro-presentation-ready .intro-slide .chapter-copy,
        .intro-presentation-initializing.intro-presentation-ready .intro-slide .chapter-visual,
        .intro-presentation-initializing.intro-presentation-ready .intro-slide .chapter-reveal,
        .intro-presentation-initializing.intro-presentation-ready .intro-slide .launch-content {
          opacity: 1;
          transform: none;
          transition: none;
        }

        .intro-presentation-initializing.intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="2"],
        .intro-presentation-initializing.intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="3"] {
          transition-delay: 0s;
        }

        .workflow-route {
          transition: stroke 240ms ease;
        }

        .workflow-particle {
          fill: #0075be;
          filter: drop-shadow(0 0 4px rgba(0, 117, 190, 0.72));
          pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
          .intro-presentation-ready .intro-slide .hero-copy,
          .intro-presentation-ready .intro-slide .hero-preview,
          .intro-presentation-ready .intro-slide .chapter-copy,
          .intro-presentation-ready .intro-slide .chapter-visual,
          .intro-presentation-ready .intro-slide .chapter-reveal,
          .intro-presentation-ready .intro-slide .launch-content,
          .intro-presentation-ready .intro-slide.is-active .hero-copy,
          .intro-presentation-ready .intro-slide.is-active .hero-preview,
          .intro-presentation-ready .intro-slide.is-active .chapter-copy,
          .intro-presentation-ready .intro-slide.is-active .chapter-visual,
          .intro-presentation-ready .intro-slide.is-active .chapter-reveal,
          .intro-presentation-ready .intro-slide.is-active .launch-content {
            opacity: 1;
            transform: none;
            transition: none;
          }

          .intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="2"],
          .intro-presentation-ready .intro-slide.is-active .chapter-reveal[data-reveal="3"] {
            transition-delay: 0s;
          }

          .workflow-route {
            transition: none;
          }

          .workflow-node {
            transition: none;
            transform: none;
          }

          .workflow-particle {
            display: none;
          }

          .workspace-preview-tilt-shell,
          .workspace-preview-tilt-card {
            transform: none;
            transition: none;
          }

          .intro-slide .animate-ping,
          .intro-page .node-pulse {
            animation: none;
          }
        }

        /* Subtle card elevation */
        .card-elevated {
          box-shadow: 0 1px 3px rgba(0, 25, 40, 0.10), 0 1px 2px rgba(0, 25, 40, 0.06);
        }

        .card-elevated:hover {
          box-shadow: 0 6px 18px rgba(0, 25, 40, 0.14);
        }

        /* Glassmorphism overlays */
        .glass-card {
          background: rgba(255, 255, 255, 0.65);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(0, 117, 190, 0.12);
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
            box-shadow: 0 0 0 0px rgba(0, 117, 190, 0.4);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(0, 117, 190, 0);
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

      <React.Suspense fallback={null}>
        <ThreadQueryObserver onThreadIdChange={syncThreadIdFromQuery} />
      </React.Suspense>

      <PresentationChrome
        activeSlideId={presentation.activeSlideId}
        isFullscreen={presentation.isFullscreen}
        fullscreenStatus={presentation.fullscreenStatus}
        suspended={isDialogOpen}
        onNavigate={(id) => presentation.goToSlide(id, "push")}
        onToggleFullscreen={() => void presentation.toggleFullscreen()}
        onOpenNotesPopup={() => void presentation.openSpeakerNotes()}
      />

      {/* Navigation Header (Klarity Style) */}
      <header
        inert={isDialogOpen ? true : undefined}
        className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center justify-between border-b border-[#D6E2EA] bg-white/95 px-6 shadow-sm backdrop-blur-xl transition-all duration-300"
      >
        <div className="flex items-center gap-6">
          <a
            href="#"
            className="flex items-center gap-2.5 transition hover:opacity-85"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0075BE] p-1.5 shadow-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 121.42 145.86"
                fill="white"
                className="h-full w-full"
              >
                <path d="M113.99,0h-28.74l-42,59.59h-20.73V0H0v78.67h42.19l48.65,67.19h30.57l-58.36-76.02L113.99,0Z"></path>
                <path d="M22.51,129.03H0v16.81h22.51v-16.81Z"></path>
                <path d="M38.73,95.39H0v16.81h38.73v-16.81Z"></path>
              </svg>
            </div>
            <span className="hidden sm:inline font-outfit text-md font-bold uppercase tracking-tight text-[#001928]">
              Applied AI Deep Agent
            </span>
          </a>
          <span className="hidden h-4 w-px bg-[#D6E2EA] sm:block" />
          <div className="hidden items-center gap-6 text-xs font-semibold text-[#536B79] sm:flex">
            <a
              href="#phase1"
              aria-current={
                presentation.activeSlideId === "phase1" ? "step" : undefined
              }
              onClick={(event) => handlePhaseNavigation(event, "phase1")}
              className={cn(
                "transition hover:text-[#001928] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-4",
                presentation.activeSlideId === "phase1" && "text-[#0075BE]"
              )}
            >
              Phase 1: Ground
            </a>
            <a
              href="#phase2"
              aria-current={
                presentation.activeSlideId === "phase2" ? "step" : undefined
              }
              onClick={(event) => handlePhaseNavigation(event, "phase2")}
              className={cn(
                "transition hover:text-[#001928] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-4",
                presentation.activeSlideId === "phase2" && "text-[#0075BE]"
              )}
            >
              Phase 2: Research
            </a>
            <a
              href="#phase3"
              aria-current={
                presentation.activeSlideId === "phase3" ? "step" : undefined
              }
              onClick={(event) => handlePhaseNavigation(event, "phase3")}
              className={cn(
                "transition hover:text-[#001928] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-4",
                presentation.activeSlideId === "phase3" && "text-[#0075BE]"
              )}
            >
              Phase 3: Review
            </a>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Clear Session Cookies */}
          <div className="tooltip-wrapper">
            <button
              onClick={handleClearCookies}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#D6E2EA] bg-[#F3F7FA] text-[#536B79] shadow-sm transition hover:bg-[#E6EFF5] hover:text-[#001928] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2"
              title="Clear Session Data"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
            <div className="tooltip-box-bottom">
              <div className="z-10 -mb-1 h-2 w-2 rotate-45 border-l border-t border-[#D6E2EA] bg-white" />
              <div className="whitespace-nowrap rounded-md border border-[#D6E2EA] bg-white px-2.5 py-1 font-mono text-[9px] font-bold tracking-wider text-[#334A59] shadow-sm">
                CLEAR COOKIES
              </div>
            </div>
          </div>

          {threadId && (
            <div className="flex select-none items-center gap-1 font-mono text-xs text-[#536B79]">
              <div className="tooltip-wrapper">
                <button
                  type="button"
                  ref={markdownPreviewTriggerRef}
                  onClick={openMarkdownPreview}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#D6E2EA] bg-[#F3F7FA] transition hover:text-[#001928] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2 sm:h-auto sm:w-auto sm:rounded-none sm:border-0 sm:bg-transparent sm:underline sm:decoration-[#A9BDCA] sm:decoration-dotted sm:underline-offset-2"
                >
                  <MessageSquare
                    aria-hidden="true"
                    className="h-4 w-4 sm:hidden"
                  />
                  <span className="sr-only sm:not-sr-only">Collab Thread</span>
                </button>
              </div>
              <span className="hidden sm:inline">: #{threadId}</span>
            </div>
          )}

          <a
            href="/chat"
            className="card-elevated flex h-9 items-center gap-2 rounded-full bg-[#E31837] px-4 py-2 font-semibold text-white hover:bg-[#B8122D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2 active:bg-[#971126] motion-safe:transition motion-safe:hover:scale-[1.02] motion-safe:active:scale-95"
          >
            <span className="text-xs">Launch Workspace</span>
            <MessageSquare className="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <main
        aria-label="Applied AI Deep Agent presentation"
        inert={isDialogOpen ? true : undefined}
      >
        {/* 1. HERO SECTION */}
        <section
          id="hero"
          data-intro-slide
          className="intro-slide relative flex min-h-[100dvh] flex-col items-center justify-center bg-[#F3F7FA] px-6 pb-12 pt-28 text-center overflow-hidden"
        >
          <div className="ambient-light-field pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="ambient-light-a" />
            <div className="ambient-light-b" />
            <div className="ambient-light-c" />
          </div>
          <div className="relative z-10 w-full max-w-4xl">
            <div className="hero-copy flex min-h-[calc(100svh-11rem)] flex-col items-center justify-center">
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-[#0075BE]">
                Enterprise Research Workspace
              </p>
              <h1 className="font-serif-header text-5xl font-extrabold leading-[1.1] text-[#001928] sm:text-7xl lg:text-8xl">
                Turn enterprise documents into
                <br />
                decision-ready knowledge.
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#405866] sm:text-xl">
                Applied AI Deep Agent turns reports, policies, research, and
                presentations into a living thread wiki, then combines document
                evidence with bounded web research and visible verification.
              </p>

              <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <a
                  href="/chat"
                  className="card-elevated flex h-11 items-center gap-2 rounded-full bg-[#E31837] px-6 py-3 font-semibold text-white hover:bg-[#B8122D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2 active:bg-[#971126] motion-safe:transition motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.98]"
                >
                  Launch Workspace Demo
                  <ChevronRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </section>

        <section
          id="preview"
          data-intro-slide
          aria-label="Workspace preview"
          className="intro-slide relative flex min-h-[100dvh] items-center justify-center bg-white px-4 pb-16 pt-24 sm:px-6"
        >
          <div className="w-full min-w-0 max-w-4xl">
            {/* Interactive Screen Preview */}
            <div className="hero-preview mt-16 flex min-w-0 justify-center">
              <div
                ref={stackRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className="workspace-preview-tilt-shell relative w-full min-w-0 max-w-5xl cursor-pointer py-4 sm:px-2"
                style={{ perspective: "1000px" }}
              >
                <div
                  className="workspace-preview-tilt-card relative min-w-0 overflow-hidden rounded-[1.5rem] border border-[#D6E2EA] bg-white p-2 shadow-[0_24px_64px_-36px_rgba(0,25,40,0.35)] transition-all duration-300 ease-out sm:rounded-[2rem] sm:p-3"
                  style={{
                    transform:
                      reducePresentationMotion || (tilt.x === 0 && tilt.y === 0)
                        ? undefined
                        : `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                    transformStyle: "preserve-3d",
                  }}
                >
                  <div className="min-h-[360px] min-w-0 overflow-hidden rounded-[1.25rem] border border-[#17394D] bg-[#001928] p-3 text-left sm:min-h-[460px] sm:rounded-[1.6rem] sm:p-6">
                    {/* Mock Shell Window */}
                    <div className="flex min-w-0 flex-col items-start gap-3 border-b border-white/5 pb-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="h-3.5 w-3.5 rounded-full bg-[#FF5F56]" />
                        <span className="h-3.5 w-3.5 rounded-full bg-[#FFBD2E]" />
                        <span className="h-3.5 w-3.5 rounded-full bg-[#27C93F]" />
                        <span className="min-w-0 break-all font-mono text-[10px] text-white/40 sm:ml-4 sm:text-xs">
                          deep-agent@research-workspace
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 rounded-full border border-[#0075BE]/30 bg-[#0075BE]/15 px-3 py-1 font-mono text-[10px] uppercase text-[#4DB6F5]">
                        <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#4DB6F5]" />
                        Research Active
                      </div>
                    </div>

                    <div className="grid min-w-0 gap-6 pt-4 lg:grid-cols-[1.3fr_0.7fr]">
                      <div className="min-w-0 break-words rounded-xl border border-[#31556A]/50 bg-[#00131F]/80 p-3 font-mono text-xs text-[#C9D8E2] sm:p-6">
                        <div className="mb-4 font-semibold text-[#4DB6F5]">
                          // BUILDING THREAD KNOWLEDGE
                        </div>
                        <div className="space-y-2">
                          <p>
                            <span className="text-emerald-400">✔</span> Added
                            source material from{" "}
                            <span className="cursor-pointer break-all text-sky-400 underline hover:text-sky-300">
                              Market_Strategy_2026.pdf
                            </span>
                          </p>
                          <p>
                            <span className="text-emerald-400">✔</span> Built
                            thread wiki for:{" "}
                            <span className="text-stone-400">
                              "Market outlook and strategic priorities"
                            </span>
                          </p>
                          <p>
                            <span className="text-amber-400">⟲</span> Planning a
                            bounded research pass for remaining evidence gaps
                          </p>
                          <div className="mt-4 rounded border border-white/10 bg-white/[0.02] p-3 text-stone-400">
                            <span className="text-white/60">$</span> research
                            plan --source-grounded
                            <p className="mt-1 text-emerald-400">
                              3 document questions grounded in thread knowledge.
                            </p>
                            <p className="text-[#4DB6F5]">
                              2 web evidence gaps queued for review.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-col justify-between rounded-xl border border-white/5 bg-white/[0.03] p-4 text-stone-200">
                        <div>
                          <div className="font-mono text-[10px] uppercase text-stone-400">
                            Research Status
                          </div>
                          <h4 className="font-serif-header mt-2 text-xl font-bold text-white">
                            Visible checkpoints:
                          </h4>
                          <ul className="mt-4 space-y-2 text-xs text-stone-300">
                            <li className="flex items-center gap-2">
                              <span className="h-4.5 w-4.5 flex items-center justify-center rounded-full bg-emerald-500/20 text-[10px] text-emerald-400">
                                ✓
                              </span>
                              <span>Document grounding</span>
                            </li>
                            <li className="flex items-center gap-2">
                              <span className="h-4.5 w-4.5 flex items-center justify-center rounded-full bg-emerald-500/20 text-[10px] text-emerald-400">
                                ✓
                              </span>
                              <span>Bounded web research</span>
                            </li>
                            <li className="flex items-center gap-2">
                              <span className="h-4.5 w-4.5 flex items-center justify-center rounded-full bg-amber-500/20 text-[10px] text-amber-400">
                                ⟲
                              </span>
                              <span>Citation and gap review</span>
                            </li>
                          </ul>
                        </div>
                        <div
                          aria-hidden={!threadId}
                          className={cn(
                            "mt-6 rounded-lg border border-[#31556A]/50 bg-[#00131F] p-2.5 text-center font-mono text-[10px] text-white/50",
                            !threadId && "invisible"
                          )}
                        >
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
        {/* Phase 1: Discover */}
        <section
          id="phase1"
          data-intro-slide
          className="intro-slide min-h-[100dvh] border-t border-[#D6E2EA] bg-[#F3F7FA] px-6 pt-16 lg:px-8"
        >
          <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl gap-12 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div className="chapter-copy">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#0075BE]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#D6E2EA] bg-white text-[#0075BE]">
                  1
                </span>
                Phase 1: Ground
              </div>
              <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-[#001928] sm:text-5xl">
                Turn source material into a living research workspace.
              </h2>
              <p className="text-md mt-6 max-w-[65ch] leading-relaxed text-[#405866]">
                Upload reports, policies, research, and presentations into an
                isolated thread. Deep Agent tracks ingestion progress and
                organizes source material into reusable wiki knowledge.
              </p>

              <div className="mt-8 space-y-4">
                <div
                  className="chapter-reveal flex items-start gap-4"
                  data-reveal="1"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E2F1FA] text-[#0075BE]">
                    <Activity className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[#001928]">
                      Observable Ingestion
                    </h4>
                    <p className="mt-1 text-xs text-[#536B79]">
                      Follow each source through analysis, review, indexing, and
                      a clear ready state.
                    </p>
                  </div>
                </div>
                <div
                  className="chapter-reveal flex items-start gap-4"
                  data-reveal="2"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E2F1FA] text-[#0075BE]">
                    <MessageSquare className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[#001928]">
                      Thread-Scoped Knowledge
                    </h4>
                    <p className="mt-1 text-xs text-[#536B79]">
                      Browse synthesized pages as a wiki tree or knowledge graph
                      without losing the original sources.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Mock of Phase 1 */}
            <div className="chapter-visual rounded-3xl border border-[#D6E2EA] bg-[#EAF2F7] p-6 shadow-[0_16px_40px_-32px_rgba(0,25,40,0.28)]">
              <div className="rounded-2xl border border-[#D6E2EA] bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between border-b border-[#D6E2EA] pb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#001928]">
                    Document Knowledge Ingestion
                  </span>
                  <span className="node-pulse h-2 w-2 rounded-full bg-emerald-500" />
                </div>
                <div className="space-y-3 font-mono text-xs text-muted-foreground">
                  <div className="rounded-lg border border-[#D6E2EA] bg-[#F3F7FA] p-3">
                    <p className="font-semibold text-[#0075BE]">
                      # Source set added:
                    </p>
                    <p className="mt-1">
                      "Annual report, policy guide, and market research deck."
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[#D6E2EA] bg-[#F3F7FA] px-3 py-2">
                    <span>Building thread wiki...</span>
                    <span className="font-semibold text-emerald-500">
                      Ready
                    </span>
                  </div>
                  <div className="relative rounded-lg border border-[#17394D] bg-[#001928] p-3 text-white">
                    <div className="text-[10px] text-white/50">
                      // Research purpose
                    </div>
                    <p className="mt-2 text-stone-200">
                      "Compare strategic priorities, risks, and supporting
                      evidence across the uploaded sources."
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr className="border-[#D6E2EA]" />

        {/* Phase 2: Structure */}
        <section
          id="phase2"
          data-intro-slide
          className="intro-slide min-h-[100dvh] border-t border-[#D6E2EA] bg-white px-6 pt-16 lg:px-8"
        >
          <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl gap-12 py-16 lg:grid-cols-[1.25fr_0.75fr] lg:items-center">
            {/* Node Tree Visualizer */}
            <div className="chapter-visual relative flex min-h-[400px] flex-col items-center justify-center overflow-hidden rounded-3xl border border-[#D6E2EA] bg-[#F3F7FA] p-4 shadow-[0_16px_40px_-32px_rgba(0,25,40,0.28)] sm:p-8">
              <svg
                className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                focusable="false"
              >
                <g
                  data-connector-track
                  aria-hidden="true"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M 120 180 Q 220 180 320 120" />
                  <path d="M 120 180 Q 220 180 320 240" />
                  <path d="M 320 120 Q 420 120 520 180" />
                  <path d="M 320 240 Q 420 240 520 180" />
                </g>

                {/* Contextual route highlights */}
                <path
                  data-workflow-route="upper"
                  d="M 120 180 Q 220 180 320 120"
                  stroke={upperRouteActive ? "#0075be" : "transparent"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  className="workflow-route"
                />
                <path
                  data-workflow-route="lower"
                  d="M 120 180 Q 220 180 320 240"
                  stroke={lowerRouteActive ? "#0075be" : "transparent"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  className="workflow-route"
                />
                <path
                  data-workflow-route="upper"
                  d="M 320 120 Q 420 120 520 180"
                  stroke={upperRouteActive ? "#0075be" : "transparent"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  className="workflow-route"
                />
                <path
                  data-workflow-route="lower"
                  d="M 320 240 Q 420 240 520 180"
                  stroke={lowerRouteActive ? "#0075be" : "transparent"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  className="workflow-route"
                />
                {upperRouteActive && (
                  <circle
                    className="workflow-particle"
                    r="4.5"
                    aria-hidden="true"
                  >
                    <animateMotion
                      dur="1.6s"
                      repeatCount="indefinite"
                      path="M 120 180 Q 220 180 320 120 Q 420 120 520 180"
                    />
                  </circle>
                )}
                {lowerRouteActive && (
                  <circle
                    className="workflow-particle"
                    r="4.5"
                    aria-hidden="true"
                  >
                    <animateMotion
                      begin={upperRouteActive ? "0.18s" : "0s"}
                      dur="1.6s"
                      repeatCount="indefinite"
                      path="M 120 180 Q 220 180 320 240 Q 420 240 520 180"
                    />
                  </circle>
                )}
              </svg>

              <div className="relative z-10 grid w-full max-w-xl grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-x-20 sm:gap-y-12">
                {/* Col 1 */}
                <div className="flex items-center justify-center">
                  <div
                    role="group"
                    tabIndex={0}
                    onMouseEnter={() => setHoveredNode("A")}
                    onMouseLeave={() => setHoveredNode(null)}
                    onFocus={() => setFocusedNode("A")}
                    onBlur={() => setFocusedNode(null)}
                    aria-label="Source Material"
                    className={cn(
                      "workflow-node w-full max-w-36 cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2",
                      activeNode === "A"
                        ? "scale-105 border-[#0075BE] shadow-[0_8px_20px_-12px_rgba(0,117,190,0.45)]"
                        : "border-[#D6E2EA]"
                    )}
                  >
                    <FolderTree className="mx-auto h-5 w-5 text-[#0075BE]" />
                    <h5 className="mt-2 text-xs font-bold text-[#001928]">
                      Source Material
                    </h5>
                    <p className="mt-1 text-[10px] text-[#536B79]">
                      Reports &amp; Policies
                    </p>
                  </div>
                </div>

                {/* Col 2 */}
                <div className="flex flex-col items-center justify-center gap-4 sm:gap-8">
                  <div
                    role="group"
                    tabIndex={0}
                    onMouseEnter={() => setHoveredNode("C")}
                    onMouseLeave={() => setHoveredNode(null)}
                    onFocus={() => setFocusedNode("C")}
                    onBlur={() => setFocusedNode(null)}
                    aria-label="Living Wiki"
                    className={cn(
                      "workflow-node w-full max-w-36 cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2",
                      activeNode === "C"
                        ? "scale-105 border-[#0075BE] shadow-[0_8px_20px_-12px_rgba(0,117,190,0.45)]"
                        : "border-[#D6E2EA]"
                    )}
                  >
                    <Terminal className="mx-auto h-5 w-5 text-sky-500" />
                    <h5 className="mt-2 text-xs font-bold text-[#001928]">
                      Living Wiki
                    </h5>
                    <p className="mt-1 text-[10px] text-[#536B79]">
                      Structured Pages
                    </p>
                  </div>
                  <div
                    role="group"
                    tabIndex={0}
                    onMouseEnter={() => setHoveredNode("D")}
                    onMouseLeave={() => setHoveredNode(null)}
                    onFocus={() => setFocusedNode("D")}
                    onBlur={() => setFocusedNode(null)}
                    aria-label="Research Plan"
                    className={cn(
                      "workflow-node w-full max-w-36 cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2",
                      activeNode === "D"
                        ? "scale-105 border-[#0075BE] shadow-[0_8px_20px_-12px_rgba(0,117,190,0.45)]"
                        : "border-[#D6E2EA]"
                    )}
                  >
                    <Shield className="mx-auto h-5 w-5 text-emerald-500" />
                    <h5 className="mt-2 text-xs font-bold text-[#001928]">
                      Research Plan
                    </h5>
                    <p className="mt-1 text-[10px] text-[#536B79]">
                      Bounded Tasks
                    </p>
                  </div>
                </div>

                {/* Col 3 */}
                <div className="flex items-center justify-center">
                  <div
                    role="group"
                    tabIndex={0}
                    onMouseEnter={() => setHoveredNode("B")}
                    onMouseLeave={() => setHoveredNode(null)}
                    onFocus={() => setFocusedNode("B")}
                    onBlur={() => setFocusedNode(null)}
                    aria-label="Source-Linked Report"
                    className={cn(
                      "workflow-node w-full max-w-36 cursor-pointer rounded-2xl border bg-white p-4 text-center shadow-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0075BE] focus-visible:ring-offset-2",
                      activeNode === "B"
                        ? "scale-105 border-[#0075BE] shadow-[0_8px_20px_-12px_rgba(0,117,190,0.45)]"
                        : "border-[#D6E2EA]"
                    )}
                  >
                    <CheckCircle className="mx-auto h-5 w-5 text-amber-500" />
                    <h5 className="mt-2 text-xs font-bold text-[#001928]">
                      Source-Linked Report
                    </h5>
                    <p className="mt-1 text-[10px] text-[#536B79]">
                      Reviewable Output
                    </p>
                  </div>
                </div>
              </div>

              {/* Dynamic status helper */}
              <div className="relative mt-4 text-center sm:absolute sm:bottom-4 sm:left-4 sm:right-4 sm:mt-0">
                <span className="inline-block max-w-full whitespace-normal rounded-full border border-[#D6E2EA] bg-white/90 px-3 py-1 font-mono text-[10px] leading-relaxed text-[#536B79] shadow-sm">
                  {activeNode === "A" &&
                    "Source: Uploaded reports, policies, research, and presentations."}
                  {activeNode === "C" &&
                    "Knowledge: Synthesizes sources into reusable wiki pages."}
                  {activeNode === "D" &&
                    "Research: Plans document queries and bounded web evidence gathering."}
                  {activeNode === "B" &&
                    "Output: Produces a source-linked report for human review."}
                  {!activeNode &&
                    "Hover or focus nodes to preview the active process tree connections."}
                </span>
              </div>
            </div>

            <div className="chapter-copy">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#0075BE]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#D6E2EA] bg-white text-[#0075BE]">
                  2
                </span>
                Phase 2: Research
              </div>
              <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-[#001928] sm:text-5xl">
                Plan bounded research across documents and the web.
              </h2>
              <p className="text-md mt-6 max-w-[65ch] leading-relaxed text-[#405866]">
                Deep Agent queries thread knowledge first, delegates targeted
                web research for remaining gaps, and synthesizes the evidence
                into a report with visible tasks and state files.
              </p>

              <div className="mt-8 space-y-4">
                <div
                  className="chapter-reveal flex items-center gap-3"
                  data-reveal="1"
                >
                  <Check className="h-4.5 w-4.5 rounded-full bg-[#0075BE]/10 p-0.5 text-[#0075BE]" />
                  <span className="text-sm font-semibold text-[#001928]">
                    Thread knowledge used before web search
                  </span>
                </div>
                <div
                  className="chapter-reveal flex items-center gap-3"
                  data-reveal="2"
                >
                  <Check className="h-4.5 w-4.5 rounded-full bg-[#0075BE]/10 p-0.5 text-[#0075BE]" />
                  <span className="text-sm font-semibold text-[#001928]">
                    Configurable concurrency and iteration limits
                  </span>
                </div>
                <div
                  className="chapter-reveal flex items-center gap-3"
                  data-reveal="3"
                >
                  <Check className="h-4.5 w-4.5 rounded-full bg-[#0075BE]/10 p-0.5 text-[#0075BE]" />
                  <span className="text-sm font-semibold text-[#001928]">
                    Visible tasks, research passes, and state files
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr className="border-[#D6E2EA]" />

        {/* Phase 3: Verify */}
        <section
          id="phase3"
          data-intro-slide
          className="intro-slide min-h-[100dvh] border-t border-[#D6E2EA] bg-[#F3F7FA] px-6 pt-16 lg:px-8"
        >
          <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl gap-12 py-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div className="chapter-copy">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[#0075BE]">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[#D6E2EA] bg-white text-[#0075BE]">
                  3
                </span>
                Phase 3: Review
              </div>
              <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-[#001928] sm:text-5xl">
                Inspect evidence before you use the result.
              </h2>
              <p className="text-md mt-6 max-w-[65ch] leading-relaxed text-[#405866]">
                Post-generation review checks citation reachability, report
                coverage, and missing perspectives. Weak reports can be revised
                through visible verification rounds before final delivery.
              </p>

              <div className="mt-8 space-y-4">
                <div
                  className="chapter-reveal flex items-start gap-4"
                  data-reveal="1"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E2F1FA] text-[#0075BE]">
                    <Shield className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[#001928]">
                      Source-Linked Evidence
                    </h4>
                    <p className="mt-1 text-xs text-[#536B79]">
                      Open document citations at the referenced page and inspect
                      the surrounding evidence in the workspace.
                    </p>
                  </div>
                </div>
                <div
                  className="chapter-reveal flex items-start gap-4"
                  data-reveal="2"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E2F1FA] text-[#0075BE]">
                    <Lock className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[#001928]">
                      Human-Reviewed Skills
                    </h4>
                    <p className="mt-1 text-xs text-[#536B79]">
                      Selecting a research skill creates an editable instruction
                      grounded in the current thread before it is sent.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Comparison specs grid */}
            <div className="chapter-visual rounded-3xl border border-[#D6E2EA] bg-white p-6 shadow-[0_16px_40px_-32px_rgba(0,25,40,0.28)]">
              <h4 className="font-serif-header mb-4 text-center text-lg font-bold text-[#001928]">
                Applied AI Deep Agent vs. a Bare Model
              </h4>
              <div className="divide-y divide-[#D6E2EA] overflow-hidden rounded-2xl border border-[#D6E2EA] bg-[#F8FBFD]">
                <div className="grid grid-cols-2 bg-[#EAF2F7] p-4 text-xs font-semibold text-[#334A59]">
                  <span>RESEARCH WORKSPACE</span>
                  <span>ONE-OFF MODEL RESPONSE</span>
                </div>
                <div
                  className="chapter-reveal grid grid-cols-2 p-4 text-xs"
                  data-reveal="1"
                >
                  <div>
                    <h5 className="font-bold text-[#001928]">
                      Persistent Research Context
                    </h5>
                    <p className="mt-1 text-[#536B79]">
                      Thread wiki, uploaded sources, tasks, and state files
                      remain available for follow-up research.
                    </p>
                  </div>
                  <div className="border-l border-[#D6E2EA] pl-4 text-[#536B79]">
                    <h5 className="font-bold text-[#536B79]">
                      Single Context Window
                    </h5>
                    <p className="mt-1">
                      Source material and prior findings must be supplied again
                      when context is lost.
                    </p>
                  </div>
                </div>
                <div
                  className="chapter-reveal grid grid-cols-2 p-4 text-xs"
                  data-reveal="2"
                >
                  <div>
                    <h5 className="font-bold text-[#001928]">
                      Source Traceability
                    </h5>
                    <p className="mt-1 text-[#536B79]">
                      Document citations open the original file at the
                      referenced page for direct inspection.
                    </p>
                  </div>
                  <div className="border-l border-[#D6E2EA] pl-4 text-[#536B79]">
                    <h5 className="font-bold text-[#536B79]">
                      Unlinked Answers
                    </h5>
                    <p className="mt-1">
                      Claims can be difficult to connect back to their
                      supporting evidence.
                    </p>
                  </div>
                </div>
                <div
                  className="chapter-reveal grid grid-cols-2 p-4 text-xs"
                  data-reveal="3"
                >
                  <div>
                    <h5 className="font-bold text-[#001928]">
                      Reusable Research Skills
                    </h5>
                    <p className="mt-1 text-[#536B79]">
                      Apply repeatable workflows for datasets, study slides,
                      interview material, and organization-specific outputs.
                    </p>
                  </div>
                  <div className="border-l border-[#D6E2EA] pl-4 text-[#536B79]">
                    <h5 className="font-bold text-[#536B79]">
                      One-Off Prompting
                    </h5>
                    <p className="mt-1">
                      Output format and quality instructions must be recreated
                      for each new request.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. CTA & FOOTER */}
        <section
          id="launch"
          data-intro-slide
          className="intro-slide relative flex min-h-[100dvh] flex-col items-center justify-center bg-[#001928] px-6 py-24 text-center text-white"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,117,190,0.12)_0%,transparent_70%)]" />
          <div className="launch-content relative z-10 max-w-3xl">
            <p className="mb-3 font-mono text-xs uppercase tracking-widest text-[#4DB6F5]">
              Designed for Human Oversight
            </p>
            <h2 className="font-serif-header text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
              See how your documents
              <br />
              become reusable knowledge.
            </h2>
            <p className="mx-auto mt-6 max-w-xl text-sm leading-relaxed text-[#B9CAD5]">
              Upload sources, follow research and verification progress, inspect
              citations, and apply reusable skills in one workspace. Generated
              outputs remain subject to human review.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="/chat"
                className="card-elevated flex h-11 items-center justify-center gap-2 rounded-full bg-[#E31837] px-8 py-3 font-semibold text-white hover:bg-[#B8122D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4DB6F5] focus-visible:ring-offset-2 focus-visible:ring-offset-[#001928] active:bg-[#971126] motion-safe:transition motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.98]"
              >
                Launch Workspace Demo
                <ChevronRight className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-10 flex flex-col items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-white/70">
              <a
                href="https://medium.com/@jerry.shao/harness-engineering-building-production-grade-ai-systems-beyond-prompts-and-context-5fcdffdd6b4c"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 border-b border-white/10 pb-0.5 transition-colors duration-200 hover:border-white/40 hover:text-white"
              >
                Harness Engineering: Building Production-Grade AI Systems Beyond
                Prompts and Context
                <ChevronRight className="h-3 w-3 rotate-[-45deg]" />
              </a>
              <a
                href="https://medium.com/@jerry.shao/harness-engineering-part-2-how-a-deep-research-agent-becomes-a-production-system-5d22bf36f09f"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 border-b border-white/10 pb-0.5 transition-colors duration-200 hover:border-white/40 hover:text-white"
              >
                Harness Engineering, Part 2: How a Deep Research Agent Becomes a
                Production System
                <ChevronRight className="h-3 w-3 rotate-[-45deg]" />
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Real-time Telemetry Sync Editor Modal Dialog (Retained exactly) */}
      <DialogPrimitive.Root
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeMarkdownPreview();
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-md duration-300 animate-in fade-in" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onPointerDownOutside={(event) => event.preventDefault()}
            onPointerDownCapture={noteMarkdownActivity}
            onKeyDownCapture={noteMarkdownActivity}
            onScrollCapture={noteMarkdownActivity}
            onWheelCapture={noteMarkdownActivity}
            onTouchStartCapture={noteMarkdownActivity}
            className={cn(
              "markdown-preview-dialog-selection fixed left-1/2 top-1/2 z-[101] flex -translate-x-1/2 -translate-y-1/2 flex-col border border-[#d5dee9] bg-[#f5f7fb] shadow-2xl transition-all duration-300 ease-in-out animate-in zoom-in-95",
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
                    data-markdown-preview-close
                    type="button"
                    onClick={() => closeMarkdownPreview()}
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
                  <DialogPrimitive.Title asChild>
                    <h3 className="font-outfit text-xl font-bold leading-none text-zinc-900">
                      Markdown Online Preview
                    </h3>
                  </DialogPrimitive.Title>
                  <button
                    onClick={() => {
                      if (connectionPresentation.action === "wake") {
                        noteMarkdownActivity();
                        return;
                      }
                      if (connectionPresentation.action === "reconnect") {
                        toast.promise(
                          new Promise<void>((resolve) => {
                            lifecycleRef.current?.reconnectNow();
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
                    disabled={connectionPresentation.action === "none"}
                    aria-label={connectionPresentation.title}
                    className={cn(
                      "flex select-none items-center gap-2 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider transition-all duration-300",
                      connectionPresentation.tone === "idle" &&
                        "cursor-pointer border border-zinc-300 bg-zinc-100 text-zinc-600 hover:bg-zinc-200 active:scale-95",
                      connectionPresentation.tone === "connected" &&
                        "cursor-default border border-emerald-200 bg-emerald-50 text-emerald-700",
                      connectionPresentation.tone === "fallback" &&
                        "cursor-pointer border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 active:scale-95",
                      connectionPresentation.tone === "pending" &&
                        "animate-pulse cursor-default border border-amber-200 bg-amber-50 text-amber-700",
                      connectionPresentation.tone === "disconnected" &&
                        "cursor-pointer border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 active:scale-95"
                    )}
                    title={connectionPresentation.title}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        connectionPresentation.tone === "idle" && "bg-zinc-400",
                        connectionPresentation.tone === "connected" &&
                          "animate-pulse bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]",
                        connectionPresentation.tone === "fallback" &&
                          "animate-pulse bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.6)]",
                        connectionPresentation.tone === "pending" &&
                          "animate-pulse bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]",
                        connectionPresentation.tone === "disconnected" &&
                          "bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"
                      )}
                    />
                    {connectionPresentation.label}
                  </button>
                  <span
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                    className="sr-only"
                  >
                    {connectionPresentation.title}
                  </span>
                </div>
              </div>
            </div>

            {autoCloseSeconds !== null && (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <span>
                  Closing in {autoCloseSeconds}{" "}
                  {autoCloseSeconds === 1 ? "second" : "seconds"} due to
                  inactivity.
                </span>
                <button
                  type="button"
                  onClick={() => noteMarkdownActivity()}
                  className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  Keep open
                </button>
              </div>
            )}

            {/* Custom Text Area Container - Stretches to fill remaining space */}
            <div className="selection:text-primary-foreground relative flex flex-1 flex-col overflow-hidden rounded-2xl border-0 bg-transparent transition duration-300 selection:bg-primary focus-within:border-indigo-500/60">
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
                            onClick={() => void handleRemove()}
                            disabled={isRemovingAssets}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-200/40 text-zinc-600 transition duration-200 hover:bg-rose-500/10 hover:text-rose-600 disabled:cursor-wait disabled:opacity-50"
                          >
                            {isRemovingAssets ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
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
                  className="flex min-h-0 flex-1 flex-col bg-[#f5f7fb] p-4 data-[state=inactive]:hidden"
                >
                  <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-[#d5dee9] bg-white p-6 text-left text-zinc-900 shadow-sm">
                    {isUploadingAssets && (
                      <span className="absolute right-5 top-4 z-10 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-mono text-[10px] font-semibold text-sky-700 shadow-sm">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        UPLOADING ATTACHMENTS
                      </span>
                    )}
                    <textarea
                      value={sharedText}
                      onChange={handleTextChange}
                      onPaste={handleMarkdownAssetPaste}
                      onDragOver={handleMarkdownAssetDragOver}
                      onDrop={handleMarkdownAssetDrop}
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
                          syncedAssetContext={{
                            markdownId: threadId,
                            allowDownload: true,
                          }}
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
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

export default function IntroPage() {
  return <IntroPageContent />;
}
