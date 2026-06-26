"use client";

import React, { useMemo, useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { SubAgentIndicator } from "@/app/components/SubAgentIndicator";
import { ToolCallBox } from "@/app/components/ToolCallBox";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import type {
  SubAgent,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Message } from "@langchain/langgraph-sdk";
import {
  extractSubAgentContent,
  extractNestedToolCallsFromSubAgentOutput,
  extractStringFromMessageContent,
} from "@/app/utils/utils";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: Message;
  durationSeconds?: number;
  isProcessing?: boolean;
  toolCalls: ToolCall[];
  isLoading?: boolean;
  actionRequestsMap?: Map<string, ActionRequest>;
  reviewConfigsMap?: Map<string, ReviewConfig>;
  ui?: any[];
  stream?: any;
  onResumeInterrupt?: (value: any) => void;
  graphId?: string;
  onDocumentClick?: (
    filePath: string,
    page?: number,
    slide?: number,
    quote?: string
  ) => void;
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    durationSeconds,
    isProcessing,
    toolCalls,
    isLoading,
    actionRequestsMap,
    reviewConfigsMap,
    ui,
    stream,
    onResumeInterrupt,
    graphId,
    onDocumentClick,
  }) => {
    const isUser = message.type === "human";
    const messageContent = extractStringFromMessageContent(message);
    const hasContent = messageContent && messageContent.trim() !== "";
    const hasToolCalls = toolCalls.length > 0;
    const formattedDuration =
      typeof durationSeconds === "number" && !isNaN(durationSeconds) ? `${durationSeconds.toFixed(1)}s` : null;
    const subAgents = useMemo(() => {
      return toolCalls
        .filter((toolCall: ToolCall) => {
          return (
            toolCall.name === "task" &&
            toolCall.args["subagent_type"] &&
            toolCall.args["subagent_type"] !== "" &&
            toolCall.args["subagent_type"] !== null
          );
        })
        .map((toolCall: ToolCall) => {
          const subagentType = (toolCall.args as Record<string, unknown>)[
            "subagent_type"
          ] as string;
          const nestedToolCalls = extractNestedToolCallsFromSubAgentOutput(
            toolCall.result
          );
          return {
            id: toolCall.id,
            name: toolCall.name,
            subAgentName: subagentType,
            input: toolCall.args,
            output: toolCall.result ? { result: toolCall.result } : undefined,
            nestedToolCalls,
            status: toolCall.status,
          } as SubAgent;
        });
    }, [toolCalls]);

    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(() => {
      navigator.clipboard.writeText(messageContent).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 4000);
      });
    }, [messageContent]);

    const [expandedSubAgents, setExpandedSubAgents] = useState<
      Record<string, boolean>
    >({});
    const isSubAgentExpanded = useCallback(
      (id: string) => expandedSubAgents[id] ?? true,
      [expandedSubAgents]
    );
    const toggleSubAgent = useCallback((id: string) => {
      setExpandedSubAgents((prev) => ({
        ...prev,
        [id]: prev[id] === undefined ? false : !prev[id],
      }));
    }, []);

    return (
      <div
        className={cn(
          "flex w-full max-w-full overflow-x-hidden",
          isUser && "flex-row-reverse"
        )}
      >
        <div
          className={cn(
            "min-w-0 max-w-full",
            isUser ? "max-w-[70%]" : "w-full"
          )}
        >
          {hasContent && (
            <div className={cn("relative flex items-end gap-0 group")}>
              <div
                className={cn(
                  "mt-4 overflow-hidden break-words text-sm font-normal leading-[150%]",
                  isUser
                    ? "rounded-xl rounded-br-none border border-border px-3 py-2 text-foreground"
                    : "text-primary",
                  isUser && isProcessing && "user-processing-bubble"
                )}
                style={
                  isUser
                    ? { backgroundColor: "var(--color-user-message-bg)" }
                    : undefined
                }
              >
                {isUser ? (
                  <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {messageContent}
                  </p>
                ) : hasContent ? (
                  <MarkdownContent
                    content={messageContent}
                    onDocumentClick={onDocumentClick}
                  />
                ) : null}
              </div>
              {isUser && (
                <button
                  onClick={handleCopy}
                  className="mb-2 ml-1.5 flex-shrink-0 self-end rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                  aria-label="Copy message"
                  title="Copy message"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
          )}
          {isUser && isProcessing && (
            <div className="user-processing-indicator mt-1.5 flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
              <span className="tracking-wide">Processing</span>
              <span className="user-processing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          )}
          {formattedDuration && (message.type === "human" || message.type === "ai") && (
            <div
              className={cn(
                "mt-1 text-xs text-muted-foreground",
                isUser && "text-right"
              )}
            >
              Server reply time: {formattedDuration}
            </div>
          )}
          {hasToolCalls && (
            <div className="mt-4 flex w-full flex-col">
              {toolCalls.map((toolCall: ToolCall) => {
                if (toolCall.name === "task") return null;
                const toolCallGenUiComponent = ui?.find(
                  (u) => u.metadata?.tool_call_id === toolCall.id
                );
                const actionRequest = actionRequestsMap?.get(toolCall.name);
                const reviewConfig = reviewConfigsMap?.get(toolCall.name);
                return (
                  <ToolCallBox
                    key={toolCall.id}
                    toolCall={toolCall}
                    uiComponent={toolCallGenUiComponent}
                    stream={stream}
                    graphId={graphId}
                    actionRequest={actionRequest}
                    reviewConfig={reviewConfig}
                    onResume={onResumeInterrupt}
                    isLoading={isLoading}
                  />
                );
              })}
            </div>
          )}
          {!isUser && subAgents.length > 0 && (
            <div className="flex w-fit max-w-full flex-col gap-4">
              {subAgents.map((subAgent) => (
                <div
                  key={subAgent.id}
                  className="flex w-full flex-col gap-2"
                >
                  <div className="flex items-end gap-2">
                    <div className="w-[calc(100%-100px)]">
                      <SubAgentIndicator
                        subAgent={subAgent}
                        onClick={() => toggleSubAgent(subAgent.id)}
                        isExpanded={isSubAgentExpanded(subAgent.id)}
                      />
                    </div>
                  </div>
                  {isSubAgentExpanded(subAgent.id) && (
                    <div className="w-full max-w-full">
                      <div className="bg-surface border-border-light rounded-md border p-4">
                        <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                          Input
                        </h4>
                        <div className="mb-4">
                          <MarkdownContent
                            content={extractSubAgentContent(subAgent.input)}
                            onDocumentClick={onDocumentClick}
                          />
                        </div>
                        {subAgent.output && (
                          <>
                            <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                              Output
                            </h4>
                            <MarkdownContent
                              content={extractSubAgentContent(subAgent.output)}
                              onDocumentClick={onDocumentClick}
                            />
                          </>
                        )}
                        {subAgent.nestedToolCalls &&
                          subAgent.nestedToolCalls.length > 0 && (
                            <div className="mt-4">
                              <h4 className="text-primary/70 mb-2 text-xs font-semibold uppercase tracking-wider">
                                Tool Invocations
                              </h4>
                              <div className="flex w-full flex-col gap-1">
                                {subAgent.nestedToolCalls.map((nestedToolCall) => {
                                  const nestedToolCallGenUiComponent = ui?.find(
                                    (u) =>
                                      u.metadata?.tool_call_id === nestedToolCall.id
                                  );
                                  return (
                                    <ToolCallBox
                                      key={nestedToolCall.id}
                                      toolCall={nestedToolCall}
                                      uiComponent={nestedToolCallGenUiComponent}
                                      stream={stream}
                                      graphId={graphId}
                                      isLoading={isLoading}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatMessage.displayName = "ChatMessage";
