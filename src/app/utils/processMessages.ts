import type { Message } from "@langchain/langgraph-sdk";
import type { ToolCall } from "@/app/types/types";

type RawToolCall = {
  id?: string;
  function?: { name?: string; arguments?: unknown };
  name?: string;
  type?: string;
  args?: unknown;
  input?: unknown;
};

export type ProcessedMessage = {
  message: Message;
  toolCalls: ToolCall[];
  showAvatar: boolean;
};

function parseToolArgs(value: unknown): Record<string, unknown> {
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
        // Preserve malformed JSON as a raw argument.
      }
    }
    return { raw: value };
  }

  return {};
}

function extractMessageText(message: Message): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter(
      (content) =>
        typeof content === "string" ||
        (typeof content === "object" &&
          content !== null &&
          "type" in content &&
          content.type === "text")
    )
    .map((content) =>
      typeof content === "string"
        ? content
        : "text" in content && typeof content.text === "string"
        ? content.text
        : ""
    )
    .join("");
}

export function processMessages(
  messages: Message[],
  interrupted: boolean
): ProcessedMessage[] {
  const messageMap = new Map<
    string,
    { message: Message; toolCalls: ToolCall[] }
  >();

  messages.forEach((message, messageIndex) => {
    const messageId = message.id || `message-${messageIndex}`;

    if (message.type === "ai") {
      let rawToolCalls: RawToolCall[] = [];
      if (Array.isArray(message.additional_kwargs?.tool_calls)) {
        rawToolCalls = message.additional_kwargs.tool_calls;
      } else if (Array.isArray(message.tool_calls)) {
        rawToolCalls = message.tool_calls.filter(
          (toolCall: RawToolCall) => toolCall.name !== ""
        );
      } else if (Array.isArray(message.content)) {
        const contentBlocks: unknown[] = message.content;
        rawToolCalls = contentBlocks.filter(
          (block): block is RawToolCall =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            (block as { type?: string }).type === "tool_use"
        );
      }

      const toolCalls = rawToolCalls.map((toolCall, toolCallIndex) => ({
        id: toolCall.id || `tool-${messageId}-${toolCallIndex}`,
        name:
          toolCall.function?.name ||
          toolCall.name ||
          toolCall.type ||
          "unknown",
        args: parseToolArgs(
          toolCall.function?.arguments ||
            toolCall.args ||
            toolCall.input ||
            {}
        ),
        status: interrupted ? ("interrupted" as const) : ("pending" as const),
      }));

      messageMap.set(messageId, { message, toolCalls });
      return;
    }

    if (message.type === "tool") {
      if (!message.tool_call_id) return;
      for (const data of messageMap.values()) {
        const toolCallIndex = data.toolCalls.findIndex(
          (toolCall) => toolCall.id === message.tool_call_id
        );
        if (toolCallIndex === -1) continue;
        data.toolCalls[toolCallIndex] = {
          ...data.toolCalls[toolCallIndex],
          status: "completed",
          result: extractMessageText(message),
        };
        break;
      }
      return;
    }

    if (message.type === "human") {
      messageMap.set(messageId, { message, toolCalls: [] });
    }
  });

  const processedMessages = Array.from(messageMap.values());
  return processedMessages.map((data, index) => ({
    ...data,
    showAvatar:
      data.message.type !== processedMessages[index - 1]?.message.type,
  }));
}
