import assert from "node:assert/strict";
import test from "node:test";

import type { ThreadStatus } from "../src/features/threads/application/thread-repository";
import { LangGraphThreadRepository } from "../src/features/threads/infrastructure/langgraph-thread-repository";

type Thread = {
  thread_id: string;
  created_at?: string;
  updated_at: string;
  status?: string;
  metadata?: Record<string, unknown>;
  values?: unknown;
};

type ThreadSearchRequest = {
  metadata?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  status?: ThreadStatus;
  sortBy?: "created_at" | "updated_at";
  sortOrder?: "asc" | "desc";
  select?: Array<
    "thread_id" | "created_at" | "updated_at" | "status" | "metadata" | "values"
  >;
};

type FakeClient = {
  threads: {
    search: (query?: ThreadSearchRequest) => Promise<Thread[]>;
    getState: (threadId: string) => Promise<{ values?: unknown }>;
    get: (threadId: string) => Promise<Thread>;
    delete: (threadId: string) => Promise<void>;
    update: (
      threadId: string,
      update?: { metadata?: Record<string, unknown> }
    ) => Promise<Thread>;
  };
};

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    thread_id: "12345678-1234-1234-1234-123456789abc",
    created_at: "2026-08-18T10:00:00.000Z",
    updated_at: "2026-08-18T10:00:00.000Z",
    status: "idle",
    metadata: {},
    values: {},
    ...overrides,
  };
}

function fakeClient(
  searchedThreads: Thread[],
  states: Record<string, { values?: unknown }> = {},
  failState = false
) {
  const searchCalls: Array<ThreadSearchRequest | undefined> = [];
  const getStateCalls: string[] = [];
  const getCalls: string[] = [];
  const client: FakeClient = {
    threads: {
      search: async (query) => {
        searchCalls.push(query);
        return searchedThreads;
      },
      getState: async (threadId) => {
        getStateCalls.push(threadId);
        if (failState) throw new Error("state unavailable");
        return states[threadId] ?? {};
      },
      get: async (threadId) => {
        getCalls.push(threadId);
        return thread({ thread_id: threadId });
      },
      delete: async () => {},
      update: async (threadId) => thread({ thread_id: threadId }),
    },
  };
  return { client, searchCalls, getStateCalls, getCalls };
}

function repository(client: FakeClient) {
  return new LangGraphThreadRepository(
    { deploymentUrl: "http://langgraph.test", apiKey: "test-key" },
    client
  );
}

async function search(repository: LangGraphThreadRepository, pageIndex = 0) {
  return repository.search({
    assistantId: "assistant-id",
    pageIndex,
    pageSize: 20,
  });
}

test("selects preview fields when searching threads", async () => {
  const fake = fakeClient([
    thread({ values: { messages: [{ type: "human", content: "Selected" }] } }),
  ]);

  await search(repository(fake.client));

  assert.deepEqual(fake.searchCalls[0]?.select, [
    "thread_id",
    "created_at",
    "updated_at",
    "status",
    "metadata",
    "values",
  ]);
});

test("keeps selected first human title without loading checkpoint state", async () => {
  const fake = fakeClient([
    thread({
      values: { messages: [{ type: "human", content: "Selected title" }] },
    }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Selected title");
  assert.deepEqual(fake.getStateCalls, []);
  assert.deepEqual(fake.getCalls, []);
});

test("keeps custom titles over human messages without loading checkpoint state", async () => {
  const fake = fakeClient([
    thread({
      metadata: { custom_title: "Manual title" },
      values: { messages: [{ type: "human", content: "Generated title" }] },
    }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Manual title");
  assert.equal(items[0]?.isUserDefinedTitle, true);
  assert.deepEqual(fake.getStateCalls, []);
});

test("recovers missing completed titles from state for idle, interrupted, and error threads", async () => {
  const threads = ["idle", "interrupted", "error"].map((status) =>
    thread({
      thread_id: `${status}-thread-id`,
      status,
      values: { messages: [] },
    })
  );
  const fake = fakeClient(
    threads,
    Object.fromEntries(
      ["idle", "interrupted", "error"].map((status) => [
        `${status}-thread-id`,
        {
          values: {
            messages: [{ type: "human", content: `${status} recovered` }],
          },
        },
      ])
    )
  );

  const items = await search(repository(fake.client));

  assert.deepEqual(fake.getStateCalls, [
    "idle-thread-id",
    "interrupted-thread-id",
    "error-thread-id",
  ]);
  assert.deepEqual(
    items.map((item) => item.title),
    ["idle recovered", "interrupted recovered", "error recovered"]
  );
  assert.deepEqual(fake.getCalls, []);
});

test("recovers missing title from state on later search pages", async () => {
  const fake = fakeClient([thread({ values: { messages: [] } })], {
    "12345678-1234-1234-1234-123456789abc": {
      values: {
        messages: [{ type: "human", content: "Second page recovered" }],
      },
    },
  });

  const items = await search(repository(fake.client), 1);

  assert.equal(items[0]?.title, "Second page recovered");
  assert.deepEqual(fake.getStateCalls, [
    "12345678-1234-1234-1234-123456789abc",
  ]);
});

test("uses stable ID fallback for busy threads and never loads their state", async () => {
  const fake = fakeClient([
    thread({ status: "busy", values: { messages: [] } }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Thread 12345678");
  assert.deepEqual(fake.getStateCalls, []);
});

test("uses stable ID fallback when checkpoint lookup fails or has no human message", async () => {
  const missingHuman = fakeClient([thread({ values: { messages: [] } })]);
  const unavailable = fakeClient(
    [thread({ values: { messages: [] } })],
    {},
    true
  );

  const [missingHumanItems, unavailableItems] = await Promise.all([
    search(repository(missingHuman.client)),
    search(repository(unavailable.client)),
  ]);

  assert.equal(missingHumanItems[0]?.title, "Thread 12345678");
  assert.equal(unavailableItems[0]?.title, "Thread 12345678");
  assert.deepEqual(missingHuman.getStateCalls, [
    "12345678-1234-1234-1234-123456789abc",
  ]);
  assert.deepEqual(unavailable.getStateCalls, [
    "12345678-1234-1234-1234-123456789abc",
  ]);
});

test("preserves string content extraction and truncation for previews", async () => {
  const human = "h".repeat(51);
  const ai = "a".repeat(101);
  const fake = fakeClient([
    thread({
      values: {
        messages: [
          { type: "human", content: human },
          { type: "ai", content: ai },
        ],
      },
    }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, `${"h".repeat(50)}...`);
  assert.equal(items[0]?.description, "a".repeat(100));
});

test("preserves array content extraction for previews", async () => {
  const fake = fakeClient([
    thread({
      values: {
        messages: [
          { type: "human", content: [{ text: "Array title" }] },
          { type: "ai", content: [{ text: "Array description" }] },
        ],
      },
    }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Array title");
  assert.equal(items[0]?.description, "Array description");
});
