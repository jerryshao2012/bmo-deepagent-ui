"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  FormEvent,
  Fragment,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Square,
  ArrowUp,
  CheckCircle,
  Clock,
  Circle,
  FileIcon,
  AlertCircle,
  Globe,
  Paperclip,
  FileText,
  X,
  Database,
  Sparkles,
  Trash2,
  Search,
} from "lucide-react";
import { SkillsDrawer } from "@/app/components/SkillsDrawer";
import { buildSkillDraftPrompt } from "@/app/utils/buildSkillDraftPrompt";
import { useClient } from "@/providers/ClientContext";
import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { authenticatedFetch } from "@/platform/http/authenticated-fetch";
import { ChatMessage } from "@/app/components/ChatMessage";
import type { TodoItem, ActionRequest, ReviewConfig } from "@/app/types/types";
import { Assistant } from "@langchain/langgraph-sdk";
import { useChatContext } from "@/providers/ChatContext";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import { WikiTreeViewer } from "@/app/components/WikiTreeViewer";
import { useQueryState } from "nuqs";
import {
  DocumentViewerPanel,
  type DocumentViewerState,
} from "@/app/components/viewers/DocumentViewerPanel";
import { FileViewPanel } from "@/app/components/FileViewPanel";
import type { FileItem } from "@/app/types/types";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useProcessedMessages } from "@/app/hooks/useProcessedMessages";
import { selectParallelResearchProgress } from "@/app/utils/parallel-research-progress";
import { useThreadDocumentAvailability } from "@/app/hooks/useThreadDocumentAvailability";
import { useThreadStatus } from "@/app/hooks/useThreads";
import { useChatInputHistory } from "@/app/hooks/useChatInputHistory";
import {
  availabilityForCurrentThread,
  type PendingDocumentFolder,
  submitResearchMessage,
} from "@/app/utils/submit-research-message";

interface ChatInterfaceProps {
  assistant: Assistant | null;
}

const getAriaExpandedProps = (expanded: boolean) => ({
  "aria-expanded": expanded ? ("true" as const) : ("false" as const),
});

const getStatusIcon = (status: TodoItem["status"], className?: string) => {
  switch (status) {
    case "completed":
      return (
        <CheckCircle
          size={16}
          className={cn("text-success/80", className)}
        />
      );
    case "in_progress":
      return (
        <Clock
          size={16}
          className={cn("text-warning/80", className)}
        />
      );
    default:
      return (
        <Circle
          size={16}
          className={cn("text-muted-foreground", className)}
        />
      );
  }
};

