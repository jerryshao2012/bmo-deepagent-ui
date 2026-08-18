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
  waitFor,
} from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { useQueryState } from "nuqs";
import { SWRConfig, unstable_serialize, type Cache } from "swr";

import { ChatInterface } from "../src/app/components/ChatInterface";
import { ChatContext } from "../src/providers/ChatContext";
import { ClientContext } from "../src/providers/ClientContext";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: TestResizeObserver,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

type StateWrite = { threadId: string; values: Record<string, unknown> };
const assistant = {
  assistant_id: "assistant-1",
  graph_id: "research",
} as never;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const documentsResponse = (items: unknown[]) =>
  new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function baseChat(
  sendMessage: (message: string, values: Record<string, unknown>) => void
) {
  return {
    stream: { getSubagent: () => undefined },
    messages: [],
    todos: [],
    files: {},
    ui: [],
    chatStartTime: null,
    chatElapsedSeconds: null,
    messageTimings: {},
    processingHumanMessageId: null,
    streamError: null,
    clearStreamError() {},
    setFiles: async () => {},
    isLoading: false,
    isThreadLoading: false,
    interrupt: undefined,
    sendMessage,
    stopStream() {},
    resumeInterrupt() {},
    no_web: false,
  } as never;
}

function makeClient(
  writes: StateWrite[],
  rejectWrite?: (values: Record<string, unknown>) => boolean,
  rejectMessage = "state unavailable"
) {
  return {
    threads: {
      create: async ({ threadId }: { threadId?: string }) => ({
        thread_id: threadId ?? "created-thread",
      }),
      get: async (threadId: string) => ({
        thread_id: threadId,
        status: "idle",
        metadata: { graph_id: "research" },
      }),
      update: async () => ({}),
      updateState: async (
        threadId: string,
        { values }: { values: Record<string, unknown> }
      ) => {
        writes.push({ threadId, values });
        if (rejectWrite?.(values)) throw new Error(rejectMessage);
      },
    },
  } as never;
}

function configure() {
  localStorage.setItem(
    "deep-agent-config",
    JSON.stringify({
      deploymentUrl: "https://backend.example.com",
      assistantId: "assistant-1",
    })
  );
}

function Harness({
  client,
  chat,
  canSwitch = false,
  canToggleLoading = false,
}: {
  client: never;
  chat: never;
  canSwitch?: boolean;
  canToggleLoading?: boolean;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const [isLoading, setIsLoading] = React.useState(false);
  return (
    <ClientContext.Provider value={{ client }}>
      <ChatContext.Provider
        value={canToggleLoading ? { ...chat, isLoading } : chat}
      >
        {canSwitch && (
          <>
            <output data-testid="active-thread">{threadId}</output>
            <button
              type="button"
              onClick={() => setThreadId("A")}
            >
              Switch to A
            </button>
            <button
              type="button"
              onClick={() => setThreadId("B")}
            >
              Switch to B
            </button>
          </>
        )}
        {canToggleLoading && (
          <button
            type="button"
            onClick={() => setIsLoading((loading) => !loading)}
          >
            Toggle loading
          </button>
        )}
        <ChatInterface assistant={assistant} />
      </ChatContext.Provider>
    </ClientContext.Provider>
  );
}

function renderChat({
  client,
  chat,
  canSwitch = false,
  canToggleLoading = false,
  strictMode = false,
}: {
  client: never;
  chat: never;
  canSwitch?: boolean;
  canToggleLoading?: boolean;
  strictMode?: boolean;
}) {
  const cache = new Map([
    [unstable_serialize({ kind: "thread-status", threadId: "A" }), "idle"],
    [unstable_serialize({ kind: "thread-status", threadId: "B" }), "idle"],
  ]) as unknown as Cache<any>;
  return render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      <NuqsTestingAdapter
        searchParams="?threadId=A"
        hasMemory
      >
        {strictMode ? (
          <React.StrictMode>
            <Harness
              client={client}
              chat={chat}
              canSwitch={canSwitch}
              canToggleLoading={canToggleLoading}
            />
          </React.StrictMode>
        ) : (
          <Harness
            client={client}
            chat={chat}
            canSwitch={canSwitch}
            canToggleLoading={canToggleLoading}
          />
        )}
      </NuqsTestingAdapter>
    </SWRConfig>
  );
}

