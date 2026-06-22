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
} from "lucide-react";
import { useClient } from "@/providers/ClientProvider";
import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";
import { ChatMessage } from "@/app/components/ChatMessage";
import type {
  TodoItem,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import { extractStringFromMessageContent } from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import { useThreadStatus } from "@/app/hooks/useThreads";
import { useQueryState } from "nuqs";

interface ChatInterfaceProps {
  assistant: Assistant | null;
}

const parseToolArgs = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Fall through to raw string wrapper below.
      }
    }

    return { raw: value };
  }

  return {};
};

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
          className={cn("text-tertiary/70", className)}
        />
      );
  }
};

export const ChatInterface = React.memo<ChatInterfaceProps>(({ assistant }) => {
  const [currentThreadId, setCurrentThreadId] = useQueryState("threadId");
  const [metaOpen, setMetaOpen] = useState<"tasks" | "files" | "documents" | null>(null);
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [input, setInput] = useState("");
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
    setFiles,
    isLoading,
    isThreadLoading,
    interrupt,
    sendMessage,
    stopStream,
    resumeInterrupt,
    no_web,
  } = useChatContext();

  const {
    data: selectedThreadStatus,
    isLoading: isSelectedThreadStatusLoading,
  } = useThreadStatus(currentThreadId);

  const client = useClient();
  const [documents, setDocuments] = useState<Array<{ name: string; size: number }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [ingestProgress, setIngestProgress] = useState<number | null>(null);
  const [ingestPhase, setIngestPhase] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const sseAbortRef = useRef<AbortController | null>(null);
  const currentThreadIdRef = useRef(currentThreadId);
  currentThreadIdRef.current = currentThreadId;
  // Tracks a pending doc_folder that couldn't be set via updateState
  // because the thread had no graph_id yet (no runs). It will be included
  // in the first sendMessage call instead.
  const pendingDocFolderRef = useRef<{ threadId: string; docFolder: string } | null>(null);

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
    setIngestProgress(0);
    setIngestPhase("initializing");

    (async () => {
      try {
        const response = await fetch(
          `${deploymentUrl}/threads/${threadId}/wiki/progress`,
          { headers: { "X-API-Key": token }, signal: controller.signal }
        );
        if (!response.ok || !response.body) { setIsIngesting(false); return; }

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
            try {
              const payload = JSON.parse(dataMatch[1]);
              if ((evtMatch?.[1] ?? "progress") === "end") {
                setIngestProgress(payload.wiki_ready ? 100 : null);
                setIngestPhase(payload.wiki_ready ? "ready" : null);
                setIsIngesting(false);
                return;
              }
              setIngestProgress(typeof payload.progress === "number" ? payload.progress : null);
              setIngestPhase(payload.phase ?? "processing");
              setIsIngesting(true);
            } catch { /* ignore malformed frames */ }
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
      setIngestProgress(null);
      setIngestPhase(null);
      if (sseAbortRef.current) sseAbortRef.current.abort();
      return;
    }

    let active = true;

    const appConfig = getConfig();
    const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
    const token = getBrowserSessionToken();

    fetch(`${deploymentUrl}/threads/${currentThreadId}/wiki/status`, {
      headers: { "X-API-Key": token },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data.is_active) {
          startIngestProgressStream(currentThreadId);
        } else {
          setIngestProgress(data.wiki_ready ? 100 : null);
          setIngestPhase(data.wiki_ready ? "ready" : null);
          setIsIngesting(false);
        }
      })
      .catch(() => {
        if (active) setIsIngesting(false);
      });

    return () => {
      active = false;
      if (sseAbortRef.current) sseAbortRef.current.abort();
    };
  }, [currentThreadId, startIngestProgressStream]);

  const fetchDocuments = useCallback(
    async (overrideThreadId?: string | null) => {
      const threadIdAtStart =
        overrideThreadId !== undefined ? overrideThreadId : currentThreadId;
      if (!threadIdAtStart) {
        setDocuments([]);
        return;
      }

      try {
        const appConfig = getConfig();
        const deploymentUrl = appConfig?.deploymentUrl || "";
        const token = getBrowserSessionToken();

        const response = await fetch(
          `${deploymentUrl.replace(/\/+$/, "")}/documents/list?folder=threads/${threadIdAtStart}`,
          {
            headers: {
              "X-API-Key": token,
            },
          }
        );

        if (threadIdAtStart !== currentThreadIdRef.current) {
          return;
        }

        if (response.status === 404) {
          setDocuments([]);
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to list documents: ${response.status}`);
        }

        const data = await response.json();
        const docs = (data.items || []).filter(
          (item: any) => item.type === "file"
        );

        if (threadIdAtStart !== currentThreadIdRef.current) {
          return;
        }

        setDocuments(docs);
      } catch (error) {
        console.error("Failed to fetch documents:", error);
      }
    },
    [currentThreadId]
  );

  useEffect(() => {
    fetchDocuments();
  }, [currentThreadId, fetchDocuments]);

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setIsUploading(true);
    try {
      let activeThreadId = currentThreadId;
      let isNewThread = false;

      const getGraphId = (graphId?: string) => {
        if (!graphId || graphId === "researcher") return "research";
        return graphId;
      };

      if (!activeThreadId) {
        const newThread = await client.threads.create({
          metadata: {
            graph_id: getGraphId(assistant?.graph_id),
          },
        });
        activeThreadId = newThread.thread_id;
        isNewThread = true;
      } else {
        try {
          await client.threads.update(activeThreadId, {
            metadata: {
              graph_id: getGraphId(assistant?.graph_id),
            },
          });
        } catch (e) {
          console.warn("Failed to update thread metadata:", e);
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

      const response = await fetch(`${deploymentUrl.replace(/\/+$/, "")}/documents/upload`, {
        method: "POST",
        headers: {
          "X-API-Key": token,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed with status: ${response.status}`);
      }

      // Set the doc_folder state in the thread values so the agent uses this folder for research
      try {
        await client.threads.updateState(activeThreadId, {
          values: {
            doc_folder: `docs/threads/${activeThreadId}`,
          },
        });
      } catch (e) {
        // updateState fails when the thread has no graph_id yet (no runs).
        // Store it as pending so it gets included in the first sendMessage call.
        console.warn("Failed to set doc_folder in thread state (will retry on first message):", e);
        pendingDocFolderRef.current = {
          threadId: activeThreadId,
          docFolder: `docs/threads/${activeThreadId}`,
        };
      }

      // Note: wiki ingestion is auto-triggered by the server (webapp.py) on upload.
      // No need to explicitly call /wiki/ingest here — the server registers
      // progress in _active_ingests and /wiki/status will track it.

      // Clear the input value so the same file can be uploaded again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (isNewThread) {
        currentThreadIdRef.current = activeThreadId;
        await setCurrentThreadId(activeThreadId);
      }

      // Refresh doc list and start SSE stream for real-time ingest progress.
      fetchDocuments(activeThreadId);
      startIngestProgressStream(activeThreadId);
    } catch (error) {
      console.error("Failed to upload files:", error);
      alert(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteDocument = async (filename: string) => {
    if (!currentThreadId) return;

    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      const appConfig = getConfig();
      const deploymentUrl = appConfig?.deploymentUrl || "";
      const token = getBrowserSessionToken();

      const response = await fetch(
        `${deploymentUrl.replace(/\/+$/, "")}/documents/${encodeURIComponent(filename)}?folder=threads/${currentThreadId}`,
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

      fetchDocuments(currentThreadId);
    } catch (error) {
      console.error("Failed to delete document:", error);
      alert(`Delete failed: ${error instanceof Error ? error.message : String(error)}`);
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
    isLoading || isSelectedThreadBusy || isResolvingSelectedThreadStatus || isIngesting;

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input;
      if (!messageText.trim() || composerLocked) return;
      const stateUpdates: Record<string, any> = { no_web: !webSearchEnabled };
      // Include pending doc_folder from a prior file upload that couldn't
      // set thread state because no graph_id had been assigned yet.
      // Only apply if it belongs to the current thread.
      const pending = pendingDocFolderRef.current;
      if (pending && pending.threadId === currentThreadId) {
        stateUpdates.doc_folder = pending.docFolder;
        pendingDocFolderRef.current = null;
      }
      sendMessage(messageText, stateUpdates);
      setInput("");
    },
    [input, composerLocked, sendMessage, setInput, webSearchEnabled, currentThreadId]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (composerLocked) return;

      // IME composition uses Enter to confirm characters; do not submit yet.
      const nativeEvent = e.nativeEvent as KeyboardEvent;
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, composerLocked]
  );

  // TODO: can we make this part of the hook?
  const processedMessages = useMemo(() => {
    /*
     1. Loop through all messages
     2. For each AI message, add the AI message, and any tool calls to the messageMap
     3. For each tool message, find the corresponding tool call in the messageMap and update the status and output
    */
    const messageMap = new Map<
      string,
      { message: Message; toolCalls: ToolCall[] }
    >();
    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const toolCallsInMessage: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
          name?: string;
          type?: string;
          args?: unknown;
          input?: unknown;
        }> = [];
        if (
          message.additional_kwargs?.tool_calls &&
          Array.isArray(message.additional_kwargs.tool_calls)
        ) {
          toolCallsInMessage.push(...message.additional_kwargs.tool_calls);
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          toolCallsInMessage.push(
            ...message.tool_calls.filter(
              (toolCall: { name?: string }) => toolCall.name !== ""
            )
          );
        } else if (Array.isArray(message.content)) {
          const toolUseBlocks = message.content.filter(
            (block: { type?: string }) => block.type === "tool_use"
          );
          toolCallsInMessage.push(...toolUseBlocks);
        }
        const toolCallsWithStatus = toolCallsInMessage.map(
          (toolCall: {
            id?: string;
            function?: { name?: string; arguments?: unknown };
            name?: string;
            type?: string;
            args?: unknown;
            input?: unknown;
          }) => {
            const name =
              toolCall.function?.name ||
              toolCall.name ||
              toolCall.type ||
              "unknown";
            const args =
              toolCall.function?.arguments ||
              toolCall.args ||
              toolCall.input ||
              {};
            return {
              id: toolCall.id || `tool-${Math.random()}`,
              name,
              args: parseToolArgs(args),
              status: interrupt ? "interrupted" : ("pending" as const),
            } as ToolCall;
          }
        );
        messageMap.set(message.id!, {
          message,
          toolCalls: toolCallsWithStatus,
        });
      } else if (message.type === "tool") {
        const toolCallId = message.tool_call_id;
        if (!toolCallId) {
          return;
        }
        for (const [, data] of messageMap.entries()) {
          const toolCallIndex = data.toolCalls.findIndex(
            (tc: ToolCall) => tc.id === toolCallId
          );
          if (toolCallIndex === -1) {
            continue;
          }
          data.toolCalls[toolCallIndex] = {
            ...data.toolCalls[toolCallIndex],
            status: "completed" as const,
            result: extractStringFromMessageContent(message),
          };
          break;
        }
      } else if (message.type === "human") {
        messageMap.set(message.id!, {
          message,
          toolCalls: [],
        });
      }
    });
    const processedArray = Array.from(messageMap.values());
    return processedArray.map((data, index) => {
      const prevMessage = index > 0 ? processedArray[index - 1].message : null;
      return {
        ...data,
        showAvatar: data.message.type !== prevMessage?.type,
      };
    });
  }, [messages, interrupt]);

  const displayTodos = useMemo(() => {
    const hasPending = todos.some((t) => t.status === "pending");
    const shouldMarkStaleInProgressAsCompleted =
      !isLoading && !interrupt && todos.length > 0 && !hasPending;

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
  }, [
    messageTimings,
    liveElapsedMs,
    hasRunningTasks,
    chatElapsedSeconds,
  ]);

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
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        ref={scrollRef}
      >
        <div
          className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4"
          ref={contentRef}
        >
          {isThreadLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : streamError ? (
            <div className="mx-auto mb-4 max-w-[1024px] rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                <div className="flex-1 overflow-hidden">
                  <h3 className="mb-1 text-sm font-semibold text-red-800">
                    Backend Error
                  </h3>
                  <div className="max-h-96 overflow-y-auto rounded-md bg-red-100 p-3">
                    <pre className="whitespace-pre-wrap break-all text-xs text-red-900">
                      {streamError.message || String(streamError)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {processedMessages.map((data, index) => {
                const messageUi = ui?.filter(
                  (u: any) => u.metadata?.message_id === data.message.id
                );
                const isLastMessage = index === processedMessages.length - 1;
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
            <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-sidebar empty:hidden">
              {!metaOpen && (
                <>
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
                          className="grid flex-1 min-w-0 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left"
                          {...getAriaExpandedProps(metaOpen === "tasks")}
                        >
                          {(() => {
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
                                  All tasks completed.
                                </span>,
                                <span
                                  key="duration"
                                  className="min-w-0 truncate text-sm text-muted-foreground"
                                >
                                  {latestTurnDurationSeconds != null ? "(Total for " + latestTurnDurationSeconds.toFixed(1) + " seconds)" : ""}
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
                                  Task{" "}
                                  {totalTasks - groupedTodos.pending.length} of{" "}
                                  {totalTasks}
                                </span>,
                                <div
                                  key="content"
                                  className="flex min-w-0 items-center justify-between gap-2"
                                >
                                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                                    {activeTask.content}
                                  </span>
                                  {hasRunningTasks && latestTurnDurationSeconds != null && (
                                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                                      {latestTurnDurationSeconds.toFixed(1)}s
                                    </span>
                                  )}
                                </div>,
                              ];
                            }

                            return [
                              <Circle
                                key="icon"
                                size={16}
                                className="text-tertiary/70"
                              />,
                              <span
                                key="label"
                                className="ml-[1px] min-w-0 truncate text-sm"
                              >
                                Task {totalTasks - groupedTodos.pending.length}{" "}
                                of {totalTasks}
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
                          {...getAriaExpandedProps(metaOpen === "documents")}
                        >
                          <FileText size={16} />
                          Docs
                          <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                            {documents.length}
                          </span>
                        </button>
                      );
                    })();

                    return (
                      <div className="flex justify-between items-center w-full min-w-0 overflow-hidden">
                        <div className="flex-1 min-w-0">
                          {tasksTrigger}
                        </div>
                        <div className="flex flex-shrink-0 items-center">
                          {filesTrigger}
                          {docsTrigger}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}

              {metaOpen && (
                <>
                  <div className="sticky top-0 flex items-stretch bg-sidebar text-sm">
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
                    <button
                      aria-label="Close"
                      className="flex-1"
                      onClick={() => setMetaOpen(null)}
                    />
                  </div>
                  <div
                    ref={tasksContainerRef}
                    className="px-[18px]"
                  >
                    {metaOpen === "tasks" &&
                      Object.entries(groupedTodos)
                        .filter(([_, todos]) => todos.length > 0)
                        .map(([status, todos]) => (
                          <div
                            key={status}
                            className="mb-4"
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
                                <Fragment key={`${status}_${todo.id}_${index}`}>
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
                              <FileText
                                size={24}
                                className="mx-auto text-muted-foreground"
                              />
                              <span className="mx-auto block w-full truncate break-words text-center text-sm leading-relaxed text-foreground px-1">
                                {doc.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {(doc.size / 1024).toFixed(1)} KB
                              </span>
                              
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteDocument(doc.name);
                                }}
                                className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center justify-center p-1 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                                title="Delete document"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          {(isUploading || isIngesting) && (
            <div className="mx-[18px] mt-4 mb-3">
              <div className="flex justify-between items-center text-xs mb-2">
                <div className="flex items-center gap-1.5">
                  {isUploading ? (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
                      <span className="font-semibold text-foreground/90 tracking-wide">Uploading document...</span>
                    </>
                  ) : (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      <span className="font-semibold text-foreground/90 tracking-wide">
                        Ingesting documents
                        {ingestPhase && ingestPhase !== "initializing" ? (
                          <span className="text-muted-foreground font-normal"> · {ingestPhase}</span>
                        ) : (
                          <span className="text-muted-foreground font-normal"> · initializing…</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
                {!isUploading && ingestProgress !== null && (
                  <span className="font-semibold text-foreground/90 tabular-nums bg-secondary/15 px-2 py-0.5 rounded text-[10px]">
                    {ingestProgress}%
                  </span>
                )}
              </div>
              
              <div className="relative w-full bg-secondary/10 dark:bg-white/5 border border-border/20 rounded-full h-3 p-[2px] overflow-hidden backdrop-blur-sm shadow-inner">
                {isUploading ? (
                  <div className="h-full rounded-full bg-gradient-to-r from-[#51a3d5] to-[#1155cc] dark:from-[#2dd4bf] dark:to-[#1155cc] w-full relative">
                    <div className="absolute inset-0 progress-bar-animated rounded-full opacity-45" />
                  </div>
                ) : (
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#51a3d5] to-[#1155cc] dark:from-[#2dd4bf] dark:to-[#1155cc] transition-all duration-500 ease-out relative shadow-[0_0_8px_rgba(81,163,213,0.3)]"
                    style={{ width: `${ingestProgress ?? 0}%` }}
                  >
                    <div className="absolute inset-0 progress-bar-animated rounded-full opacity-45" />
                    {(ingestProgress ?? 0) > 0 && (
                      <div className="absolute right-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_#fff]" />
                    )}
                  </div>
                )}
              </div>
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
              placeholder={isUploading ? "Uploading document, please wait..." : isIngesting ? "Ingesting documents, please wait..." : (showRunningMode ? "Running..." : "Write your message...")}
              disabled={composerLocked}
              className="font-inherit field-sizing-content flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[14px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary"
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
                      : "border-border bg-transparent text-tertiary hover:bg-secondary/10 hover:text-secondary",
                  )}
                >
                  <Globe size={14} className={webSearchEnabled ? "text-[var(--color-primary)]" : "text-tertiary"} />
                  <span>Search</span>
                </button>
                <span className="self-center text-xxs italic text-[color:color-mix(in_srgb,var(--color-text-tertiary)_72%,white)]">
                  <b className="text-inherit">Enter</b> to send, {" "}
                  <b className="text-inherit">Shift+Enter</b> for new line
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
                <button
                  type="button"
                  onClick={handleAttachClick}
                  disabled={composerLocked || isUploading}
                  title={isUploading ? "Uploading..." : "Attach files"}
                  className={cn(
                    "flex items-center justify-center rounded-full p-2 transition-all duration-200 border border-transparent",
                    composerLocked || isUploading
                      ? "text-tertiary/40 cursor-not-allowed"
                      : "text-tertiary hover:text-primary hover:bg-secondary/10"
                  )}
                >
                  <Paperclip size={18} className={isUploading ? "animate-pulse" : ""} />
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
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
