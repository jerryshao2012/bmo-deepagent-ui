import assert from "node:assert/strict";
import test from "node:test";

import type { ThreadStatus } from "../src/features/threads/application/thread-repository";
import { LangGraphThreadRepository } from "../src/features/threads/infrastructure/langgraph-thread-repository";

type Thread = {
  thread_id: string;
  created_at?: string;
  updated_at: string;
  status: ThreadStatus;
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

type ThreadStateSnapshot = {
  values?: unknown;
  thread_id?: string;
  created_at?: string;
  updated_at?: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

type GetStateOptions = {
  delayMs?: number;
};

type FakeClient = {
  threads: {
    search: (query?: ThreadSearchRequest) => Promise<Thread[]>;
    getState: (threadId: string) => Promise<ThreadStateSnapshot>;
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
  states: Record<string, ThreadStateSnapshot> = {},
  failState = false,
  getStateOptions: GetStateOptions = {}
) {
  const searchCalls: Array<ThreadSearchRequest | undefined> = [];
  const getStateCalls: string[] = [];
  const getCalls: string[] = [];
  let concurrentGetStates = 0;
  let maxConcurrentGetStates = 0;
  const client: FakeClient = {
    threads: {
      search: async (query) => {
        searchCalls.push(query);
        return searchedThreads;
      },
      getState: async (threadId) => {
        getStateCalls.push(threadId);
        concurrentGetStates += 1;
        maxConcurrentGetStates = Math.max(
          maxConcurrentGetStates,
          concurrentGetStates
        );
        try {
          if (getStateOptions.delayMs) {
            await new Promise((resolve) =>
              setTimeout(resolve, getStateOptions.delayMs)
            );
          }
          if (failState) throw new Error("state unavailable");
          return {
            thread_id: `state-${threadId}`,
            created_at: "2001-01-01T00:00:00.000Z",
            updated_at: "2002-02-02T00:00:00.000Z",
            status: "busy",
            metadata: {
              custom_title: "State metadata poison",
              is_favorite: false,
            },
            ...states[threadId],
          };
        } finally {
          concurrentGetStates -= 1;
        }
      },
      get: async (threadId) => {
        getCalls.push(threadId);
        return thread({ thread_id: threadId });
      },
      delete: async () => {},
      update: async (threadId) => thread({ thread_id: threadId }),
    },
  };
  return {
    client,
    searchCalls,
    getStateCalls,
    getCalls,
    maxConcurrentGetStates: () => maxConcurrentGetStates,
  };
}

let repositoryNumber = 0;

function repository(
  client: FakeClient,
  deploymentUrl = `http://langgraph.test/${repositoryNumber++}`
) {
  return new LangGraphThreadRepository(
    { deploymentUrl, apiKey: "test-key" },
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
  const fake = fakeClient(
    [
      thread({
        metadata: { custom_title: "Manual title" },
        values: { messages: [] },
      }),
    ],
    {
      "12345678-1234-1234-1234-123456789abc": {
        values: {
          messages: [{ type: "human", content: "State-only generated title" }],
        },
      },
    }
  );

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Manual title");
  assert.equal(items[0]?.isUserDefinedTitle, true);
  assert.deepEqual(fake.getStateCalls, []);
  assert.deepEqual(fake.getCalls, []);
});

test("recovers missing completed titles from state for idle, interrupted, and error threads", async () => {
  const recoveryStatuses: ThreadStatus[] = ["idle", "interrupted", "error"];
  const threads = recoveryStatuses.map((status) =>
    thread({
      thread_id: `${status}-thread-id`,
      status,
      values: { messages: [] },
    })
  );
  const fake = fakeClient(
    threads,
    Object.fromEntries(
      recoveryStatuses.map((status) => [
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

test("recovers missing title from state on later search pages without replacing search fields", async () => {
  const searchThread = thread({
    thread_id: "search-thread-id",
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-08-01T11:00:00.000Z",
    metadata: { is_favorite: true },
    values: { messages: [] },
  });
  const fake = fakeClient([searchThread], {
    "search-thread-id": {
      values: {
        messages: [{ type: "human", content: "Second page recovered" }],
      },
    },
  });

  const items = await search(repository(fake.client), 1);

  assert.equal(items[0]?.title, "Second page recovered");
  assert.equal(items[0]?.id, "search-thread-id");
  assert.equal(items[0]?.isFavorite, true);
  assert.equal(items[0]?.createdAt?.toISOString(), "2026-07-01T10:00:00.000Z");
  assert.equal(items[0]?.updatedAt.toISOString(), "2026-08-01T11:00:00.000Z");
  assert.deepEqual(fake.getStateCalls, ["search-thread-id"]);
  assert.deepEqual(fake.getCalls, []);
});

test("uses stable ID fallback for busy threads and never loads their state", async () => {
  const fake = fakeClient([
    thread({ status: "busy", values: { messages: [] } }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Thread 12345678");
  assert.deepEqual(fake.getStateCalls, []);
  assert.deepEqual(fake.getCalls, []);
});

test("does not hydrate threads with an unrecognized runtime status", async () => {
  const fake = fakeClient([
    thread({ status: "unknown" as ThreadStatus, values: { messages: [] } }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Thread 12345678");
  assert.deepEqual(fake.getStateCalls, []);
  assert.deepEqual(fake.getCalls, []);
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
  assert.deepEqual(missingHuman.getCalls, []);
  assert.deepEqual(unavailable.getCalls, []);
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
          {
            type: "human",
            content: [
              { type: "image", image_url: "image" },
              { text: "Array title" },
            ],
          },
          {
            type: "ai",
            content: [{ type: "tool_use" }, { text: "Array description" }],
          },
        ],
      },
    }),
  ]);

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Array title");
  assert.equal(items[0]?.description, "Array description");
});

test("hydrates whitespace-only selected titles and normalizes recovered content blocks", async () => {
  const fake = fakeClient(
    [
      thread({
        values: { messages: [{ type: "human", content: "   " }] },
      }),
    ],
    {
      "12345678-1234-1234-1234-123456789abc": {
        values: {
          messages: [
            {
              type: "human",
              content: [{ type: "image" }, { text: " Recovered title " }],
            },
            {
              type: "ai",
              content: [
                { type: "tool_use" },
                { text: " Recovered description " },
              ],
            },
          ],
        },
      },
    }
  );

  const items = await search(repository(fake.client));

  assert.equal(items[0]?.title, "Recovered title");
  assert.equal(items[0]?.description, "Recovered description");
  assert.deepEqual(fake.getStateCalls, [
    "12345678-1234-1234-1234-123456789abc",
  ]);
  assert.deepEqual(fake.getCalls, []);
});

test("reuses unchanged recovered state across repository instances", async () => {
  const threadId = "cache-reuse-thread";
  const deploymentUrl = "http://cache-reuse.test/";
  const searchedThread = thread({
    thread_id: threadId,
    updated_at: "2026-08-18T12:00:00.000Z",
    values: { messages: [] },
  });
  const first = fakeClient([searchedThread], {
    [threadId]: {
      values: { messages: [{ type: "human", content: "Cached title" }] },
    },
  });
  const second = fakeClient([searchedThread]);

  const firstItems = await search(repository(first.client, deploymentUrl));
  const secondItems = await search(repository(second.client, deploymentUrl));

  assert.equal(firstItems[0]?.title, "Cached title");
  assert.equal(secondItems[0]?.title, "Cached title");
  assert.deepEqual(first.getStateCalls, [threadId]);
  assert.deepEqual(second.getStateCalls, []);
});

test("refreshes cached state when search updated_at changes", async () => {
  const threadId = "cache-update-thread";
  const deploymentUrl = "http://cache-update.test";
  const first = fakeClient(
    [
      thread({
        thread_id: threadId,
        updated_at: "2026-08-18T12:00:00.000Z",
        values: { messages: [] },
      }),
    ],
    {
      [threadId]: {
        values: { messages: [{ type: "human", content: "Old title" }] },
      },
    }
  );
  const second = fakeClient(
    [
      thread({
        thread_id: threadId,
        updated_at: "2026-08-18T12:01:00.000Z",
        values: { messages: [] },
      }),
    ],
    {
      [threadId]: {
        values: { messages: [{ type: "human", content: "New title" }] },
      },
    }
  );

  const firstItems = await search(repository(first.client, deploymentUrl));
  const secondItems = await search(repository(second.client, deploymentUrl));

  assert.equal(firstItems[0]?.title, "Old title");
  assert.equal(secondItems[0]?.title, "New title");
  assert.deepEqual(first.getStateCalls, [threadId]);
  assert.deepEqual(second.getStateCalls, [threadId]);
});

test("does not share cached state across deployments", async () => {
  const threadId = "cache-deployment-thread";
  const searchedThread = thread({
    thread_id: threadId,
    updated_at: "2026-08-18T12:00:00.000Z",
    values: { messages: [] },
  });
  const first = fakeClient([searchedThread], {
    [threadId]: {
      values: { messages: [{ type: "human", content: "First deployment" }] },
    },
  });
  const second = fakeClient([searchedThread], {
    [threadId]: {
      values: { messages: [{ type: "human", content: "Second deployment" }] },
    },
  });

  const firstItems = await search(
    repository(first.client, "http://cache-a.test")
  );
  const secondItems = await search(
    repository(second.client, "http://cache-b.test")
  );

  assert.equal(firstItems[0]?.title, "First deployment");
  assert.equal(secondItems[0]?.title, "Second deployment");
  assert.deepEqual(first.getStateCalls, [threadId]);
  assert.deepEqual(second.getStateCalls, [threadId]);
});

test("caches successful no-human state while keeping failures retryable", async () => {
  const noHumanId = "cache-no-human-thread";
  const failureId = "cache-failure-thread";
  const noHumanDeployment = "http://cache-no-human.test";
  const failureDeployment = "http://cache-failure.test";
  const noHumanThread = thread({
    thread_id: noHumanId,
    updated_at: "2026-08-18T12:00:00.000Z",
    values: { messages: [] },
  });
  const failureThread = thread({
    thread_id: failureId,
    updated_at: "2026-08-18T12:00:00.000Z",
    values: { messages: [] },
  });
  const noHumanFirst = fakeClient([noHumanThread]);
  const noHumanSecond = fakeClient([noHumanThread]);
  const failed = fakeClient([failureThread], {}, true);
  const retry = fakeClient([failureThread], {
    [failureId]: {
      values: {
        messages: [{ type: "human", content: "Recovered after retry" }],
      },
    },
  });

  const [firstNoHuman] = await search(
    repository(noHumanFirst.client, noHumanDeployment)
  );
  const [secondNoHuman] = await search(
    repository(noHumanSecond.client, noHumanDeployment)
  );
  const [failedItem] = await search(
    repository(failed.client, failureDeployment)
  );
  const [retriedItem] = await search(
    repository(retry.client, failureDeployment)
  );

  assert.equal(firstNoHuman?.title, "Thread cache-no");
  assert.equal(secondNoHuman?.title, "Thread cache-no");
  assert.deepEqual(noHumanFirst.getStateCalls, [noHumanId]);
  assert.deepEqual(noHumanSecond.getStateCalls, []);
  assert.equal(failedItem?.title, "Thread cache-fa");
  assert.equal(retriedItem?.title, "Recovered after retry");
  assert.deepEqual(failed.getStateCalls, [failureId]);
  assert.deepEqual(retry.getStateCalls, [failureId]);
});

test("limits title hydration concurrency while preserving thread order", async () => {
  const deploymentUrl = "http://cache-concurrency.test";
  const threads = Array.from({ length: 20 }, (_, index) =>
    thread({
      thread_id: `concurrency-thread-${index}`,
      updated_at: "2026-08-18T12:00:00.000Z",
      values: { messages: [] },
    })
  );
  const states = Object.fromEntries(
    threads.map((thread) => [
      thread.thread_id,
      {
        values: {
          messages: [{ type: "human", content: `Title ${thread.thread_id}` }],
        },
      },
    ])
  );
  const fake = fakeClient(threads, states, false, { delayMs: 10 });

  const items = await search(repository(fake.client, deploymentUrl));

  assert.equal(fake.getStateCalls.length, 20);
  assert.ok(fake.maxConcurrentGetStates() <= 4);
  assert.deepEqual(
    items.map((item) => item.id),
    threads.map((thread) => thread.thread_id)
  );
  assert.deepEqual(
    items.map((item) => item.title),
    threads.map((thread) => `Title ${thread.thread_id}`)
  );
});