function installFetch({
  onList = async () => documentsResponse([]),
  onDelete = async () => new Response(null, { status: 200 }),
  onWikiTree = async () =>
    new Response(JSON.stringify({ file_count: 0 }), { status: 200 }),
  uploadFolders,
  wikiTreeThreads = [],
}: {
  onList?: (threadId: string) => Promise<Response>;
  onDelete?: (filename: string, threadId: string) => Promise<Response>;
  onWikiTree?: (threadId: string) => Promise<Response>;
  uploadFolders: string[];
  wikiTreeThreads?: string[];
}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/documents/list") {
      const folder = url.searchParams.get("folder") ?? "";
      return onList(folder.replace(/^threads\//, ""));
    }
    if (url.pathname === "/documents/upload") {
      const body = init?.body as FormData;
      uploadFolders.push(String(body.get("folder")));
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.pathname.startsWith("/documents/") && init?.method === "DELETE") {
      const filename = decodeURIComponent(
        url.pathname.slice("/documents/".length)
      );
      const folder = url.searchParams.get("folder") ?? "";
      return onDelete(filename, folder.replace(/^threads\//, ""));
    }
    if (url.pathname.endsWith("/wiki/tree")) {
      const threadId = url.pathname.split("/")[2] ?? "";
      wikiTreeThreads.push(threadId);
      return onWikiTree(threadId);
    }
    if (url.pathname.endsWith("/wiki/status")) {
      return new Response(
        JSON.stringify({ is_active: false, wiki_ready: false }),
        { status: 200 }
      );
    }
    if (url.pathname.endsWith("/wiki/progress")) {
      return new Response(null, { status: 404 });
    }
    if (/^\/threads\/[^/]+$/.test(url.pathname)) {
      return new Response(JSON.stringify({ status: "idle", metadata: {} }), {
        status: 200,
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("wiki count waits for confirmed documents and does not leak availability across threads", async () => {
  configure();
  const uploadFolders: string[] = [];
  const wikiTreeThreads: string[] = [];
  const writes: StateWrite[] = [];
  let listCalls = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    wikiTreeThreads,
    onList: async (threadId) => {
      listCalls += 1;
      if (threadId === "A") {
        return documentsResponse([
          { name: "listed.pdf", size: 4, type: "file" },
        ]);
      }
      return new Response(null, { status: 404 });
    },
  });

  try {
    renderChat({
      client: makeClient(writes),
      chat: baseChat(() => {}),
      canSwitch: true,
    });

    await waitFor(() => assert.equal(listCalls, 1));
    await waitFor(() => assert.deepEqual(wikiTreeThreads, ["A"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() => assert.equal(listCalls, 2));
    assert.deepEqual(writes, []);
    assert.deepEqual(wikiTreeThreads, ["A"]);
  } finally {
    restoreFetch();
  }
});

test("open wiki does not probe next thread before document availability is confirmed", async () => {
  configure();
  const uploadFolders: string[] = [];
  const wikiTreeThreads: string[] = [];
  const writes: StateWrite[] = [];
  const bListResponse = deferred<Response>();
  let listCalls = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    wikiTreeThreads,
    onList: async (threadId) => {
      listCalls += 1;
      if (threadId === "A") {
        return documentsResponse([
          { name: "listed.pdf", size: 4, type: "file" },
        ]);
      }
      return bListResponse.promise;
    },
  });

  try {
    renderChat({
      client: makeClient(writes),
      chat: baseChat(() => {}),
      canSwitch: true,
    });
    await waitFor(() => assert.equal(listCalls, 1));
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /Wiki/ }))
    );

    fireEvent.click(screen.getByRole("button", { name: /Wiki/ }));
    await waitFor(() => assert.ok(wikiTreeThreads.includes("A")));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() => assert.equal(listCalls, 2));
    assert.equal(
      wikiTreeThreads.every((threadId) => threadId === "A"),
      true
    );

    await act(async () => {
      bListResponse.resolve(new Response(null, { status: 404 }));
      await bListResponse.promise;
    });
    assert.deepEqual(writes, []);
    assert.equal(screen.queryByRole("button", { name: /^Wiki/ }), null);
  } finally {
    restoreFetch();
  }
});