export const ChatInterface = React.memo<ChatInterfaceProps>(({ assistant }) => {
  const [currentThreadId, setCurrentThreadId] = useQueryState("threadId");
  const [metaOpen, setMetaOpen] = useState<
    "tasks" | "files" | "documents" | "wiki" | null
  >(null);
  useEffect(() => {
    setMetaOpen(null);
  }, [currentThreadId]);
  const [skillsDrawerOpen, setSkillsDrawerOpen] = useState(false);
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    input,
    setInput,
    clearInput,
    recordSubmittedInput,
    handleHistoryKeyDown,
    resetHistoryNavigation,
  } = useChatInputHistory(textareaRef);
  const { scrollRef, contentRef } = useStickToBottom();

  const [liveElapsedMs, setLiveElapsedMs] = useState<number>(0);

  const {
    stream,
    messages,
    todos,
    files,
    ui,
    chatStartTime,
    chatElapsedSeconds,
    messageTimings,
    processingHumanMessageId,
    streamError,
    clearStreamError,
    setFiles,
    isLoading,
    isThreadLoading,
    interrupt,
    sendMessage,
    stopStream,
    resumeInterrupt,
    no_web,
  } = useChatContext();

  useEffect(() => {
    resetHistoryNavigation();
  }, [currentThreadId, resetHistoryNavigation]);

  const {
    data: selectedThreadStatus,
    isLoading: isSelectedThreadStatusLoading,
  } = useThreadStatus(currentThreadId);

  const client = useClient();
  const listDocuments = useCallback(async (threadId: string) => {
    const appConfig = getConfig();
    const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
    const token = getBrowserSessionToken();
    return authenticatedFetch(
      `${deploymentUrl}/documents/list?folder=threads/${threadId}`,
      {
        headers: { "X-API-Key": token },
      }
    );
  }, []);
  const {
    documents,
    availability: documentAvailability,
    availabilityEvidence,
    recordUploadSuccess,
    recordDeleteSuccess,
  } = useThreadDocumentAvailability({
    threadId: currentThreadId,
    listDocuments,
  });
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [documentViewerState, setDocumentViewerState] =
    useState<DocumentViewerState | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);

  // Toggle skills drawer with Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSkillsDrawerOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const handleSkillSelect = useCallback(
    (skill: any) => {
      const draft = buildSkillDraftPrompt(skill, {
        messages,
        todos,
        files,
        documents,
      });
      setInput((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed}\n\n${draft}` : draft;
      });
      setSkillsDrawerOpen(false);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    },
    [messages, todos, files, documents, setInput]
  );

  // Auto-resize textarea height dynamically as content changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = `${Math.min(scrollHeight, 240)}px`;
  }, [input]);

  const handleDocumentClick = useCallback(
    (filePath: string, page?: number, slide?: number, quote?: string) => {
      setSelectedFile(null); // Clear selected file when opening a document
      setDocumentViewerState({ filePath, page, slide, quote });
    },
    []
  );

  const handleFileClick = useCallback((file: FileItem) => {
    setDocumentViewerState(null); // Clear selected doc when opening a file
    setSelectedFile(file);
  }, []);

  // Close document viewer and file viewer when thread ID changes (different thread or new thread)
  useEffect(() => {
    setSelectedFile(null);
    setDocumentViewerState(null);
  }, [currentThreadId]);

  const [wikiFileCount, setWikiFileCount] = useState<{
    threadId: string;
    count: number;
  } | null>(null);
  const [wikiAvailabilityThreadId, setWikiAvailabilityThreadId] = useState<
    string | null
  >(null);
  const hasCurrentWikiDocuments =
    documentAvailability === true &&
    documents.length > 0 &&
    !!currentThreadId &&
    wikiAvailabilityThreadId === currentThreadId;
  const selectedWikiFileCount =
    hasCurrentWikiDocuments && wikiFileCount?.threadId === currentThreadId
      ? wikiFileCount.count
      : null;
  const [ingestProgress, setIngestProgress] = useState<number | null>(null);
  const [ingestPhase, setIngestPhase] = useState<string | null>(null);
  const [ingestDetail, setIngestDetail] = useState<string | null>(null);
  const [ingestCurrentSource, setIngestCurrentSource] = useState<string | null>(
    null
  );
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);
  // Local elapsed timer — ticks every second while ingesting.
  const ingestStartRef = useRef<number | null>(null);
  const elapsedAnchorRef = useRef<number>(0);
  const [ingestElapsed, setIngestElapsed] = useState<number | null>(null);
  const uploadStartRef = useRef<number | null>(null);
  const [uploadElapsedMs, setUploadElapsedMs] = useState<number>(0);

  useEffect(() => {
    if (!currentThreadId || documentAvailability !== true) {
      setWikiAvailabilityThreadId(currentThreadId);
      setWikiFileCount(null);
      return;
    }
    if (wikiAvailabilityThreadId !== currentThreadId) {
      setWikiAvailabilityThreadId(currentThreadId);
      setWikiFileCount(null);
      return;
    }
    const requestedThreadId = currentThreadId;
    const requestedAvailability = documentAvailability;
    let active = true;
    const appConfig = getConfig();
    const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
    const token = getBrowserSessionToken();
    authenticatedFetch(
      `${deploymentUrl}/threads/${currentThreadId}/wiki/tree`,
      {
        headers: token ? { "X-API-Key": token } : {},
      }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (
          active &&
          requestedAvailability === true &&
          data &&
          typeof data.file_count === "number"
        ) {
          setWikiFileCount({
            threadId: requestedThreadId,
            count: data.file_count,
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [currentThreadId, documentAvailability, wikiAvailabilityThreadId]);

  const handleWikiFileCountChange = useCallback(
    (count: number) => {
      if (
        !currentThreadId ||
        documentAvailability !== true ||
        wikiAvailabilityThreadId !== currentThreadId
      ) {
        return;
      }
      setWikiFileCount({ threadId: currentThreadId, count });
    },
    [currentThreadId, documentAvailability, wikiAvailabilityThreadId]
  );

  useEffect(() => {
    if (metaOpen === "wiki" && !hasCurrentWikiDocuments) {
      setMetaOpen(null);
    }
  }, [hasCurrentWikiDocuments, metaOpen]);
  // Retains unsent positive document evidence for each owning thread.
  const pendingDocFoldersRef = useRef(new Map<string, string>());
  const documentNamesByThreadRef = useRef(new Map<string, Set<string>>());

  useEffect(() => {
    if (
      !availabilityEvidence ||
      availabilityEvidence.threadId !== currentThreadId
    ) {
      return;
    }

    if (availabilityEvidence.available) {
      pendingDocFoldersRef.current.set(
        availabilityEvidence.threadId,
        `docs/threads/${availabilityEvidence.threadId}`
      );
    } else {
      pendingDocFoldersRef.current.delete(availabilityEvidence.threadId);
    }
  }, [availabilityEvidence, currentThreadId]);

  useEffect(() => {
    if (
      !currentThreadId ||
      documentAvailability === null ||
      availabilityEvidence?.threadId !== currentThreadId
    ) {
      return;
    }

    if (documents.length === 0) {
      documentNamesByThreadRef.current.delete(currentThreadId);
    } else {
      documentNamesByThreadRef.current.set(
        currentThreadId,
        new Set(documents.map((document) => document.name))
      );
    }
  }, [availabilityEvidence, currentThreadId, documentAvailability, documents]);

  // Open an SSE stream for real-time ingest progress.
  const startIngestProgressStream = useCallback((threadId: string) => {
    if (sseAbortRef.current) sseAbortRef.current.abort();
    const controller = new AbortController();
    sseAbortRef.current = controller;

    const appConfig = getConfig();
    const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
    const token = getBrowserSessionToken();

    // Show ingesting state immediately before the first SSE event arrives.
    setIsIngesting(true);
    setIngestError(null);
    setIngestProgress(0);
    setIngestPhase("initializing");
    setIngestDetail(null);
    setIngestCurrentSource(null);

    (async () => {
      try {
        const response = await authenticatedFetch(
          `${deploymentUrl}/threads/${threadId}/wiki/progress`,
          { headers: { "X-API-Key": token }, signal: controller.signal }
        );
        if (!response.ok || !response.body) {
          setIsIngesting(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split(/\n\n/);
          buf = frames.pop() ?? "";

          for (const frame of frames) {
            const evtMatch = frame.match(/^event:\s*(.+)$/m);
            const dataMatch = frame.match(/^data:\s*(.+)$/m);
            if (!dataMatch) continue;
            const eventType = evtMatch?.[1] ?? "progress";
            try {
              const payload = JSON.parse(dataMatch[1]);
              if (eventType === "end") {
                if (payload.phase === "error" || payload.error) {
                  setIngestError(
                    payload.error ||
                      payload.detail ||
                      "Ingest failed with an unknown error."
                  );
                  setIngestProgress(-1);
                  setIngestPhase("error");
                  setIsIngesting(false);
                } else {
                  setIngestProgress(payload.wiki_ready ? 100 : null);
                  setIngestPhase(payload.wiki_ready ? "ready" : null);
                  setIngestDetail(null);
                  setIngestCurrentSource(null);
                  setIsIngesting(false);
                }
                return;
              }
              if (eventType === "heartbeat") {
                // Keep-alive ping — silently ignored.
                continue;
              }
              setIngestProgress(
                typeof payload.progress === "number" ? payload.progress : null
              );
              setIngestPhase(payload.phase ?? "processing");
              setIngestDetail(payload.detail ?? null);
              setIngestCurrentSource(payload.current_source ?? null);
              // Calibrate elapsed timer against server clock on every event.
              if (typeof payload.elapsed_seconds === "number") {
                elapsedAnchorRef.current = payload.elapsed_seconds;
                ingestStartRef.current = Date.now();
              }
              setIsIngesting(true);
            } catch {
              /* ignore malformed frames */
            }
          }
        }
      } catch (err: unknown) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          console.error("Wiki SSE stream error:", err);
        }
        setIsIngesting(false);
      }
    })();
  }, []);

  // On thread change: check status once and open SSE stream if ingestion is active.
  useEffect(() => {
    if (!currentThreadId) {
      setIsIngesting(false);
      setIngestError(null);
      setIngestProgress(null);
      setIngestPhase(null);
      setIngestDetail(null);
      setIngestCurrentSource(null);
      if (sseAbortRef.current) sseAbortRef.current.abort();
      return;
    }

    let active = true;

    const appConfig = getConfig();
    const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
    const token = getBrowserSessionToken();

    authenticatedFetch(
      `${deploymentUrl}/threads/${currentThreadId}/wiki/status`,
      {
        headers: { "X-API-Key": token },
      }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data.is_active) {
          startIngestProgressStream(currentThreadId);
        } else {
          setIngestError(null);
          setIngestProgress(data.wiki_ready ? 100 : null);
          setIngestPhase(data.wiki_ready ? "ready" : null);
          setIngestDetail(null);
          setIngestCurrentSource(null);
          setIsIngesting(false);
        }
      })
      .catch(() => {
        if (active) {
          setIsIngesting(false);
          setIngestDetail(null);
          setIngestCurrentSource(null);
        }
      });

    return () => {
      active = false;
      if (sseAbortRef.current) sseAbortRef.current.abort();
    };
  }, [currentThreadId, startIngestProgressStream]);

  // Local elapsed timer — ticks every second while ingesting.
  // Anchored to the server's elapsed_seconds from the first SSE event so the
  // counter starts from the true ingest start time, not when SSE connected.
  useEffect(() => {
    if (!isIngesting) {
      ingestStartRef.current = null;
      elapsedAnchorRef.current = 0;
      setIngestElapsed(null);
      return;
    }
    if (ingestStartRef.current == null) {
      ingestStartRef.current = Date.now();
    }
    const timer = setInterval(() => {
      if (ingestStartRef.current != null) {
        setIngestElapsed(
          (Date.now() - ingestStartRef.current) / 1000 +
            elapsedAnchorRef.current
        );
      }
    }, 50);
    return () => clearInterval(timer);
  }, [isIngesting]);

  // Local elapsed timer for file uploading, ticking every 50ms in milliseconds.
  useEffect(() => {
    if (!isUploading) {
      uploadStartRef.current = null;
      setUploadElapsedMs(0);
      return;
    }
    uploadStartRef.current = Date.now();
    const updateTimer = () => {
      if (uploadStartRef.current != null) {
        setUploadElapsedMs(Date.now() - uploadStartRef.current);
      }
    };
    updateTimer();
    const timer = setInterval(updateTimer, 50);
    return () => clearInterval(timer);
  }, [isUploading]);

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  // Shared upload logic used by both file input and drag-and-drop.
  const processUploadedFiles = useCallback(
    async (selectedFiles: FileList) => {
      if (selectedFiles.length === 0) return;

      const uploadedDocuments = Array.from(selectedFiles, (file) => ({
        name: file.name,
        size: file.size,
        type: "file",
      }));
      setIsUploading(true);
      try {
        let activeThreadId = currentThreadId;
        let isNewThread = false;

        const getGraphId = (graphId?: string) => {
          if (!graphId || graphId === "researcher") return "research";
          return graphId;
        };

        if (!activeThreadId) {
          const graphId = getGraphId(assistant?.graph_id);
          const newThread = await client.threads.create({
            graphId,
            metadata: {
              graph_id: graphId,
            },
          });
          activeThreadId = newThread.thread_id;
          isNewThread = true;
        } else {
          // Ensure the thread has a graph_id in its metadata before uploading.
          // Fetch existing metadata first and merge, following the same pattern
          // used by updateThreadTitle / updateThreadFavorite.
          const graphId = getGraphId(assistant?.graph_id);
          try {
            // Ensure the thread is registered on the server first (in case it hasn't had any runs yet)
            await client.threads.create({
              threadId: activeThreadId,
              graphId,
              ifExists: "do_nothing",
              metadata: {
                graph_id: graphId,
              },
            });

            const existing = await client.threads.get(activeThreadId);
            const existingMetadata =
              existing?.metadata && typeof existing.metadata === "object"
                ? existing.metadata
                : {};
            await client.threads.update(activeThreadId, {
              metadata: {
                ...existingMetadata,
                graph_id: graphId,
              },
            });
          } catch (e) {
            console.error(
              "Failed to assign graph_id to thread before upload.",
              e
            );
            throw new Error(
              "Cannot upload files yet — this thread has no assigned graph ID. " +
                "Please send a message to start a conversation first, then try uploading again.",
              { cause: e }
            );
          }
        }

        const formData = new FormData();
        formData.append("folder", `threads/${activeThreadId}`);
        for (let i = 0; i < selectedFiles.length; i++) {
          formData.append("files", selectedFiles[i]);
        }

        const appConfig = getConfig();
        const deploymentUrl = appConfig?.deploymentUrl || "";
        const token = getBrowserSessionToken();

        const response = await authenticatedFetch(
          `${deploymentUrl.replace(/\/+$/, "")}/documents/upload`,
          {
            method: "POST",
            headers: {
              "X-API-Key": token,
            },
            body: formData,
          }
        );

        if (!response.ok) {
          let detail = `HTTP ${response.status}`;
          try {
            const body = await response.json();
            if (body?.detail) detail += `: ${body.detail}`;
          } catch {
            // Response body is not JSON; keep status-only message.
          }
          throw new Error(detail);
        }

        try {
          await response.json();
        } catch {
          // Non-JSON response; proceed after successful upload.
        }

        const docFolder = `docs/threads/${activeThreadId}`;
        await recordUploadSuccess({
          activeThreadId,
          documents: uploadedDocuments,
        });
        pendingDocFoldersRef.current.set(activeThreadId, docFolder);
        const documentNames =
          documentNamesByThreadRef.current.get(activeThreadId) ?? new Set();
        for (const document of uploadedDocuments) {
          documentNames.add(document.name);
        }
        documentNamesByThreadRef.current.set(activeThreadId, documentNames);

        // Note: wiki ingestion is auto-triggered by the server (webapp.py) on upload.
        // No need to explicitly call /wiki/ingest here — the server registers
        // progress in _active_ingests and /wiki/status will track it.

        // Clear the input value so the same file can be uploaded again if needed
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        if (isNewThread) {
          await setCurrentThreadId(activeThreadId);
        }

        startIngestProgressStream(activeThreadId);
      } catch (error) {
        console.error("Failed to upload files:", error);
        alert(
          `Upload failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      } finally {
        setIsUploading(false);
      }
    },
    [
      assistant?.graph_id,
      client,
      currentThreadId,
      recordUploadSuccess,
      setCurrentThreadId,
      startIngestProgressStream,
    ]
  );

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;
    await processUploadedFiles(selectedFiles);
  };

  const handleDeleteDocument = async (filename: string) => {
    if (!currentThreadId) return;

    const targetThreadId = currentThreadId;
    if (!documentNamesByThreadRef.current.has(targetThreadId)) {
      documentNamesByThreadRef.current.set(
        targetThreadId,
        new Set(documents.map((document) => document.name))
      );
    }

    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      const appConfig = getConfig();
      const deploymentUrl = appConfig?.deploymentUrl || "";
      const token = getBrowserSessionToken();

      const response = await authenticatedFetch(
        `${deploymentUrl.replace(/\/+$/, "")}/documents/${encodeURIComponent(
          filename
        )}?folder=threads/${targetThreadId}`,
        {
          method: "DELETE",
          headers: {
            "X-API-Key": token,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to delete document: ${response.status}`);
      }

      const documentNames =
        documentNamesByThreadRef.current.get(targetThreadId);
      documentNames?.delete(filename);
      const hasOwnerScopedDocuments = (documentNames?.size ?? 0) > 0;
      if (!hasOwnerScopedDocuments) {
        documentNamesByThreadRef.current.delete(targetThreadId);
      }
      const { hasDocuments } = await recordDeleteSuccess(
        filename,
        targetThreadId
      );
      if ((hasDocuments ?? hasOwnerScopedDocuments) === false) {
        pendingDocFoldersRef.current.delete(targetThreadId);
      }
    } catch (error) {
      console.error("Failed to delete document:", error);
      alert(
        `Delete failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const lastThreadIdRef = useRef<string | null>(null);
  const lastNoWebRef = useRef<boolean | null | undefined>(undefined);

  // Sync webSearchEnabled state with the thread's no_web configuration when thread loads or changes.
  // Uses refs to track previous values so local toggles don't trigger a re-sync.
  useEffect(() => {
    const threadChanged = currentThreadId !== lastThreadIdRef.current;
    const noWebChanged = no_web !== lastNoWebRef.current;

    if (threadChanged) {
      lastThreadIdRef.current = currentThreadId;
      lastNoWebRef.current = no_web;
      if (no_web !== undefined && no_web !== null) {
        setWebSearchEnabled(!no_web);
      } else {
        setWebSearchEnabled(true);
      }
    } else if (noWebChanged && no_web !== undefined && no_web !== null) {
      lastNoWebRef.current = no_web;
      setWebSearchEnabled(!no_web);
    }
  }, [no_web, currentThreadId]);

  const localLatestStartedAt = useMemo(() => {
    const latestTiming = Object.values(messageTimings).sort(
      (a, b) => (b.startedAt || 0) - (a.startedAt || 0)
    )[0];
    return latestTiming?.startedAt;
  }, [messageTimings]);

  const effectiveStartMs = useMemo(() => {
    if (typeof chatStartTime === "number") {
      return chatStartTime;
    }
    return localLatestStartedAt;
  }, [chatStartTime, localLatestStartedAt]);

  // Update live timer while tasks are running
  useEffect(() => {
    if (!isLoading || !effectiveStartMs) {
      if (!isLoading) {
        setLiveElapsedMs(0);
      }
      return;
    }

    const updateElapsed = () => {
      setLiveElapsedMs(Math.max(0, Date.now() - effectiveStartMs));
    };

    updateElapsed();

    const interval = setInterval(() => {
      updateElapsed();
    }, 100);

    return () => clearInterval(interval);
  }, [isLoading, effectiveStartMs]);

  const isSelectedThreadBusy =
    !!currentThreadId && selectedThreadStatus === "busy";
  const isResolvingSelectedThreadStatus =
    !!currentThreadId &&
    isSelectedThreadStatusLoading &&
    selectedThreadStatus == null;
  const composerLocked =
    isSelectedThreadBusy ||
    isLoading ||
    isThreadLoading ||
    isResolvingSelectedThreadStatus ||
    !assistant ||
    isUploading ||
    isIngesting;
  const showRunningMode =
    isLoading ||
    isSelectedThreadBusy ||
    isResolvingSelectedThreadStatus ||
    isIngesting;

  // ── Drag-and-drop handlers ──────────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only track file drags (not internal element drags).
    if (e.dataTransfer?.types?.includes("Files")) {
      dragCounterRef.current += 1;
      if (dragCounterRef.current === 1) {
        setIsDragOver(true);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes("Files")) {
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragOver(false);
      }
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragOver(false);

      if (composerLocked || isUploading) return;

      const droppedFiles = e.dataTransfer?.files;
      if (!droppedFiles || droppedFiles.length === 0) return;

      await processUploadedFiles(droppedFiles);
    },
    [composerLocked, isUploading, processUploadedFiles]
  );

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input;
      if (!messageText.trim() || composerLocked) return;
      // Include unsent positive document evidence only for its owning thread.
      const pendingDocFolder = currentThreadId
        ? pendingDocFoldersRef.current.get(currentThreadId)
        : undefined;
      const pending: PendingDocumentFolder | undefined =
        currentThreadId && pendingDocFolder
          ? { threadId: currentThreadId, docFolder: pendingDocFolder }
          : undefined;
      const currentDocumentAvailability = availabilityForCurrentThread({
        availability: documentAvailability,
        evidence: availabilityEvidence,
        threadId: currentThreadId,
      });
      const clearsPendingDocumentEvidence =
        !!currentThreadId &&
        (currentDocumentAvailability === true ||
          (currentDocumentAvailability === null && pending));
      let didAccept = false;
      submitResearchMessage({
        message: messageText,
        noWeb: !webSearchEnabled,
        availability: currentDocumentAvailability,
        threadId: currentThreadId,
        pendingDocument: pending,
        onAccepted: () => {
          if (didAccept || !clearsPendingDocumentEvidence || !currentThreadId) {
            return;
          }
          didAccept = true;
          pendingDocFoldersRef.current.delete(currentThreadId);
        },
        sendMessage,
      });
      recordSubmittedInput(messageText);
      clearInput();
    },
    [
      input,
      composerLocked,
      sendMessage,
      clearInput,
      recordSubmittedInput,
      webSearchEnabled,
      currentThreadId,
      documentAvailability,
      availabilityEvidence,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (composerLocked) return;

      // IME composition uses Enter to confirm characters; do not submit yet.
      const nativeEvent = e.nativeEvent as KeyboardEvent;
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }

      if (handleHistoryKeyDown(e)) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleHistoryKeyDown, handleSubmit, composerLocked]
  );

  const processedMessages = useProcessedMessages(messages, interrupt);
  const parallelResearchProgress = useMemo(
    () => selectParallelResearchProgress(processedMessages),
    [processedMessages]
  );

  const displayTodos = useMemo(() => {
    const hasPending = todos.some((t) => t.status === "pending");
    const hasVerificationTask = todos.some(
      (t) =>
        t.content?.toLowerCase().includes("verif") ||
        t.id?.toLowerCase().includes("verif")
    );
    const shouldMarkStaleInProgressAsCompleted =
      !isLoading &&
      !interrupt &&
      todos.length > 0 &&
      !hasPending &&
      !hasVerificationTask;

    if (!shouldMarkStaleInProgressAsCompleted) {
      return todos;
    }

    return todos.map((todo) =>
      todo.status === "in_progress"
        ? {
            ...todo,
            status: "completed" as const,
          }
        : todo
    );
  }, [todos, isLoading, interrupt]);

  const groupedTodos = {
    in_progress: displayTodos.filter((t) => t.status === "in_progress"),
    pending: displayTodos.filter((t) => t.status === "pending"),
    completed: displayTodos.filter((t) => t.status === "completed"),
  };

  const hasRunningTasks = useMemo(
    () =>
      displayTodos.length > 0 &&
      displayTodos.some((todo) => todo.status !== "completed"),
    [displayTodos]
  );

  const verificationTodo = useMemo(() => {
    return displayTodos.find(
      (t) =>
        t.status === "in_progress" &&
        (t.content?.toLowerCase().includes("verif") ||
          t.id?.toLowerCase().includes("verif"))
    );
  }, [displayTodos]);

  const verificationRound = useMemo(() => {
    if (!verificationTodo) return null;
    const match = verificationTodo.content.match(
      /round\s*(\d+)\s*(?:of|of)\s*(\d+)/i
    );
    if (match)
      return { current: parseInt(match[1]), total: parseInt(match[2]) };
    return { current: 1, total: 2 };
  }, [verificationTodo]);

  const latestTurnDurationSeconds = useMemo(() => {
    // If tasks are still running, show live elapsed time.
    if (hasRunningTasks && liveElapsedMs > 0) {
      return liveElapsedMs / 1000;
    }

    // If all tasks completed, use locally tracked elapsed seconds.
    if (!hasRunningTasks && typeof chatElapsedSeconds === "number") {
      return Number.isFinite(chatElapsedSeconds) ? chatElapsedSeconds : null;
    }

    // Fallback to client-side turn timings.
    const timings = Object.values(messageTimings).filter(
      (t) => t.completedAt != null && t.durationMs != null
    );
    if (timings.length === 0) return null;
    const latest = timings.reduce((a, b) =>
      (b.completedAt || 0) > (a.completedAt || 0) ? b : a
    );
    const secs = (latest.durationMs || 0) / 1000;
    return isNaN(secs) ? null : secs;
  }, [messageTimings, liveElapsedMs, hasRunningTasks, chatElapsedSeconds]);

  const durationByMessageId = useMemo(() => {
    const durations: Record<string, number> = {};

    const timedTurns = Object.entries(messageTimings)
      .filter(([, timing]) => timing.durationMs != null)
      .sort(([turnA], [turnB]) => {
        const a = Number(turnA.replace("turn-", ""));
        const b = Number(turnB.replace("turn-", ""));
        return a - b;
      });

    if (timedTurns.length === 0) {
      return durations;
    }

    const humanMessages = messages.filter((m) => m.type === "human" && m.id);
    if (humanMessages.length === 0) {
      return durations;
    }

    // Timings are tracked for turns sent in this client session, so align them
    // with the most recent human messages in the thread.
    const startIndex = Math.max(0, humanMessages.length - timedTurns.length);
    const timedHumanMessages = humanMessages.slice(startIndex);

    timedHumanMessages.forEach((humanMessage, index) => {
      const [, timing] = timedTurns[index] ?? [];
      if (!timing?.durationMs || !humanMessage?.id) {
        return;
      }

      const humanIndex = messages.findIndex((m) => m.id === humanMessage.id);
      if (humanIndex === -1) {
        return;
      }

      let nextHumanIndex = messages.length;
      for (let i = humanIndex + 1; i < messages.length; i++) {
        if (messages[i].type === "human") {
          nextHumanIndex = i;
          break;
        }
      }

      let targetAiMessageId: string | null = null;
      for (let i = humanIndex + 1; i < nextHumanIndex; i++) {
        if (messages[i].type === "ai") {
          const aiMessageId = messages[i].id;
          if (typeof aiMessageId === "string") {
            targetAiMessageId = aiMessageId;
          }
        }
      }

      if (!targetAiMessageId) {
        return;
      }

      durations[targetAiMessageId] = timing.durationMs / 1000;
    });

    return durations;
  }, [messageTimings, messages]);

  const hasTasks = displayTodos.length > 0;
  const hasFiles = Object.keys(files).length > 0;

  // Parse out any action requests or review configs from the interrupt
  const actionRequestsMap: Map<string, ActionRequest> | null = useMemo(() => {
    const actionRequests =
      interrupt?.value && (interrupt.value as any)["action_requests"];
    if (!actionRequests) return new Map<string, ActionRequest>();
    return new Map(actionRequests.map((ar: ActionRequest) => [ar.name, ar]));
  }, [interrupt]);

  const reviewConfigsMap: Map<string, ReviewConfig> | null = useMemo(() => {
    const reviewConfigs =
      interrupt?.value && (interrupt.value as any)["review_configs"];
    if (!reviewConfigs) return new Map<string, ReviewConfig>();
    return new Map(
      reviewConfigs.map((rc: ReviewConfig) => [rc.actionName, rc])
    );
  }, [interrupt]);

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)] backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-xl bg-background/90 px-8 py-6 shadow-lg">
            <Paperclip
              size={32}
              className="text-[var(--color-primary)]"
            />
            <span className="text-sm font-semibold text-foreground">
              Drop files to upload
            </span>
            <span className="text-xs text-muted-foreground">
              Files will be attached to this thread
            </span>
          </div>
        </div>
      )}
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          id="chat-content"
          order={1}
          defaultSize={documentViewerState || selectedFile ? 60 : 100}
          className="relative flex min-w-0 flex-col"
        >
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
            ref={scrollRef}
          >
            <div
              className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4"
              ref={contentRef}
            >
              {isThreadLoading ? (
                <div className="flex flex-col gap-4 p-4">
                  {/* Assistant message skeleton */}
                  <div className="flex w-full gap-3">
                    <div className="skeleton-shimmer h-8 w-8 flex-shrink-0 rounded-full" />
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="skeleton-shimmer h-4 w-3/4 rounded-md" />
                      <div className="skeleton-shimmer h-4 w-1/2 rounded-md" />
                      <div className="skeleton-shimmer h-4 w-2/3 rounded-md" />
                    </div>
                  </div>
                  {/* User message skeleton */}
                  <div className="flex w-full flex-row-reverse">
                    <div className="w-[70%] max-w-[400px]">
                      <div className="skeleton-shimmer h-20 rounded-xl rounded-br-none" />
                    </div>
                  </div>
                  {/* Assistant message skeleton */}
                  <div className="flex w-full gap-3">
                    <div className="skeleton-shimmer h-8 w-8 flex-shrink-0 rounded-full" />
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="skeleton-shimmer h-4 w-full rounded-md" />
                      <div className="skeleton-shimmer h-4 w-5/6 rounded-md" />
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {streamError && (
                    <div className="mx-auto mb-4 max-w-[1024px] rounded-lg border border-red-200 bg-red-50 p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                        <div className="flex-1 overflow-hidden">
                          <h3 className="mb-1 text-sm font-semibold text-red-800">
                            {streamError.name === "RateLimitError"
                              ? "Rate Limit Reached"
                              : "Backend Error"}
                          </h3>
                          <div className="max-h-96 overflow-y-auto rounded-md bg-red-100 p-3">
                            <pre className="whitespace-pre-wrap break-all text-xs text-red-900">
                              {streamError.message || String(streamError)}
                            </pre>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={clearStreamError}
                              className="border-red-200 bg-white text-red-700 hover:bg-red-50"
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {processedMessages.map((data, index) => {
                    const messageUi = ui?.filter(
                      (u: any) => u.metadata?.message_id === data.message.id
                    );
                    const isLastMessage =
                      index === processedMessages.length - 1;
                    return (
                      <ChatMessage
                        key={data.message.id}
                        message={data.message}
                        durationSeconds={
                          data.message.type === "ai" && data.message.id
                            ? durationByMessageId[data.message.id]
                            : undefined
                        }
                        isProcessing={
                          data.message.type === "human" &&
                          typeof data.message.id === "string" &&
                          data.message.id === processingHumanMessageId
                        }
                        toolCalls={data.toolCalls}
                        isLoading={isLoading}
                        actionRequestsMap={
                          isLastMessage ? actionRequestsMap : undefined
                        }
                        reviewConfigsMap={
                          isLastMessage ? reviewConfigsMap : undefined
                        }
                        ui={messageUi}
                        stream={stream}
                        onResumeInterrupt={resumeInterrupt}
                        graphId={assistant?.graph_id}
                        onDocumentClick={handleDocumentClick}
                      />
                    );
                  })}
                </>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 bg-background">
            <div
              className={cn(
                "mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
                "mx-auto w-[calc(100%-32px)] max-w-[1024px] transition-colors duration-200 ease-in-out"
              )}
            >
              {(hasTasks || hasFiles || documents.length > 0) && (
                <div className="flex max-h-96 flex-col overflow-y-auto border-b border-border bg-sidebar empty:hidden">
                  {!metaOpen && (
                    <>
                      {verificationTodo && (
                        <div className="flex items-center gap-3 border-b border-border/50 bg-accent/30 px-[18px] py-2.5">
                          <Search className="h-4 w-4 flex-shrink-0 animate-pulse text-primary" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-foreground">
                                {verificationTodo.content}
                              </span>
                              {verificationRound && (
                                <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                                  Round {verificationRound.current} of{" "}
                                  {verificationRound.total}
                                </span>
                              )}
                            </div>
                            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-700 ease-in-out"
                                style={{
                                  width: verificationRound
                                    ? `${
                                        (verificationRound.current /
                                          verificationRound.total) *
                                        100
                                      }%`
                                    : "50%",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      {(() => {
                        const activeTask = displayTodos.find(
                          (t) => t.status === "in_progress"
                        );

                        const totalTasks = displayTodos.length;
                        const isCompleted =
                          totalTasks > 0 &&
                          groupedTodos.completed.length === totalTasks &&
                          !isLoading;

                        const tasksTrigger = (() => {
                          if (!hasTasks) return null;
                          return (
                            <button
                              type="button"
                              onClick={() =>
                                setMetaOpen((prev) =>
                                  prev === "tasks" ? null : "tasks"
                                )
                              }
                              className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left"
                              {...getAriaExpandedProps(metaOpen === "tasks")}
                            >
                              {(() => {
                                const parallelResearchLabel =
                                  parallelResearchProgress &&
                                  `Parallel research: ${parallelResearchProgress.completed}/${parallelResearchProgress.total} complete`;

                                if (isCompleted) {
                                  return [
                                    <CheckCircle
                                      key="icon"
                                      size={16}
                                      className="text-success/80"
                                    />,
                                    <span
                                      key="label"
                                      className="ml-[1px] min-w-0 truncate text-sm"
                                    >
                                      {parallelResearchLabel ??
                                        "All tasks completed."}
                                    </span>,
                                    <span
                                      key="duration"
                                      className="min-w-0 truncate text-sm text-muted-foreground"
                                    >
                                      {latestTurnDurationSeconds != null
                                        ? "(Total for " +
                                          latestTurnDurationSeconds.toFixed(1) +
                                          " seconds)"
                                        : ""}
                                    </span>,
                                  ];
                                }

                                if (activeTask != null) {
                                  return [
                                    <div key="icon">
                                      {getStatusIcon(activeTask.status)}
                                    </div>,
                                    <span
                                      key="label"
                                      className="ml-[1px] min-w-0 truncate text-sm"
                                    >
                                      {parallelResearchLabel ?? (
                                        <>
                                          Task{" "}
                                          {totalTasks -
                                            groupedTodos.pending.length}{" "}
                                          of {totalTasks}
                                        </>
                                      )}
                                    </span>,
                                    <div
                                      key="content"
                                      className="flex min-w-0 items-center justify-between gap-2"
                                    >
                                      <span className="min-w-0 truncate text-sm text-muted-foreground">
                                        {activeTask.content}
                                      </span>
                                      {hasRunningTasks &&
                                        latestTurnDurationSeconds != null && (
                                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                                            {latestTurnDurationSeconds.toFixed(
                                              1
                                            )}
                                            s
                                          </span>
                                        )}
                                    </div>,
                                  ];
                                }

                                return [
                                  <Circle
                                    key="icon"
                                    size={16}
                                    className="text-muted-foreground/70"
                                  />,
                                  <span
                                    key="label"
                                    className="ml-[1px] min-w-0 truncate text-sm"
                                  >
                                    {parallelResearchLabel ?? (
                                      <>
                                        Task{" "}
                                        {totalTasks -
                                          groupedTodos.pending.length}{" "}
                                        of {totalTasks}
                                      </>
                                    )}
                                  </span>,
                                ];
                              })()}
                            </button>
                          );
                        })();

                        const filesTrigger = (() => {
                          if (!hasFiles) return null;
                          return (
                            <button
                              type="button"
                              onClick={() =>
                                setMetaOpen((prev) =>
                                  prev === "files" ? null : "files"
                                )
                              }
                              className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm"
                              {...getAriaExpandedProps(metaOpen === "files")}
                            >
                              <FileIcon size={16} />
                              Files (State)
                              <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                                {Object.keys(files).length}
                              </span>
                            </button>
                          );
                        })();

                        const docsTrigger = (() => {
                          if (documents.length === 0) return null;
                          return (
                            <button
                              type="button"
                              onClick={() =>
                                setMetaOpen((prev) =>
                                  prev === "documents" ? null : "documents"
                                )
                              }
                              className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm"
                              {...getAriaExpandedProps(
                                metaOpen === "documents"
                              )}
                            >
                              <FileText size={16} />
                              Docs
                              <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                                {documents.length}
                              </span>
                            </button>
                          );
                        })();

                        const wikiTrigger = (() => {
                          if (!hasCurrentWikiDocuments) return null;
                          return (
                            <button
                              type="button"
                              onClick={() =>
                                setMetaOpen((prev) =>
                                  prev === "wiki" ? null : "wiki"
                                )
                              }
                              className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm"
                              {...getAriaExpandedProps(metaOpen === "wiki")}
                            >
                              <Database
                                size={16}
                                className="text-primary"
                              />
                              Wiki
                              {selectedWikiFileCount !== null && (
                                <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                                  {selectedWikiFileCount}
                                </span>
                              )}
                            </button>
                          );
                        })();

                        return (
                          <div className="flex w-full min-w-0 items-center justify-between overflow-hidden">
                            <div className="min-w-0 flex-1">{tasksTrigger}</div>
                            <div className="flex flex-shrink-0 items-center">
                              {filesTrigger}
                              {docsTrigger}
                              {wikiTrigger}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {metaOpen && (
                    <>
                      <div className="sticky top-0 z-20 flex items-stretch border-b border-border bg-sidebar text-sm shadow-xs">
                        {hasTasks && (
                          <button
                            type="button"
                            className="py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "tasks" ? null : "tasks"
                              )
                            }
                            {...getAriaExpandedProps(metaOpen === "tasks")}
                          >
                            Tasks
                          </button>
                        )}
                        {hasFiles && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "files" ? null : "files"
                              )
                            }
                            {...getAriaExpandedProps(metaOpen === "files")}
                          >
                            Files (State)
                            <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                              {Object.keys(files).length}
                            </span>
                          </button>
                        )}
                        {documents.length > 0 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "documents" ? null : "documents"
                              )
                            }
                            {...getAriaExpandedProps(metaOpen === "documents")}
                          >
                            Documents
                            <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                              {documents.length}
                            </span>
                          </button>
                        )}
                        {hasCurrentWikiDocuments && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                            onClick={() =>
                              setMetaOpen((prev) =>
                                prev === "wiki" ? null : "wiki"
                              )
                            }
                            {...getAriaExpandedProps(metaOpen === "wiki")}
                          >
                            Wiki
                            {selectedWikiFileCount !== null && (
                              <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                                {selectedWikiFileCount}
                              </span>
                            )}
                          </button>
                        )}
                        <button
                          aria-label="Close"
                          className="flex-1"
                          onClick={() => setMetaOpen(null)}
                        />
                      </div>
                      <div
                        ref={tasksContainerRef}
                        className={cn(
                          "px-[18px]",
                          metaOpen === "tasks" && "py-2"
                        )}
                      >
                        {metaOpen === "tasks" &&
                          Object.entries(groupedTodos)
                            .filter(([_, todos]) => todos.length > 0)
                            .map(([status, todos]) => (
                              <div
                                key={status}
                                className="mb-4 last:mb-0"
                              >
                                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-tertiary">
                                  {
                                    {
                                      pending: "Pending",
                                      in_progress: "In Progress",
                                      completed: "Completed",
                                    }[status]
                                  }
                                </h3>
                                <div className="grid grid-cols-[auto_1fr] gap-3 rounded-sm p-1 pl-0 text-sm">
                                  {todos.map((todo, index) => (
                                    <Fragment
                                      key={`${status}_${todo.id}_${index}`}
                                    >
                                      {getStatusIcon(todo.status, "mt-0.5")}
                                      <span className="break-words text-inherit">
                                        {todo.content}
                                      </span>
                                    </Fragment>
                                  ))}
                                </div>
                              </div>
                            ))}

                        {metaOpen === "files" && (
                          <div className="mb-6">
                            <FilesPopover
                              files={files}
                              setFiles={setFiles}
                              editDisabled={
                                isLoading || interrupt !== undefined
                              }
                              onDocumentClick={handleDocumentClick}
                              onFileClick={handleFileClick}
                            />
                          </div>
                        )}

                        {metaOpen === "documents" && (
                          <div className="mb-6">
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(256px,1fr))] gap-2">
                              {documents.map((doc) => (
                                <div
                                  key={doc.name}
                                  className="group relative flex flex-col items-center justify-center space-y-1 truncate rounded-md border border-border px-2 py-3 shadow-sm transition-colors"
                                  style={{
                                    backgroundColor: "var(--color-file-button)",
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDocumentClick(`/${doc.name}`)
                                    }
                                    className="flex w-full cursor-pointer flex-col items-center justify-center space-y-1"
                                    title={`View ${doc.name}`}
                                  >
                                    <FileText
                                      size={24}
                                      className="mx-auto text-muted-foreground"
                                    />
                                    <span className="mx-auto block w-full truncate break-words px-1 text-center text-sm leading-relaxed text-foreground">
                                      {doc.name}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {(doc.size / 1024).toFixed(1)} KB
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteDocument(doc.name);
                                    }}
                                    className="absolute right-1.5 top-1.5 hidden items-center justify-center rounded-full bg-destructive/10 p-1 text-destructive transition-colors hover:bg-destructive/20 group-hover:flex"
                                    title="Delete document"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {metaOpen === "wiki" && hasCurrentWikiDocuments && (
                          <div className="my-3 h-80 overflow-hidden rounded-md border border-border bg-card/40">
                            <WikiTreeViewer
                              threadId={currentThreadId}
                              onSelectFile={handleFileClick}
                              onFileCountChange={handleWikiFileCountChange}
                            />
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
              {(isUploading || isIngesting || ingestError) && (
                <div className="mx-[18px] mb-3 mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      {ingestError ? (
                        <>
                          <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                          <span className="font-semibold tracking-wide text-red-600 dark:text-red-400">
                            Ingestion failed
                          </span>
                        </>
                      ) : isUploading ? (
                        <>
                          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
                          <span className="font-semibold tracking-wide text-foreground/90">
                            Uploading document...
                          </span>
                        </>
                      ) : (
                        <>
                          <div className="h-1.5 w-1.5 animate-ping rounded-full bg-emerald-400" />
                          <span className="font-semibold tracking-wide text-foreground/90">
                            Ingesting documents
                            {ingestCurrentSource ? (
                              <span className="font-normal text-muted-foreground">
                                {" "}
                                · {ingestCurrentSource}
                              </span>
                            ) : ingestPhase &&
                              ingestPhase !== "initializing" ? (
                              <span className="font-normal text-muted-foreground">
                                {" "}
                                · {ingestPhase.replace(/_/g, " ")}
                              </span>
                            ) : (
                              <span className="font-normal text-muted-foreground">
                                {" "}
                                · initializing…
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isUploading && uploadElapsedMs > 0 && (
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {(uploadElapsedMs / 1000).toFixed(3)}s
                        </span>
                      )}
                      {!isUploading &&
                        !ingestError &&
                        ingestElapsed != null && (
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {ingestElapsed < 60
                              ? `${ingestElapsed.toFixed(3)}s`
                              : `${Math.floor(ingestElapsed / 60)}m ${(
                                  ingestElapsed % 60
                                ).toFixed(3)}s`}
                          </span>
                        )}
                      {!isUploading &&
                        !ingestError &&
                        ingestProgress !== null && (
                          <span className="bg-secondary/15 rounded px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/90">
                            {ingestProgress}%
                          </span>
                        )}
                    </div>
                  </div>

                  <div className="bg-secondary/10 relative h-3 w-full overflow-hidden rounded-full border border-border/20 p-[2px] shadow-inner backdrop-blur-sm dark:bg-white/5">
                    {isUploading ? (
                      <div className="relative h-full w-full rounded-full bg-gradient-to-r from-[#51a3d5] to-[#1155cc] dark:from-[#2dd4bf] dark:to-[#1155cc]">
                        <div className="progress-bar-animated absolute inset-0 rounded-full opacity-45" />
                      </div>
                    ) : (
                      <div
                        className="relative h-full rounded-full bg-gradient-to-r from-[#51a3d5] to-[#1155cc] shadow-[0_0_8px_rgba(81,163,213,0.3)] transition-all duration-500 ease-out dark:from-[#2dd4bf] dark:to-[#1155cc]"
                        style={{ width: `${ingestProgress ?? 0}%` }}
                      >
                        <div className="progress-bar-animated absolute inset-0 rounded-full opacity-45" />
                        {(ingestProgress ?? 0) > 0 && (
                          <div className="absolute right-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_#fff]" />
                        )}
                      </div>
                    )}
                  </div>
                  {/* Detail line: shows current operation or per-source progress */}
                  {!isUploading && ingestDetail && (
                    <p className="mt-1.5 truncate text-[10px] leading-tight text-muted-foreground">
                      {ingestDetail}
                    </p>
                  )}
                  {/* Error message box */}
                  {ingestError && (
                    <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-950/30">
                      <p className="break-words text-xs leading-relaxed text-red-700 dark:text-red-300">
                        {ingestError}
                      </p>
                      <p className="mt-1 text-[10px] text-red-500 dark:text-red-400">
                        Try uploading a smaller document or increasing
                        WIKI_AGENT_RECURSION_LIMIT.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <form
                onSubmit={handleSubmit}
                className="flex flex-col"
              >
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isUploading
                      ? "Uploading document, please wait..."
                      : isIngesting
                      ? "Ingesting documents, please wait..."
                      : showRunningMode
                      ? "Running..."
                      : "Write your message..."
                  }
                  disabled={composerLocked}
                  className="font-inherit max-h-[240px] w-full resize-none overflow-y-auto border-0 bg-transparent px-[18px] pb-[13px] pt-[14px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary"
                  rows={1}
                />
                <div className="flex justify-between gap-2 p-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setWebSearchEnabled((prev) => !prev)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200",
                        webSearchEnabled
                          ? "border-[color-mix(in_srgb,var(--color-primary)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)]"
                          : "hover:bg-secondary/10 border-border bg-transparent text-tertiary hover:text-secondary"
                      )}
                    >
                      <Globe
                        size={14}
                        className={
                          webSearchEnabled
                            ? "text-[var(--color-primary)]"
                            : "text-tertiary"
                        }
                      />
                      <span>Search</span>
                    </button>
                    <span className="self-center text-xxs italic text-[color:color-mix(in_srgb,var(--color-text-tertiary)_72%,white)]">
                      <b className="text-inherit">Enter</b> to send,{" "}
                      <b className="text-inherit">Shift+Enter</b> for new line,{" "}
                      <b className="text-inherit">↑/↓</b> history,{" "}
                      <b className="text-inherit">Esc</b> to clear
                    </span>
                  </div>
                  <div className="flex justify-end gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      multiple
                      className="hidden"
                    />
                    {input.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          clearInput();
                          setTimeout(() => textareaRef.current?.focus(), 50);
                        }}
                        disabled={composerLocked}
                        title="Clear input text"
                        className={cn(
                          "flex items-center justify-center rounded-full border border-transparent p-2 transition-all duration-200",
                          composerLocked
                            ? "text-tertiary/40 cursor-not-allowed"
                            : "text-tertiary hover:bg-destructive/10 hover:text-destructive"
                        )}
                      >
                        <Trash2 size={18} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleAttachClick}
                      disabled={composerLocked || isUploading}
                      title={isUploading ? "Uploading..." : "Attach files"}
                      className={cn(
                        "flex items-center justify-center rounded-full border border-transparent p-2 transition-all duration-200",
                        composerLocked || isUploading
                          ? "text-tertiary/40 cursor-not-allowed"
                          : "hover:bg-secondary/10 text-tertiary hover:text-primary"
                      )}
                    >
                      <Paperclip
                        size={18}
                        className={isUploading ? "animate-pulse" : ""}
                      />
                    </button>
                    <Button
                      type={isLoading ? "button" : "submit"}
                      variant={isLoading ? "destructive" : "default"}
                      onClick={isLoading ? stopStream : handleSubmit}
                      disabled={
                        !isLoading &&
                        (composerLocked || showRunningMode || !input.trim())
                      }
                    >
                      {isLoading ? (
                        <>
                          <Square size={14} />
                          <span>Stop</span>
                        </>
                      ) : showRunningMode ? (
                        <>
                          <Clock size={14} />
                          <span>Running</span>
                        </>
                      ) : (
                        <>
                          <ArrowUp size={18} />
                          <span>Send</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </ResizablePanel>
        {(documentViewerState || selectedFile) && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="doc-viewer"
              order={2}
              defaultSize={40}
              minSize={30}
              className="relative flex flex-col border-l border-border bg-background/50"
            >
              {documentViewerState && currentThreadId ? (
                <DocumentViewerPanel
                  state={documentViewerState}
                  threadId={currentThreadId}
                  onClose={() => setDocumentViewerState(null)}
                />
              ) : selectedFile ? (
                <FileViewPanel
                  file={selectedFile}
                  onSaveFile={async (fileName, content) => {
                    await setFiles({ ...files, [fileName]: content });
                    setSelectedFile({ path: fileName, content });
                  }}
                  onClose={() => setSelectedFile(null)}
                  editDisabled={isLoading || interrupt !== undefined}
                  onDocumentClick={handleDocumentClick}
                />
              ) : null}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Skills Tab Trigger Button (Fixed/Absolute to right edge of chat) */}
      {!skillsDrawerOpen && (
        <button
          onClick={() => setSkillsDrawerOpen(true)}
          className={cn(
            "absolute right-0 top-[20%] z-30 flex items-center gap-1.5 rounded-l-md border-y border-l border-border bg-sidebar px-2 py-3 text-xs font-semibold text-foreground shadow-md transition-all duration-200",
            "hover:border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] hover:text-[var(--color-primary)]",
            "skills-drawer-tab"
          )}
          title="Open Skills (Cmd+K)"
        >
          <Sparkles
            size={13}
            className="rotate-180 text-[var(--color-primary)]"
          />
          <span>Skills</span>
        </button>
      )}

      {/* Skills right drawer */}
      <SkillsDrawer
        open={skillsDrawerOpen}
        onClose={() => setSkillsDrawerOpen(false)}
        onSelectSkill={handleSkillSelect}
      />
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
