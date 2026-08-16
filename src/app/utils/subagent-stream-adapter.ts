import type { ToolCall } from "@/app/types/types";
import { extractNestedToolCallsFromSubAgentOutput } from "@/app/utils/utils";

interface SubagentToolCallSnapshot {
  id?: unknown;
  call?: {
    id?: unknown;
    name?: unknown;
    args?: unknown;
  };
  result?: unknown;
  state?: unknown;
}

interface SubagentSnapshot {
  toolCalls?: readonly SubagentToolCallSnapshot[];
}

interface SubagentStreamLookup {
  getSubagent(toolCallId: string): SubagentSnapshot | undefined;
}

function normalizeArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Preserve non-JSON arguments for inspection.
    }
  }

  return value == null ? {} : { raw: value };
}

function normalizeResult(result: unknown): string | undefined {
  if (result == null) {
    return undefined;
  }

  const content =
    typeof result === "object" && "content" in (result as object)
      ? (result as { content?: unknown }).content
      : result;

  if (content == null) {
    return undefined;
  }

  return typeof content === "string"
    ? content
    : JSON.stringify(content, null, 2);
}

function normalizeStatus(
  toolCall: SubagentToolCallSnapshot,
  result: string | undefined
): ToolCall["status"] {
  const resultStatus =
    toolCall.result && typeof toolCall.result === "object"
      ? (toolCall.result as { status?: unknown }).status
      : undefined;

  if (toolCall.state === "error" || resultStatus === "error") {
    return "error";
  }
  if (toolCall.state === "interrupted") {
    return "interrupted";
  }
  if (toolCall.state === "completed" || toolCall.state === "complete") {
    return "completed";
  }
  if (toolCall.state === "pending" || toolCall.state === "running") {
    return "pending";
  }

  return result === undefined ? "pending" : "completed";
}

export function normalizeSubagentToolCalls(
  subagent: SubagentSnapshot | undefined
): ToolCall[] {
  if (!subagent?.toolCalls) {
    return [];
  }

  return subagent.toolCalls.flatMap((toolCall) => {
    const id =
      typeof toolCall.id === "string"
        ? toolCall.id
        : typeof toolCall.call?.id === "string"
        ? toolCall.call.id
        : undefined;
    if (!id) {
      return [];
    }

    const result = normalizeResult(toolCall.result);
    return [
      {
        id,
        name:
          typeof toolCall.call?.name === "string"
            ? toolCall.call.name
            : "unknown",
        args: normalizeArgs(toolCall.call?.args),
        result,
        status: normalizeStatus(toolCall, result),
      },
    ];
  });
}

export function getNestedToolCallsForTask(
  stream: SubagentStreamLookup | undefined,
  taskCall: ToolCall
): ToolCall[] {
  const subagent = stream?.getSubagent(taskCall.id);
  if (subagent) {
    const streamedToolCalls = normalizeSubagentToolCalls(subagent);
    if (streamedToolCalls.length > 0) {
      return streamedToolCalls;
    }
  }

  return extractNestedToolCallsFromSubAgentOutput(taskCall.result);
}