test("stale wiki count response cannot repopulate after switching threads", async () => {
  configure();
  const uploadFolders: string[] = [];
  const wikiTreeThreads: string[] = [];
  const writes: StateWrite[] = [];
  const aWikiResponses = [deferred<Response>(), deferred<Response>()];
  const bWikiResponse = deferred<Response>();
  let listCalls = 0;
  let aWikiCalls = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    wikiTreeThreads,
    onList: async (threadId) => {
      listCalls += 1;
      if (threadId === "A") {
        return documentsResponse([
          { name: "listed.pdf", size: 4, type: "file" },
        ]);
      }
      return new Response(null, { status: 404 });
    },
    onWikiTree: async (threadId) => {
      if (threadId === "B") {
        return bWikiResponse.promise;
      }
      if (threadId !== "A") {
        return new Response(JSON.stringify({ file_count: 0 }), {
          status: 200,
        });
      }
      aWikiCalls += 1;
      return aWikiResponses[Math.min(aWikiCalls - 1, aWikiResponses.length - 1)]
        .promise;
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat(() => {}),
      canSwitch: true,
      strictMode: true,
    });
    await waitFor(() =>
      assert.equal(
        wikiTreeThreads.length > 0 &&
          wikiTreeThreads.every((threadId) => threadId === "A"),
        true
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() => assert.equal(listCalls, 2));
    assert.deepEqual(writes, []);
    assert.equal(
      wikiTreeThreads.every((threadId) => threadId === "A"),
      true
    );

    await act(async () => {
      for (const response of aWikiResponses) {
        response.resolve(
          new Response(JSON.stringify({ file_count: 99 }), { status: 200 })
        );
      }
      await Promise.all(aWikiResponses.map((response) => response.promise));
    });

    await dropFile(view.container, "b.pdf");
    await waitFor(() =>
      assert.equal(
        wikiTreeThreads.some((threadId) => threadId === "B"),
        true
      )
    );
    assert.ok(screen.getByRole("button", { name: /^Wiki$/ }));

    await act(async () => {
      bWikiResponse.resolve(
        new Response(JSON.stringify({ file_count: 7 }), { status: 200 })
      );
      await bWikiResponse.promise;
    });
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /^Wiki7$/ }))
    );
  } finally {
    restoreFetch();
  }
});

async function dropFile(container: HTMLElement, filename = "upload.pdf") {
  const root = container.lastElementChild as HTMLElement;
  const file = new File(["pdf"], filename, { type: "application/pdf" });
  fireEvent.drop(root, {
    dataTransfer: { files: [file], types: ["Files"] },
  });
}

