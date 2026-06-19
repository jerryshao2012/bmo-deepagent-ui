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
} from "lucide-react";
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
  const [currentThreadId] = useQueryState("threadId");
  const [metaOpen, setMetaOpen] = useState<"tasks" | "files" | null>(null);
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

  const [webSearchEnabled, setWebSearchEnabled] = useState(true);

  // Sync webSearchEnabled state with the thread's no_web configuration when thread loads or changes
  useEffect(() => {
    if (no_web !== undefined && no_web !== null) {
      setWebSearchEnabled(!no_web);
    } else {
      setWebSearchEnabled(true);
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
    !assistant;
  const showRunningMode =
    isLoading || isSelectedThreadBusy || isResolvingSelectedThreadStatus;

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input;
      if (!messageText.trim() || composerLocked) return;
      sendMessage(messageText, { no_web: !webSearchEnabled });
      setInput("");
    },
    [input, composerLocked, sendMessage, setInput, webSearchEnabled]
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
          {(hasTasks || hasFiles) && (
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
                          className="grid w-full cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left"
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

                    return (
                      <div className="grid grid-cols-[1fr_auto_auto] items-center">
                        {tasksTrigger}
                        {filesTrigger}
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
                  </div>
                </>
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
              placeholder={showRunningMode ? "Running..." : "Write your message..."}
              disabled={composerLocked}
              className="font-inherit field-sizing-content flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[14px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary"
              rows={1}
            />
            <div className="flex justify-between gap-2 p-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setWebSearchEnabled((prev) => !prev)}
                  disabled={composerLocked}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200",
                    webSearchEnabled
                      ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                      : "border-border bg-transparent text-tertiary hover:bg-secondary/10 hover:text-secondary",
                    composerLocked && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <Globe size={14} className={webSearchEnabled ? "text-primary" : "text-tertiary"} />
                  <span>Search</span>
                </button>
                <span className="self-center text-xxs italic text-[color:color-mix(in_srgb,var(--color-text-tertiary)_72%,white)]">
                  <b className="text-inherit">Enter</b> to send, {" "}
                  <b className="text-inherit">Shift+Enter</b> for new line
                </span>
              </div>
              <div className="flex justify-end gap-2">
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
