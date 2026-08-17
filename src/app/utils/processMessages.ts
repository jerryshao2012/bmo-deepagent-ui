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

function extractRawToolCalls(message: Message): RawToolCall[] {
  if (
    Array.isArray(message.additional_kwargs?.tool_calls) &&
    message.additional_kwargs.tool_calls.length > 0
  ) {
    return message.additional_kwargs.tool_calls;
  }
  const topLevelToolCalls = (
    message as Message & { tool_calls?: RawToolCall[] }
  ).tool_calls;
  if (Array.isArray(topLevelToolCalls)) {
    const toolCalls = topLevelToolCalls.filter(
      (toolCall: RawToolCall) => toolCall.name !== ""
    );
    if (toolCalls.length > 0) return toolCalls;
  }
  if (Array.isArray(message.content)) {
    const contentBlocks: unknown[] = message.content;
    const toolCalls = contentBlocks.filter(
      (block): block is RawToolCall =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block as { type?: string }).type === "tool_use"
    );
    if (toolCalls.length > 0) return toolCalls;
  }
  return [];
}

function isResearchStartStatus(message: Message): boolean {
  if (message.type !== "ai" || extractRawToolCalls(message).length > 0) {
    return false;
  }
  if (
    Array.isArray(message.content) &&
    !message.content.every(
      (content) =>
        typeof content === "string" ||
        (typeof content === "object" &&
          content !== null &&
          "type" in content &&
          content.type === "text" &&
          "text" in content &&
          typeof content.text === "string")
    )
  ) {
    return false;
  }

  return (
    extractMessageText(message)
      .trim()
      .replace(/\.\.\.$/, "…") === "Starting research…"
  );
}

const RESEARCH_START_PREFIX = /^\s*Starting research(?:…|\.\.\.)\s*/;

function stripRepeatedResearchStart(message: Message): Message {
  if (message.type !== "ai") return message;

  if (typeof message.content === "string") {
    const content = message.content.replace(RESEARCH_START_PREFIX, "");
    return content === message.content ? message : { ...message, content };
  }

  if (!Array.isArray(message.content)) return message;

  let canStrip = true;
  let changed = false;
  const content = (message.content as unknown[]).map((block) => {
    if (!canStrip) return block;

    if (typeof block === "string") {
      if (block.trim() === "") return block;
      canStrip = false;
      const text = block.replace(RESEARCH_START_PREFIX, "");
      changed ||= text !== block;
      return text;
    }

    if (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
    ) {
      if (block.text.trim() === "") return block;
      canStrip = false;
      const text = block.text.replace(RESEARCH_START_PREFIX, "");
      changed ||= text !== block.text;
      return text === block.text ? block : { ...block, text };
    }

    canStrip = false;
    return block;
  });

  return changed
    ? { ...message, content: content as Message["content"] }
    : message;
}

export function processMessages(
  messages: Message[],
  interrupted: boolean
): ProcessedMessage[] {
  const messageMap = new Map<
    string,
    { message: Message; toolCalls: ToolCall[] }
  >();
  let previousWasResearchStartStatus = false;

  messages.forEach((rawMessage, messageIndex) => {
    const isStatus = isResearchStartStatus(rawMessage);
    if (isStatus && previousWasResearchStartStatus) return;
    const message = previousWasResearchStartStatus
      ? stripRepeatedResearchStart(rawMessage)
      : rawMessage;
    previousWasResearchStartStatus = isStatus;

    const messageId = message.id || `message-${messageIndex}`;

    if (message.type === "ai") {
      const rawToolCalls = extractRawToolCalls(message);

      const toolCalls = rawToolCalls.map((toolCall, toolCallIndex) => ({
        id: toolCall.id || `tool-${messageId}-${toolCallIndex}`,
        name:
          toolCall.function?.name ||
          toolCall.name ||
          toolCall.type ||
          "unknown",
        args: parseToolArgs(
          toolCall.function?.arguments || toolCall.args || toolCall.input || {}
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
          status:
            (message as Message & { status?: unknown }).status === "error"
              ? "error"
              : "completed",
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