function submitMessage(message: string) {
  fireEvent.change(screen.getByPlaceholderText("Write your message..."), {
    target: { value: message },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

async function waitForComposer() {
  await waitFor(() =>
    assert.equal(
      (
        screen.getByPlaceholderText(
          "Write your message..."
        ) as HTMLTextAreaElement
      ).disabled,
      false
    )
  );
}

async function waitForActiveThread(threadId: string) {
  await waitFor(() =>
    assert.equal(screen.getByTestId("active-thread").textContent, threadId)
  );
}

test("retains A upload evidence through later A confirmation and failed refresh", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const failedARefresh = deferred<Response>();
  let aLists = 0;
  let bLists = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      if (threadId === "A") {
        aLists += 1;
        if (aLists === 1) {
          return documentsResponse([]);
        }
        if (aLists === 2) {
          return documentsResponse([
            { name: "confirmed-a.pdf", size: 4, type: "file" },
          ]);
        }
        return failedARefresh.promise;
      }
      bLists += 1;
      return documentsResponse([]);
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    await waitFor(() => assert.equal(aLists, 1));
    await waitForComposer();
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await waitFor(() => assert.equal(bLists, 1));
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitFor(() => assert.equal(aLists, 2));
    await screen.findByRole("button", { name: /^Docs/ });
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await waitFor(() => assert.equal(bLists, 2));
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForComposer();
    await waitFor(() => assert.equal(aLists, 3));
    await act(async () => {
      failedARefresh.resolve(new Response(null, { status: 500 }));
      await failedARefresh.promise;
    });

    submitMessage("Research A");
    assert.deepEqual(sent, [
      [
        "Research A",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/A" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    restoreFetch();
  }
});

test("confirmed A list evidence re-seeds A after accepted upload evidence is cleared", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const failedARefresh = deferred<Response>();
  let aLists = 0;
  let bLists = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      if (threadId === "A") {
        aLists += 1;
        if (aLists === 1) {
          return new Response(null, { status: 500 });
        }
        if (aLists === 3) return failedARefresh.promise;
        return documentsResponse([
          { name: "confirmed-a.pdf", size: 4, type: "file" },
        ]);
      }
      bLists += 1;
      return documentsResponse([]);
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    await waitForComposer();
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));
    submitMessage("Research A with upload evidence");

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForActiveThread("B");
    await waitFor(() => assert.equal(bLists, 1));
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForActiveThread("A");
    await waitFor(() => assert.equal(aLists, 2));
    await screen.findByRole("button", { name: /^Docs/ });
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForActiveThread("B");
    await waitFor(() => assert.equal(bLists, 2));
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForActiveThread("A");
    await waitFor(() => assert.equal(aLists, 3));
    await act(async () => {
      failedARefresh.resolve(new Response(null, { status: 500 }));
      await failedARefresh.promise;
    });
    submitMessage("Research A with re-seeded evidence");

    assert.deepEqual(sent, [
      [
        "Research A with upload evidence",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/A" },
      ],
      [
        "Research A with re-seeded evidence",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/A" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    restoreFetch();
  }
});

test("keeps simultaneous uploads scoped to each thread's canonical folder", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const failedARefresh = deferred<Response>();
  let aLists = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      if (threadId === "A") {
        aLists += 1;
        return aLists === 1 ? documentsResponse([]) : failedARefresh.promise;
      }
      return documentsResponse([]);
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    await waitForComposer();
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await dropFile(view.container, "b.pdf");
    await waitFor(() =>
      assert.deepEqual(uploadFolders, ["threads/A", "threads/B"])
    );

    submitMessage("Research B");
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForComposer();
    await waitFor(() => assert.equal(aLists, 2));
    await act(async () => {
      failedARefresh.resolve(new Response(null, { status: 500 }));
      await failedARefresh.promise;
    });
    submitMessage("Research A");

    assert.deepEqual(sent, [
      [
        "Research B",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/B" },
      ],
      [
        "Research A",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/A" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    restoreFetch();
  }
});

test("delete-to-empty removes only deleted thread's unsent positive evidence", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const deletedThreads: string[] = [];
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) =>
      documentsResponse(
        threadId === "A"
          ? [{ name: "a.pdf", size: 3, type: "file" }]
          : [{ name: "b.pdf", size: 3, type: "file" }]
      ),
    onDelete: async (_filename, threadId) => {
      deletedThreads.push(threadId);
      return new Response(null, { status: 200 });
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    await waitForComposer();
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await dropFile(view.container, "b.pdf");
    await waitFor(() =>
      assert.deepEqual(uploadFolders, ["threads/A", "threads/B"])
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForComposer();
    await screen.findByRole("button", { name: /^Docs/ });
    fireEvent.click(screen.getByRole("button", { name: /^Docs/ }));
    await screen.findByTitle("View a.pdf");
    fireEvent.click(screen.getByTitle("Delete document"));
    await waitFor(() => assert.deepEqual(deletedThreads, ["A"]));
    await waitFor(() => assert.equal(screen.queryByTitle("View a.pdf"), null));
    submitMessage("Research A after delete");

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    submitMessage("Research B remains");
    assert.deepEqual(sent, [
      [
        "Research A after delete",
        { no_web: false, has_documents: false, doc_folder: null },
      ],
      [
        "Research B remains",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/B" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    globalThis.confirm = originalConfirm;
    restoreFetch();
  }
});

test("deferred A delete clears A evidence after B navigation without clearing B", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const deletedThreads: string[] = [];
  const deleteA = deferred<Response>();
  const failedARefresh = deferred<Response>();
  const listCalls = { A: 0, B: 0 };
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      listCalls[threadId as "A" | "B"] += 1;
      if (threadId === "A") {
        return listCalls.A < 3
          ? documentsResponse([{ name: "a.pdf", size: 3, type: "file" }])
          : failedARefresh.promise;
      }
      return listCalls.B === 1
        ? documentsResponse([])
        : new Response(null, { status: 500 });
    },
    onDelete: async (_filename, threadId) => {
      deletedThreads.push(threadId);
      return deleteA.promise;
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    await waitForComposer();
    await screen.findByRole("button", { name: /^Docs/ });
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForActiveThread("B");
    await waitFor(() => assert.equal(listCalls.B, 1));
    await waitForComposer();
    await dropFile(view.container, "b.pdf");
    await waitFor(() =>
      assert.deepEqual(uploadFolders, ["threads/A", "threads/B"])
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForActiveThread("A");
    await waitFor(() => assert.equal(listCalls.A, 2));
    await screen.findByRole("button", { name: /^Docs/ });
    fireEvent.click(screen.getByRole("button", { name: /^Docs/ }));
    await screen.findByTitle("View a.pdf");
    fireEvent.click(screen.getByTitle("Delete document"));
    await waitFor(() => assert.deepEqual(deletedThreads, ["A"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForActiveThread("B");
    await waitFor(() => assert.equal(listCalls.B, 2));
    await act(async () => {
      deleteA.resolve(new Response(null, { status: 200 }));
      await deleteA.promise;
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForActiveThread("A");
    await waitFor(() => assert.equal(listCalls.A, 3));
    await act(async () => {
      failedARefresh.resolve(new Response(null, { status: 500 }));
      await failedARefresh.promise;
    });
    submitMessage("Research A after deferred delete");

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForActiveThread("B");
    await waitFor(() => assert.equal(listCalls.B, 3));
    submitMessage("Research B survives A delete");

    assert.deepEqual(sent, [
      ["Research A after deferred delete", { no_web: false }],
      [
        "Research B survives A delete",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/B" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    globalThis.confirm = originalConfirm;
    restoreFetch();
  }
});

test("accepted A submission clears A evidence while preserving B evidence", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const listCalls = { A: 0, B: 0 };
  const aFailures = [deferred<Response>(), deferred<Response>()];
  const bFailures = [deferred<Response>(), deferred<Response>()];
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      listCalls[threadId as "A" | "B"] += 1;
      const listCount = listCalls[threadId as "A" | "B"];
      if (listCount === 1) return documentsResponse([]);
      return (threadId === "A" ? aFailures : bFailures)[listCount - 2].promise;
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    await waitForComposer();
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await dropFile(view.container, "b.pdf");
    await waitFor(() =>
      assert.deepEqual(uploadFolders, ["threads/A", "threads/B"])
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForComposer();
    await waitFor(() => assert.equal(listCalls.A, 2));
    await act(async () => {
      aFailures[0].resolve(new Response(null, { status: 500 }));
      await aFailures[0].promise;
    });
    submitMessage("Research A");
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await waitFor(() => assert.equal(listCalls.B, 2));
    await act(async () => {
      bFailures[0].resolve(new Response(null, { status: 500 }));
      await bFailures[0].promise;
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForComposer();
    await waitFor(() => assert.equal(listCalls.A, 3));
    await act(async () => {
      aFailures[1].resolve(new Response(null, { status: 500 }));
      await aFailures[1].promise;
    });
    submitMessage("Research A after accepted send");
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await waitFor(() => assert.equal(listCalls.B, 3));
    await act(async () => {
      bFailures[1].resolve(new Response(null, { status: 500 }));
      await bFailures[1].promise;
    });
    submitMessage("Research B");

    assert.deepEqual(sent, [
      [
        "Research A",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/A" },
      ],
      ["Research A after accepted send", { no_web: false }],
      [
        "Research B",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/B" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    restoreFetch();
  }
});

test("synchronous A send failure retains A evidence for an unknown retry", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const failedARefresh = deferred<Response>();
  let aLists = 0;
  let bLists = 0;
  let throwNextSend = true;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      if (threadId === "A") {
        aLists += 1;
        return aLists === 1 ? documentsResponse([]) : failedARefresh.promise;
      }
      bLists += 1;
      return documentsResponse([]);
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => {
        sent.push([message, values]);
        if (throwNextSend) {
          throwNextSend = false;
          throw new Error("synchronous send failure");
        }
      }),
      canSwitch: true,
    });
    await waitForComposer();
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await waitFor(() => assert.equal(bLists, 1));
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitFor(() => assert.equal(aLists, 2));
    await act(async () => {
      failedARefresh.resolve(new Response(null, { status: 500 }));
      await failedARefresh.promise;
    });

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      submitMessage("Research A failing send");
    } finally {
      console.error = originalConsoleError;
    }
    submitMessage("Research A retry");

    assert.deepEqual(sent, [
      [
        "Research A failing send",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/A" },
      ],
      [
        "Research A retry",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/A" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    restoreFetch();
  }
});

test("A confirmation never leaks document state into B when B refresh fails", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  let bLists = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      if (threadId === "B") {
        bLists += 1;
        return new Response(null, { status: 500 });
      }
      return documentsResponse([]);
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    await waitForComposer();
    await dropFile(view.container, "a.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() => assert.equal(bLists, 1));
    await waitForComposer();

    submitMessage("Research B");
    assert.deepEqual(sent, [["Research B", { no_web: false }]]);
    assert.deepEqual(writes, []);
  } finally {
    restoreFetch();
  }
});

test("stale A empty evidence cannot clear B positive evidence during B refresh", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sent: Array<[string, Record<string, unknown>]> = [];
  const uploadFolders: string[] = [];
  const aConfirmedEmpty = deferred<Response>();
  const bRefresh = deferred<Response>();
  let aLists = 0;
  let bLists = 0;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async (threadId) => {
      if (threadId === "A") {
        aLists += 1;
        return aLists === 1 ? documentsResponse([]) : aConfirmedEmpty.promise;
      }
      bLists += 1;
      return bLists === 1 ? documentsResponse([]) : bRefresh.promise;
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) => sent.push([message, values])),
      canSwitch: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitForComposer();
    await dropFile(view.container, "b.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/B"]));

    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitForComposer();
    await waitFor(() => assert.equal(aLists, 2));
    await act(async () => {
      aConfirmedEmpty.resolve(documentsResponse([]));
      await aConfirmedEmpty.promise;
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() => assert.equal(bLists, 2));
    await waitForComposer();
    submitMessage("Research B");

    assert.deepEqual(sent, [
      [
        "Research B",
        { no_web: false, has_documents: true, doc_folder: "docs/threads/B" },
      ],
    ]);
    assert.deepEqual(writes, []);
  } finally {
    bRefresh.resolve(new Response(null, { status: 500 }));
    restoreFetch();
  }
});

test("shows active parallel research progress instead of root task ordinal", async () => {
  configure();
  const restoreFetch = installFetch({ uploadFolders: [] });
  try {
    renderChat({
      client: makeClient([]),
      chat: {
        ...baseChat(() => {}),
        isLoading: true,
        chatStartTime: Date.now() - 1_000,
        todos: [
          { id: "todo-1", content: "Root task", status: "in_progress" },
          { id: "todo-2", content: "Second task", status: "pending" },
          { id: "todo-3", content: "Third task", status: "pending" },
          { id: "todo-4", content: "Fourth task", status: "pending" },
          { id: "todo-5", content: "Fifth task", status: "pending" },
        ],
        messages: [
          {
            id: "parallel-research",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "research-1",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
              {
                id: "research-2",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
              {
                id: "research-3",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
            ],
          },
          {
            id: "research-1-result",
            type: "tool",
            content: "done",
            tool_call_id: "research-1",
          },
          {
            id: "research-2-result",
            type: "tool",
            content: "done",
            tool_call_id: "research-2",
          },
        ],
      } as never,
    });

    await screen.findByRole("button", {
      name: /Parallel research:\s*2\/3 complete\s+Root task/,
    });
    const activeTaskContent = await screen.findByText("Root task", {
      exact: true,
    });
    await waitFor(() =>
      assert.match(
        activeTaskContent.parentElement?.textContent ?? "",
        /\d+\.\ds/
      )
    );
  } finally {
    restoreFetch();
  }
});

test("preserves completed root task details during active parallel research", async () => {
  configure();
  const restoreFetch = installFetch({ uploadFolders: [] });
  try {
    renderChat({
      client: makeClient([]),
      chat: {
        ...baseChat(() => {}),
        chatElapsedSeconds: 12.3,
        todos: [
          { id: "todo-1", content: "First task", status: "completed" },
          { id: "todo-2", content: "Second task", status: "completed" },
          { id: "todo-3", content: "Third task", status: "completed" },
          { id: "todo-4", content: "Fourth task", status: "completed" },
          { id: "todo-5", content: "Fifth task", status: "completed" },
        ],
        messages: [
          {
            id: "parallel-research",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "research-1",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
              {
                id: "research-2",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
              {
                id: "research-3",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
            ],
          },
          {
            id: "research-1-result",
            type: "tool",
            content: "done",
            tool_call_id: "research-1",
          },
          {
            id: "research-2-result",
            type: "tool",
            content: "done",
            tool_call_id: "research-2",
          },
        ],
      } as never,
    });

    const parallelProgressLabel = await screen.findByText(
      "Parallel research: 2/3 complete",
      { exact: true }
    );
    const tasksTrigger = parallelProgressLabel.closest("button");
    assert.ok(tasksTrigger);
    assert.ok(tasksTrigger.querySelector("svg.text-success\\/80"));
    await screen.findByText("(Total for 12.3 seconds)", { exact: true });
  } finally {
    restoreFetch();
  }
});

test("returns to root task progress after parallel research batch is terminal", async () => {
  configure();
  const restoreFetch = installFetch({ uploadFolders: [] });
  try {
    renderChat({
      client: makeClient([]),
      chat: {
        ...baseChat(() => {}),
        todos: [
          { id: "todo-1", content: "Root task", status: "in_progress" },
          { id: "todo-2", content: "Second task", status: "pending" },
          { id: "todo-3", content: "Third task", status: "pending" },
          { id: "todo-4", content: "Fourth task", status: "pending" },
          { id: "todo-5", content: "Fifth task", status: "pending" },
        ],
        messages: [
          {
            id: "parallel-research",
            type: "ai",
            content: "",
            tool_calls: [
              {
                id: "research-1",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
              {
                id: "research-2",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
              {
                id: "research-3",
                name: "task",
                args: { subagent_type: "research-agent" },
              },
            ],
          },
          {
            id: "research-1-result",
            type: "tool",
            content: "done",
            tool_call_id: "research-1",
          },
          {
            id: "research-2-result",
            type: "tool",
            content: "done",
            tool_call_id: "research-2",
          },
          {
            id: "research-3-result",
            type: "tool",
            content: "done",
            tool_call_id: "research-3",
          },
        ],
      } as never,
    });

    await screen.findByText("Task 1 of 5", { exact: true });
    assert.equal(
      screen.queryByText("Parallel research: 2/3 complete", { exact: true }),
      null
    );
  } finally {
    restoreFetch();
  }
});

test("tasks panel collapses when switching threads", async () => {
  configure();
  const restoreFetch = installFetch({ uploadFolders: [] });
  try {
    renderChat({
      client: makeClient([]),
      chat: {
        ...baseChat(() => {}),
        todos: [{ id: "todo-1", content: "Retained task", status: "pending" }],
      } as never,
      canSwitch: true,
    });

    const collapsedTrigger = await screen.findByRole("button", {
      name: /Task 0 of 1/,
    });
    assert.equal(collapsedTrigger.getAttribute("aria-expanded"), "false");
    fireEvent.click(collapsedTrigger);
    assert.equal(
      screen
        .getByRole("button", { name: "Tasks", exact: true })
        .getAttribute("aria-expanded"),
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await act(async () => {});
    assert.ok(
      screen.queryByRole("button", { name: "Tasks", exact: true }) === null,
      "Tasks panel should close after switching threads"
    );
    const retainedTrigger = screen.getByRole("button", {
      name: /Task 0 of 1/,
    });
    assert.equal(retainedTrigger.getAttribute("aria-expanded"), "false");
  } finally {
    restoreFetch();
  }
});

test("same-thread loading changes keep an open tasks panel", async () => {
  configure();
  const restoreFetch = installFetch({ uploadFolders: [] });
  try {
    renderChat({
      client: makeClient([]),
      chat: {
        ...baseChat(() => {}),
        todos: [
          { id: "todo-1", content: "Active task", status: "in_progress" },
        ],
        interrupt: {} as never,
      } as never,
      canToggleLoading: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /Task 1 of 1/ }));
    const tasksTab = screen.getByRole("button", { name: "Tasks", exact: true });
    assert.equal(tasksTab.getAttribute("aria-expanded"), "true");

    fireEvent.click(screen.getByRole("button", { name: "Toggle loading" }));
    await waitFor(() =>
      assert.equal(
        screen
          .getByRole("button", { name: "Tasks", exact: true })
          .getAttribute("aria-expanded"),
        "true"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle loading" }));
    assert.equal(
      screen
        .getByRole("button", { name: "Tasks", exact: true })
        .getAttribute("aria-expanded"),
      "true"
    );
  } finally {
    restoreFetch();
  }
});

test("document refresh, upload, and delete never write LangGraph thread state", async () => {
  configure();
  const writes: StateWrite[] = [];
  const uploadFolders: string[] = [];
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async () =>
      documentsResponse([{ name: "listed.pdf", size: 4, type: "file" }]),
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat(() => {}),
    });
    await screen.findByRole("button", { name: /^Docs/ });
    assert.deepEqual(writes, []);
    fireEvent.click(screen.getByRole("button", { name: /^Docs/ }));
    fireEvent.click(screen.getByTitle("Delete document"));
    await waitFor(() =>
      assert.equal(screen.queryByRole("button", { name: /^Docs/ }), null)
    );
    assert.deepEqual(writes, []);

    await dropFile(view.container, "uploaded.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));
    await screen.findByTitle("View uploaded.pdf");
    await act(async () => {});
    assert.deepEqual(writes, []);
  } finally {
    globalThis.confirm = originalConfirm;
    restoreFetch();
  }
});
