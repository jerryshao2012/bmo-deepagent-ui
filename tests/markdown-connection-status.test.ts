import assert from "node:assert/strict";
import test from "node:test";

import {
  markdownConnectionPresentation,
  type MarkdownConnectionAction,
} from "../src/features/markdown-sync/application/connection-status-presentation";
import type { MarkdownConnectionStatus } from "../src/features/markdown-sync/application/connection-lifecycle";

test("markdown connection presentation distinguishes every transport state", () => {
  const expected: Record<
    MarkdownConnectionStatus,
    {
      tone: "idle" | "pending" | "connected" | "fallback" | "disconnected";
      action: MarkdownConnectionAction;
      label: string;
    }
  > = {
    idle: { tone: "idle", action: "wake", label: "IDLE" },
    connecting: {
      tone: "pending",
      action: "none",
      label: "CONNECTING",
    },
    connected: {
      tone: "connected",
      action: "none",
      label: "WEBSOCKET LIVE",
    },
    reconnecting: {
      tone: "pending",
      action: "none",
      label: "RECONNECTING",
    },
    fallback: {
      tone: "fallback",
      action: "reconnect",
      label: "HTTP FALLBACK",
    },
    disconnected: {
      tone: "disconnected",
      action: "reconnect",
      label: "DISCONNECTED",
    },
  };

  for (const [status, wanted] of Object.entries(expected) as Array<
    [MarkdownConnectionStatus, (typeof expected)[MarkdownConnectionStatus]]
  >) {
    const presentation = markdownConnectionPresentation(status);
    assert.equal(presentation.tone, wanted.tone, `${status} tone`);
    assert.equal(presentation.action, wanted.action, `${status} action`);
    assert.equal(presentation.label, wanted.label, `${status} label`);
    assert.ok(presentation.title.length > 0, `${status} title`);
  }
});

test("interactive connection states explain their local action", () => {
  assert.match(markdownConnectionPresentation("idle").title, /use|wake/i);
  assert.match(
    markdownConnectionPresentation("fallback").title,
    /click.*WebSocket/i
  );
  assert.match(
    markdownConnectionPresentation("disconnected").title,
    /click.*reconnect/i
  );
  assert.doesNotMatch(
    markdownConnectionPresentation("idle").title,
    /connected/i
  );
});
