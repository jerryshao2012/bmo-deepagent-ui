"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import {
  type Message,
  type Assistant,
  type Checkpoint,
} from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
import type { TodoItem } from "@/app/types/types";
import { useClient } from "@/providers/ClientProvider";
import { useQueryState } from "nuqs";

export type StateType = {
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, unknown>;
  email?: {
    id?: string;
    subject?: string;
    page_content?: string;
  };
  ui?: any;
  no_web?: boolean | null;
  verification_round?: number;
};

function extractFileText(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "content" in (value as Record<string, unknown>)
  ) {
    const contentValue = (value as { content?: unknown }).content;
    if (Array.isArray(contentValue)) {
      return contentValue.map((item) => String(item ?? "")).join("\n");
    }
    return String(contentValue ?? "");
  }

  return String(value ?? "");
}

export function useChat({
  activeAssistant,
  onHistoryRevalidateAction,
  thread,
}: {
  activeAssistant: Assistant | null;
  onHistoryRevalidateAction?: () => void;
  thread?: UseStreamThread<StateType>;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const client = useClient();
  const [localChatStartMs, setLocalChatStartMs] = useState<number | null>(null);
  const [localChatElapsedSeconds, setLocalChatElapsedSeconds] = useState<
    number | null
  >(null);
  const [serverSnapshot, setServerSnapshot] = useState<{
    messages: Message[];
    todos: TodoItem[];
    files: Record<string, unknown>;
    email?: StateType["email"];
    ui?: StateType["ui"];
    no_web?: StateType["no_web"];
    updatedAt: number;
  } | null>(null);
  const [messageTimings, setMessageTimings] = useState<
    Record<
      string,
      {
        startedAt: number;
        completedAt?: number;
        durationMs?: number;
      }
    >
  >({});
  const [processingHumanMessageId, setProcessingHumanMessageId] = useState<
    string | null
  >(null);
  const [localFiles, setLocalFiles] = useState<Record<string, unknown>>({});
  const [streamError, setStreamError] = useState<Error | null>(null);
  const turnCountRef = useRef(0);
  const previousThreadIdRef = useRef<string | null | undefined>(undefined);
  const locallyUpdatedFilesRef = useRef<Record<string, string>>({});
  const pendingTurnRef = useRef<{
    turnId: string;
    humanMessageId: string;
    startedAt: number;
    hasStartedLoading: boolean;
    baselineMessageCount: number;
  } | null>(null);

  const stream = useStream<StateType>({
    assistantId: activeAssistant?.assistant_id || "",
    client: client ?? undefined,
    reconnectOnMount: true,
    threadId: threadId ?? null,
    onThreadId: setThreadId,
    defaultHeaders: { "x-auth-scheme": "langsmith" },
    // Enable fetching state history when switching to existing threads
    fetchStateHistory: true,
    // Revalidate thread list when stream finishes, errors, or creates new thread
    onFinish: onHistoryRevalidateAction,
    onError: (error) => {
      console.error("Stream error:", error);
      const errorObject = error instanceof Error ? error : new Error(String(error));
      setStreamError(errorObject);
      onHistoryRevalidateAction?.();
    },
    onCreated: onHistoryRevalidateAction,
    experimental_thread: thread,
  });

  useEffect(() => {
    const previousThreadId = previousThreadIdRef.current;

    if (previousThreadId === undefined) {
      previousThreadIdRef.current = threadId;
      return;
    }

    if (previousThreadId !== threadId) {
      const isInitialThreadIdAssignment =
        previousThreadId === null && typeof threadId === "string";

      if (!isInitialThreadIdAssignment) {
        turnCountRef.current = 0;
        pendingTurnRef.current = null;
        setLocalChatStartMs(null);
        setLocalChatElapsedSeconds(null);
        setServerSnapshot(null);
        setMessageTimings({});
        setProcessingHumanMessageId(null);
        locallyUpdatedFilesRef.current = {};
        setLocalFiles({});
        setStreamError(null);
      }
    }

    previousThreadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    const streamFiles = (stream.values.files ?? {}) as Record<string, unknown>;
    const localUpdates = locallyUpdatedFilesRef.current;

    setLocalFiles((previousFiles) => {
      let hasChanges = false;
      const nextFiles: Record<string, unknown> = { ...previousFiles };

      for (const [fileName, fileContent] of Object.entries(streamFiles)) {
        const incomingContent = extractFileText(fileContent);
        const lockedContent = localUpdates[fileName];

        // Keep local successful-save value until stream catches up to it.
        if (lockedContent !== undefined && incomingContent !== lockedContent) {
          continue;
        }

        if (lockedContent !== undefined && incomingContent === lockedContent) {
          delete localUpdates[fileName];
        }

        if (nextFiles[fileName] !== fileContent) {
          nextFiles[fileName] = fileContent;
          hasChanges = true;
        }
      }

      for (const fileName of Object.keys(previousFiles)) {
        if (
          !(fileName in streamFiles) &&
          localUpdates[fileName] === undefined
        ) {
          delete nextFiles[fileName];
          hasChanges = true;
        }
      }

      return hasChanges ? nextFiles : previousFiles;
    });
  }, [stream.values.files, threadId]);

  useEffect(() => {
    if (!threadId) {
      setServerSnapshot(null);
      return;
    }

    let isDisposed = false;

    const syncFromServer = async () => {
      try {
        const threadState = (await (client.threads as any).get(threadId)) as {
          updated_at?: string;
          values?: StateType;
        };

        if (isDisposed) {
          return;
        }

        const values = threadState?.values ?? ({} as Partial<StateType>);
        const serverMessages = values.messages ?? [];
        const serverUpdatedAt = threadState?.updated_at
          ? new Date(threadState.updated_at).getTime()
          : Date.now();

        setServerSnapshot((previousSnapshot) => {
          const previousUpdatedAt = previousSnapshot?.updatedAt ?? 0;
          const isMoreRecent = serverUpdatedAt > previousUpdatedAt;
          const isMoreComplete = serverMessages.length > stream.messages.length;
          const shouldReplace =
            isMoreComplete ||
            (!stream.isLoading && (isMoreRecent || serverMessages.length > 0));

          if (!shouldReplace) {
            return previousSnapshot;
          }

          return {
            messages: serverMessages,
            todos: values.todos ?? [],
            files: values.files ?? {},
            email: values.email,
            ui: values.ui,
            no_web: values.no_web,
            updatedAt: serverUpdatedAt,
          };
        });
      } catch {
        // Ignore transient fetch errors; stream reconnection may still recover.
      }
    };

    syncFromServer();
    const interval = setInterval(syncFromServer, 2500);

    return () => {
      isDisposed = true;
      clearInterval(interval);
    };
  }, [client, threadId, stream.isLoading, stream.messages.length]);

  useEffect(() => {
    const pendingTurn = pendingTurnRef.current;
    if (!pendingTurn) {
      return;
    }

    if (stream.isLoading) {
      pendingTurnRef.current = {
        ...pendingTurn,
        hasStartedLoading: true,
      };
      return;
    }

    const humanIndex = stream.messages.findIndex(
      (m) => m.id === pendingTurn.humanMessageId
    );
    const hasResponseAfterHuman =
      humanIndex !== -1 &&
      stream.messages
        .slice(humanIndex + 1)
        .some((m) => m.type === "ai" || m.type === "tool");

    const hasAnyNewResponse = stream.messages
      .slice(pendingTurn.baselineMessageCount)
      .some((m) => m.type === "ai" || m.type === "tool");

    const shouldFinalize =
      pendingTurn.hasStartedLoading || hasResponseAfterHuman || hasAnyNewResponse;
    if (!shouldFinalize) {
      return;
    }

    const completedAt = Date.now();
    const timing = {
      startedAt: pendingTurn.startedAt,
      completedAt,
      durationMs: completedAt - pendingTurn.startedAt,
    };

    setMessageTimings((prev) => ({
      ...prev,
      [pendingTurn.turnId]: timing,
    }));
    setLocalChatElapsedSeconds(timing.durationMs / 1000);
    setProcessingHumanMessageId(null);

    pendingTurnRef.current = null;
  }, [stream.isLoading, stream.messages]);

  const sendMessage = useCallback(
    (content: string, stateUpdates?: Record<string, any>) => {
      const humanMessageId = uuidv4();
      const newMessage: Message = {
        id: humanMessageId,
        type: "human",
        content,
      };
      const turnId = `turn-${++turnCountRef.current}`;
      const startedAt = Date.now();
      pendingTurnRef.current = {
        turnId,
        humanMessageId,
        startedAt,
        hasStartedLoading: false,
        baselineMessageCount: stream.messages.length,
      };
      setProcessingHumanMessageId(humanMessageId);
      setLocalChatStartMs(startedAt);
      setLocalChatElapsedSeconds(null);
      // Initialize timing entry for this turn
      setMessageTimings((prev) => ({
        ...prev,
        [turnId]: {
          startedAt,
        },
      }));
      stream.submit(
        { messages: [newMessage], ...stateUpdates },
        {
          optimisticValues: (prev) => ({
            messages: [...(prev.messages ?? []), newMessage],
            // Clear todos optimistically when user sends a new message
            todos: [],
          }),
          config: { ...(activeAssistant?.config ?? {}), recursion_limit: 100 },
        }
      );
      // Update thread list immediately when sending a message
      onHistoryRevalidateAction?.();
    },
    [stream, activeAssistant?.config, onHistoryRevalidateAction]
  );

  const runSingleStep = useCallback(
    (
      messages: Message[],
      checkpoint?: Checkpoint,
      isRerunningSubagent?: boolean,
      optimisticMessages?: Message[]
    ) => {
      if (checkpoint) {
        stream.submit(undefined, {
          ...(optimisticMessages
            ? { optimisticValues: { messages: optimisticMessages } }
            : {}),
          config: activeAssistant?.config,
          checkpoint: checkpoint,
          ...(isRerunningSubagent
            ? { interruptAfter: ["tools"] }
            : { interruptBefore: ["tools"] }),
        });
      } else {
        stream.submit(
          { messages },
          { config: activeAssistant?.config, interruptBefore: ["tools"] }
        );
      }
    },
    [stream, activeAssistant?.config]
  );

  const setFiles = useCallback(
    async (files: Record<string, unknown>) => {
      if (!threadId) return;
      await client.threads.updateState(threadId, { values: { files } });

      const nextLockedFiles: Record<string, string> = {};
      for (const [fileName, content] of Object.entries(files)) {
        if (
          typeof content === "string" &&
          extractFileText(localFiles[fileName]) !== content
        ) {
          nextLockedFiles[fileName] = content;
        }
      }

      locallyUpdatedFilesRef.current = {
        ...locallyUpdatedFilesRef.current,
        ...nextLockedFiles,
      };
      setLocalFiles(files);
    },
    [client, threadId, localFiles]
  );

  const continueStream = useCallback(
    (hasTaskToolCall?: boolean) => {
      stream.submit(undefined, {
        // Optimistically clear todos when continuing the stream so stale
        // task list from a previous turn doesn't remain visible.
        optimisticValues: (prev) => ({
          ...prev,
          todos: [],
        }),
        config: {
          ...(activeAssistant?.config || {}),
          recursion_limit: 100,
        },
        ...(hasTaskToolCall
          ? { interruptAfter: ["tools"] }
          : { interruptBefore: ["tools"] }),
      });
      // Update thread list when continuing stream
      onHistoryRevalidateAction?.();
    },
    [stream, activeAssistant?.config, onHistoryRevalidateAction]
  );

  const markCurrentThreadAsResolved = useCallback(() => {
    stream.submit(null, { command: { goto: "__end__", update: null } });
    // Update thread list when marking thread as resolved
    onHistoryRevalidateAction?.();
  }, [stream, onHistoryRevalidateAction]);

  const resumeInterrupt = useCallback(
    (value: any) => {
      stream.submit(null, { command: { resume: value } });
      // Update thread list when resuming from interrupt
      onHistoryRevalidateAction?.();
    },
    [stream, onHistoryRevalidateAction]
  );

  const stopStream = useCallback(() => {
    stream.stop();
  }, [stream]);

  const shouldPreferServerSnapshot =
    !!serverSnapshot &&
    !stream.isLoading &&
    serverSnapshot.messages.length > stream.messages.length;

  const effectiveMessages = shouldPreferServerSnapshot
    ? serverSnapshot.messages
    : stream.messages;

  const effectiveTodos = shouldPreferServerSnapshot
    ? serverSnapshot?.todos ?? []
    : stream.values.todos ?? [];

  const effectiveEmail = shouldPreferServerSnapshot
    ? serverSnapshot?.email
    : stream.values.email;

  const effectiveUi = shouldPreferServerSnapshot
    ? serverSnapshot?.ui
    : stream.values.ui;

  const effectiveFiles = useMemo(() => {
    return {
      ...(serverSnapshot?.files ?? {}),
      ...localFiles,
    };
  }, [serverSnapshot?.files, localFiles]);

  const effectiveNoWeb = (shouldPreferServerSnapshot
    ? serverSnapshot?.no_web
    : stream.values.no_web) ?? false;

  const effectiveVerificationRound: number | undefined =
    shouldPreferServerSnapshot
      ? (serverSnapshot as Record<string, unknown>)
          ?.verification_round as number | undefined
      : (stream.values as Record<string, unknown>)
          ?.verification_round as number | undefined;

  return {
    stream,
    todos: effectiveTodos,
    verificationRound: effectiveVerificationRound,
    files: effectiveFiles,
    chatStartTime: localChatStartMs,
    chatElapsedSeconds: localChatElapsedSeconds,
    email: effectiveEmail,
    ui: effectiveUi,
    messageTimings,
    processingHumanMessageId,
    streamError,
    setFiles,
    messages: effectiveMessages,
    isLoading: stream.isLoading,
    isThreadLoading: stream.isThreadLoading,
    interrupt: stream.interrupt,
    getMessagesMetadata: stream.getMessagesMetadata,
    sendMessage,
    runSingleStep,
    continueStream,
    stopStream,
    markCurrentThreadAsResolved,
    resumeInterrupt,
    no_web: effectiveNoWeb,
  };
}
