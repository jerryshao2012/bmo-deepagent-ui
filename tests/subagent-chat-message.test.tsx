import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

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

test("rereads live research-agent tools when parent props keep stable references", () => {
  const rootTask: ToolCall = {
    id: "task-live-research-1",
    name: "task",
    args: {
      description: "Research live LangGraph transport state",
      subagent_type: "research-agent",
    },
    status: "pending",
  };
  const message = { id: "ai-live-1", type: "ai" as const, content: "" };
  const toolCalls = [rootTask];
  let nestedSnapshot: {
    toolCalls: Array<{
      id: string;
      call: { name: string; args: Record<string, string> };
      result?: { content: string };
      state: "pending" | "completed";
    }>;
  } = { toolCalls: [] };
  const stream = {
    getSubagent(id: string) {
      assert.equal(id, rootTask.id);
      return nestedSnapshot;
    },
  };
  const props = { message, toolCalls, stream };

  const view = render(<ChatMessage {...props} />);
  assert.equal(screen.queryByRole("button", { name: /tavily_search/i }), null);

  nestedSnapshot = {
    toolCalls: [
      {
        id: "live-search-1",
        call: {
          name: "tavily_search",
          args: { query: "LangGraph subgraph stream" },
        },
        state: "pending",
      },
    ],
  };
  view.rerender(<ChatMessage {...props} />);

  const liveSearch = screen.getByRole("button", { name: /tavily_search/i });
  assert.equal(
    screen.getAllByRole("button", { name: /tavily_search/i }).length,
    1
  );
  fireEvent.click(liveSearch);

  nestedSnapshot = {
    toolCalls: [
      {
        id: "live-search-1",
        call: {
          name: "tavily_search",
          args: { query: "LangGraph subgraph stream" },
        },
        result: { content: "live search result" },
        state: "completed",
      },
    ],
  };
  view.rerender(<ChatMessage {...props} />);

  assert.ok(screen.getByText("live search result"));
  assert.equal(
    screen.getAllByRole("button", { name: /tavily_search/i }).length,
    1
  );
});

test("renders emitted subagent snapshots through parent external-store updates", () => {
  const rootTask: ToolCall = {
    id: "task-stream-research-1",
    name: "task",
    args: {
      description: "Research emitted LangGraph subgraph state",
      subagent_type: "research-agent",
    },
    status: "pending",
  };
  const message = { id: "ai-stream-1", type: "ai" as const, content: "" };
  const toolCalls = [rootTask];
  let nestedSnapshot: {
    toolCalls: Array<{
      id: string;
      call: { name: string; args: Record<string, string> };
      result?: { content: string };
      state: "pending" | "completed";
    }>;
  } = { toolCalls: [] };
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const stream = {
    getSubagent(id: string) {
      assert.equal(id, rootTask.id);
      return nestedSnapshot;
    },
  };
  const props = { message, toolCalls, stream };

  function StreamHarness() {
    React.useSyncExternalStore(subscribe, () => nestedSnapshot);
    return <ChatMessage {...props} />;
  }

  render(<StreamHarness />);
  assert.equal(screen.queryByRole("button", { name: /tavily_search/i }), null);

  act(() => {
    nestedSnapshot = {
      toolCalls: [
        {
          id: "stream-search-1",
          call: {
            name: "tavily_search",
            args: { query: "LangGraph external store" },
          },
          state: "pending",
        },
      ],
    };
    listeners.forEach((listener) => listener());
  });

  const liveSearch = screen.getByRole("button", { name: /tavily_search/i });
  fireEvent.click(liveSearch);

  act(() => {
    nestedSnapshot = {
      toolCalls: [
        {
          id: "stream-search-1",
          call: {
            name: "tavily_search",
            args: { query: "LangGraph external store" },
          },
          result: { content: "streamed search result" },
          state: "completed",
        },
      ],
    };
    listeners.forEach((listener) => listener());
  });

  assert.ok(screen.getByText("streamed search result"));
  assert.equal(
    screen.getAllByRole("button", { name: /tavily_search/i }).length,
    1
  );
});
