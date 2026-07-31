import assert from "node:assert/strict";
import test from "node:test";

const optionalImport = async (relativePath) => {
  try {
    return await import(new URL(`../${relativePath}`, import.meta.url));
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      return {};
    }
    throw error;
  }
};

test("assistant lookup requests the system assistant directly", async () => {
  const { findAssistantForGraph } = await optionalImport(
    "src/lib/findAssistantForGraph.ts",
  );
  assert.equal(typeof findAssistantForGraph, "function");

  const calls = [];
  const systemAssistant = { assistant_id: "system-assistant" };
  const client = {
    assistants: {
      search: async (query) => {
        calls.push(query);
        return [systemAssistant];
      },
    },
  };

  assert.equal(
    await findAssistantForGraph(client, "research-graph"),
    systemAssistant,
  );
  assert.deepEqual(calls, [
    {
      graphId: "research-graph",
      metadata: { created_by: "system" },
      limit: 1,
    },
  ]);
});

test("assistant lookup falls back to the first graph assistant", async () => {
  const { findAssistantForGraph } = await optionalImport(
    "src/lib/findAssistantForGraph.ts",
  );
  assert.equal(typeof findAssistantForGraph, "function");

  const fallbackAssistant = { assistant_id: "fallback-assistant" };
  const calls = [];
  const client = {
    assistants: {
      search: async (query) => {
        calls.push(query);
        return calls.length === 1 ? [] : [fallbackAssistant];
      },
    },
  };

  assert.equal(
    await findAssistantForGraph(client, "research-graph"),
    fallbackAssistant,
  );
  assert.deepEqual(calls[1], { graphId: "research-graph", limit: 1 });
});

test("message processing pairs tool results and uses stable fallback ids", async () => {
  const { processMessages } = await optionalImport(
    "src/app/utils/processMessages.ts",
  );
  assert.equal(typeof processMessages, "function");

  const messages = [
    { id: "human-1", type: "human", content: "Research this" },
    {
      id: "ai-1",
      type: "ai",
      content: "",
      tool_calls: [{ name: "search", args: '{"query":"BMO"}' }],
    },
  ];

  const first = processMessages(messages, false);
  const second = processMessages(messages, false);

  assert.equal(first.length, 2);
  assert.deepEqual(first[1].toolCalls[0].args, { query: "BMO" });
  assert.equal(first[1].toolCalls[0].id, second[1].toolCalls[0].id);
  assert.equal(first[0].showAvatar, true);
  assert.equal(first[1].showAvatar, true);
});

