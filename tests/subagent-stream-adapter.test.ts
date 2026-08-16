import assert from "node:assert/strict";
import test from "node:test";

import type { ToolCall } from "../src/app/types/types";
import {
  getNestedToolCallsForTask,
  normalizeSubagentToolCalls,
} from "../src/app/utils/subagent-stream-adapter";

function taskCall(id: string, result?: string): ToolCall {
  return {
    id,
    name: "task",
    args: { description: `Research ${id}`, subagent_type: "research-agent" },
    result,
    status: result ? "completed" : "pending",
  };
}

test("normalizes pending, completed, and failed subagent tool calls", () => {
  const calls = normalizeSubagentToolCalls({
    toolCalls: [
      {
        id: "pending-call",
        call: { name: "tavily_search", args: { query: "telemetry" } },
        state: "pending",
      },
      {
        id: "completed-call",
        call: {
          name: "fetch_webpage_content",
          args: { url: "https://example.com" },
        },
        result: { content: "page text", status: "success" },
        state: "completed",
      },
      {
        id: "failed-call",
        call: { name: "tavily_search", args: { query: "failure" } },
        result: { content: "request failed", status: "error" },
        state: "error",
      },
    ],
  });

  assert.deepEqual(calls, [
    {
      id: "pending-call",
      name: "tavily_search",
      args: { query: "telemetry" },
      result: undefined,
      status: "pending",
    },
    {
      id: "completed-call",
      name: "fetch_webpage_content",
      args: { url: "https://example.com" },
      result: "page text",
      status: "completed",
    },
    {
      id: "failed-call",
      name: "tavily_search",
      args: { query: "failure" },
      result: "request failed",
      status: "error",
    },
  ]);
});

test("preserves structured tool-result content", () => {
  const [call] = normalizeSubagentToolCalls({
    toolCalls: [
      {
        id: "structured-call",
        call: { name: "fetch_webpage_content", args: {} },
        result: {
          content: [
            { type: "text", text: "summary" },
            { type: "json", value: { sources: 3 } },
          ],
        },
        state: "completed",
      },
    ],
  });

  assert.equal(
    call.result,
    JSON.stringify(
      [
        { type: "text", text: "summary" },
        { type: "json", value: { sources: 3 } },
      ],
      null,
      2
    )
  );
});

test("associates parallel subagents strictly by task tool-call ID", () => {
  const subagents = new Map([
    [
      "task-b",
      {
        id: "task-b",
        toolCalls: [
          {
            id: "tool-b",
            call: { name: "think_tool", args: { thought: "B" } },
            state: "completed",
          },
        ],
      },
    ],
    [
      "task-a",
      {
        id: "task-a",
        toolCalls: [
          {
            id: "tool-a",
            call: { name: "tavily_search", args: { query: "A" } },
            state: "pending",
          },
        ],
      },
    ],
  ]);
  const stream = { getSubagent: (id: string) => subagents.get(id) };

  assert.equal(
    getNestedToolCallsForTask(stream, taskCall("task-a"))[0].id,
    "tool-a"
  );
  assert.equal(
    getNestedToolCallsForTask(stream, taskCall("task-b"))[0].id,
    "tool-b"
  );
});

test("falls back to task-result extraction when no subagent stream exists", () => {
  const task = taskCall(
    "task-fallback",
    JSON.stringify({
      tool_calls: [
        {
          id: "fallback-call",
          name: "tavily_search",
          args: { query: "fallback" },
          result: "fallback result",
          status: "completed",
        },
      ],
    })
  );

  assert.deepEqual(getNestedToolCallsForTask(undefined, task), [
    {
      id: "fallback-call",
      name: "tavily_search",
      args: { query: "fallback" },
      result: "fallback result",
      status: "completed",
    },
  ]);
  assert.deepEqual(
    getNestedToolCallsForTask({ getSubagent: () => undefined }, task),
    getNestedToolCallsForTask(undefined, task)
  );
  assert.deepEqual(
    getNestedToolCallsForTask({ getSubagent: () => ({ toolCalls: [] }) }, task),
    getNestedToolCallsForTask(undefined, task)
  );
});
