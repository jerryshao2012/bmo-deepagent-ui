import type { MarkdownConnectionStatus } from "./connection-lifecycle";

export type MarkdownConnectionAction = "none" | "wake" | "reconnect";
export type MarkdownConnectionTone =
  | "idle"
  | "pending"
  | "connected"
  | "fallback"
  | "disconnected";

export interface MarkdownConnectionPresentation {
  action: MarkdownConnectionAction;
  label: string;
  title: string;
  tone: MarkdownConnectionTone;
}

const presentations: Record<
  MarkdownConnectionStatus,
  MarkdownConnectionPresentation
> = {
  idle: {
    action: "wake",
    label: "IDLE",
    title: "WebSocket hibernating — use preview or click to wake",
    tone: "idle",
  },
  connecting: {
    action: "none",
    label: "CONNECTING",
    title: "Connecting to WebSocket",
    tone: "pending",
  },
  connected: {
    action: "none",
    label: "WEBSOCKET LIVE",
    title: "WebSocket synced and connected",
    tone: "connected",
  },
  reconnecting: {
    action: "none",
    label: "RECONNECTING",
    title: "Reconnecting to WebSocket",
    tone: "pending",
  },
  fallback: {
    action: "reconnect",
    label: "HTTP FALLBACK",
    title: "HTTP fallback active — click to retry WebSocket",
    tone: "fallback",
  },
  disconnected: {
    action: "reconnect",
    label: "DISCONNECTED",
    title: "Transport disconnected — click to reconnect",
    tone: "disconnected",
  },
};

export function markdownConnectionPresentation(
  status: MarkdownConnectionStatus
): MarkdownConnectionPresentation {
  return presentations[status];
}
