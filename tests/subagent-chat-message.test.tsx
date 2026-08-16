import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";

import { ChatMessage } from "../src/app/components/ChatMessage";
import type { ToolCall } from "../src/app/types/types";

afterEach(cleanup);

test("renders hydrated nested research tools inside the matching agent card", () => {
  const rootTask: ToolCall = {
    id: "task-research-1",
    name: "task",
    args: {
      description: "Research agent telemetry",
      subagent_type: "research-agent",
    },
    result: "Final research answer",
    status: "completed",
  };
  const stream = {
    getSubagent(id: string) {
      assert.equal(id, rootTask.id);
      return {
        id,
        status: "complete",
        toolCalls: [
          {
            id: "search-1",
            call: { name: "tavily_search", args: { query: "agent telemetry" } },
            result: { content: "search results" },
            state: "completed",
          },
          {
            id: "fetch-1",
            call: {
              name: "fetch_webpage_content",
              args: { url: "https://example.com" },
            },
            result: { content: "page content" },
            state: "completed",
          },
          {
            id: "think-1",
            call: { name: "think_tool", args: { thought: "Compare scopes" } },
            state: "completed",
          },
        ],
      };
    },
  };

  render(
    <ChatMessage
      message={{ id: "ai-1", type: "ai", content: "" }}
      toolCalls={[rootTask]}
      stream={stream}
    />
  );

  assert.ok(screen.getByText("research-agent"));
  assert.ok(screen.getByText("Tool Invocations"));
  assert.ok(screen.getByRole("button", { name: /tavily_search/i }));
  assert.ok(screen.getByRole("button", { name: /fetch_webpage_content/i }));
  assert.ok(screen.getByText("Reasoning"));
  assert.equal(screen.queryByText("search results"), null);
  assert.equal(screen.queryByText("page content"), null);
});
