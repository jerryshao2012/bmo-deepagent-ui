import assert from "node:assert/strict";
import test from "node:test";

import type { Message } from "@langchain/langgraph-sdk";

import { processMessages } from "../src/app/utils/processMessages";

function ai(
  id: string,
  content: unknown,
  fields: Record<string, unknown> = {}
): Message {
  return { id, type: "ai", content, ...fields } as Message;
}

function human(id: string, content: string): Message {
  return { id, type: "human", content } as Message;
}

function tool(id: string, content: string, toolCallId = "missing"): Message {
  return { id, type: "tool", content, tool_call_id: toolCallId } as Message;
}

function ids(messages: Message[]): string[] {
  return processMessages(messages, false).map(
    ({ message }) => message.id as string
  );
}

test("dedupes adjacent Unicode and ASCII status variants", () => {
  assert.deepEqual(
    ids([
      ai("unicode", "Starting research…"),
      ai("ascii", " Starting research... "),
    ]),
    ["unicode"]
  );
});

test("dedupes adjacent ASCII and Unicode status variants in reverse order", () => {
  assert.deepEqual(
    ids([
      ai("ascii", "Starting research..."),
      ai("unicode", "Starting research…"),
    ]),
    ["ascii"]
  );
});

test("keeps first status and skips only later consecutive variants", () => {
  assert.deepEqual(
    ids([
      ai("first", "Starting research..."),
      ai("second", "Starting research…"),
      ai("third", "  Starting research...  "),
    ]),
    ["first"]
  );
});

test("retains statuses separated by human, raw tool, or non-status assistant barriers", () => {
  assert.deepEqual(
    ids([
      ai("status-human-1", "Starting research…"),
      human("human", "Continue"),
      ai("status-human-2", "Starting research..."),
      tool("tool", "ignored"),
      ai("status-tool-2", "Starting research…"),
      ai("prose", "A different assistant message"),
      ai("status-prose-2", "Starting research..."),
    ]),
    [
      "status-human-1",
      "human",
      "status-human-2",
      "status-tool-2",
      "prose",
      "status-prose-2",
    ]
  );
});

test("retains unrelated repeated prose", () => {
  assert.deepEqual(
    ids([ai("first", "Repeated prose"), ai("second", "Repeated prose")]),
    ["first", "second"]
  );
});

test("retains status text with extra content", () => {
  assert.deepEqual(
    ids([
      ai("extra-1", "Starting research… now"),
      ai("extra-2", "Starting research… now"),
    ]),
    ["extra-1", "extra-2"]
  );
});

test("removes a repeated leading status from the next streamed assistant chunk", () => {
  const processed = processMessages(
    [
      ai("standalone", "Starting research…"),
      ai(
        "streamed",
        "Starting research...\n\nI’ll save the request and delegate focused sub-tasks.",
        {
          tool_calls: [
            { id: "call-1", name: "write_file", args: { path: "/x" } },
          ],
        }
      ),
    ],
    false
  );

  assert.equal(processed.length, 2);
  assert.equal(
    processed[1]?.message.content,
    "I’ll save the request and delegate focused sub-tasks."
  );
  assert.equal(processed[1]?.toolCalls[0]?.name, "write_file");
});

test("removes a repeated leading status from text content blocks", () => {
  const processed = processMessages(
    [
      ai("standalone", "Starting research…"),
      ai("blocks", [
        {
          type: "text",
          text: "Starting research…\n\nDelegating one focused subtask.",
        },
        {
          type: "tool_use",
          id: "call-1",
          name: "task",
          input: { subagent_type: "research-agent" },
        },
      ]),
    ],
    false
  );

  assert.deepEqual(processed[1]?.message.content, [
    { type: "text", text: "Delegating one focused subtask." },
    {
      type: "tool_use",
      id: "call-1",
      name: "task",
      input: { subagent_type: "research-agent" },
    },
  ]);
});

test("does not treat assistant status with a tool call as a duplicate", () => {
  assert.deepEqual(
    ids([
      ai("status-tool", "Starting research…", {
        tool_calls: [{ id: "call-1", name: "search", args: { query: "x" } }],
      }),
      ai("status-text", "Starting research..."),
    ]),
    ["status-tool", "status-text"]
  );
});

test("uses top-level tool calls when additional kwargs has an empty list", () => {
  const processed = processMessages(
    [
      ai("status-top-level-tool", "Starting research…", {
        additional_kwargs: { tool_calls: [] },
        tool_calls: [{ id: "call-1", name: "search", args: { query: "x" } }],
      }),
      tool("tool-result", "done", "call-1"),
      ai("status-text", "Starting research..."),
    ],
    false
  );

  assert.deepEqual(
    processed.map(({ message }) => message.id),
    ["status-top-level-tool", "status-text"]
  );
  assert.deepEqual(processed[0]?.toolCalls, [
    {
      id: "call-1",
      name: "search",
      args: { query: "x" },
      status: "completed",
      result: "done",
    },
  ]);
});

test("prefers one additional tool call across overlapping representations", () => {
  const processed = processMessages(
    [
      ai(
        "overlap",
        [
          { type: "text", text: "Starting research…" },
          {
            type: "tool_use",
            id: "call-1",
            name: "search",
            input: { query: "x" },
          },
        ],
        {
          additional_kwargs: {
            tool_calls: [
              {
                id: "call-1",
                function: { name: "search", arguments: '{"query":"x"}' },
              },
            ],
          },
          tool_calls: [{ id: "call-1", name: "search", args: { query: "x" } }],
        }
      ),
      tool("overlap-result", "done", "call-1"),
    ],
    false
  );

  assert.deepEqual(processed[0]?.toolCalls, [
    {
      id: "call-1",
      name: "search",
      args: { query: "x" },
      status: "completed",
      result: "done",
    },
  ]);
});

test("falls back to Anthropic content blocks and preserves interrupt/result statuses", () => {
  const content = [
    { type: "text", text: "Starting research…" },
    {
      type: "tool_use",
      id: "pending-call",
      name: "search",
      input: { query: "pending" },
    },
    {
      type: "tool_use",
      id: "completed-call",
      name: "search",
      input: { query: "completed" },
    },
  ];
  const processed = processMessages(
    [
      ai("anthropic", content, { additional_kwargs: { tool_calls: [] } }),
      tool("anthropic-result", "done", "completed-call"),
    ],
    true
  );

  assert.deepEqual(processed[0]?.message.content, content);
  assert.deepEqual(processed[0]?.toolCalls, [
    {
      id: "pending-call",
      name: "search",
      args: { query: "pending" },
      status: "interrupted",
    },
    {
      id: "completed-call",
      name: "search",
      args: { query: "completed" },
      status: "completed",
      result: "done",
    },
  ]);
});

test("preserves input and existing tool-result association", () => {
  const messages = [
    ai("status-1", "Starting research…"),
    ai("tool-assistant", "", {
      tool_calls: [{ id: "call-1", name: "search", args: { query: "x" } }],
    }),
    tool("tool-result", "done", "call-1"),
    ai("status-2", "Starting research..."),
  ];
  const before = structuredClone(messages);

  const processed = processMessages(messages, false);

  assert.deepEqual(messages, before);
  assert.deepEqual(
    processed.map(({ message }) => message.id),
    ["status-1", "tool-assistant", "status-2"]
  );
  assert.deepEqual(processed[1]?.toolCalls, [
    {
      id: "call-1",
      name: "search",
      args: { query: "x" },
      status: "completed",
      result: "done",
    },
  ]);
});
