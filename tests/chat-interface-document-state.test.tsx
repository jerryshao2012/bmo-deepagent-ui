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
import { SWRConfig, unstable_serialize } from "swr";

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
type SendCall = {
  threadId: string;
  message: string;
  values: Record<string, unknown>;
};

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
    stream: {},
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
  rejectWrite?: (values: Record<string, unknown>) => boolean
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
        if (rejectWrite?.(values)) throw new Error("state unavailable");
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
}: {
  client: never;
  chat: never;
  canSwitch?: boolean;
}) {
  const [, setThreadId] = useQueryState("threadId");
  return (
    <ClientContext.Provider value={{ client }}>
      <ChatContext.Provider value={chat}>
        {canSwitch && (
          <>
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
        <ChatInterface assistant={assistant} />
      </ChatContext.Provider>
    </ClientContext.Provider>
  );
}

function renderChat({
  client,
  chat,
  canSwitch = false,
  strictMode = false,
}: {
  client: never;
  chat: never;
  canSwitch?: boolean;
  strictMode?: boolean;
}) {
  const cache = new Map([
    [unstable_serialize({ kind: "thread-status", threadId: "A" }), "idle"],
    [unstable_serialize({ kind: "thread-status", threadId: "B" }), "idle"],
  ]);
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
            />
          </React.StrictMode>
        ) : (
          <Harness
            client={client}
            chat={chat}
            canSwitch={canSwitch}
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
    await waitFor(() =>
      assert.ok(
        writes.some(
          (write) =>
            write.threadId === "B" && write.values.has_documents === false
        )
      )
    );
    assert.deepEqual(wikiTreeThreads, ["A"]);
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
      assert.ok(
        wikiTreeThreads.length > 0 &&
          wikiTreeThreads.every((threadId) => threadId === "A")
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() => assert.equal(listCalls, 2));
    await waitFor(() =>
      assert.ok(
        writes.some(
          (write) =>
            write.threadId === "B" && write.values.has_documents === false
        )
      )
    );
    assert.ok(wikiTreeThreads.every((threadId) => threadId === "A"));

    await act(async () => {
      for (const response of aWikiResponses) {
        response.resolve(
          new Response(JSON.stringify({ file_count: 99 }), { status: 200 })
        );
      }
      await Promise.all(aWikiResponses.map((response) => response.promise));
    });

    await dropFile(view.container, "b.pdf");
    await waitFor(() => assert.ok(wikiTreeThreads.includes("B")));
    assert.ok(screen.getByRole("button", { name: "Wiki", exact: true }));

    await act(async () => {
      bWikiResponse.resolve(
        new Response(JSON.stringify({ file_count: 7 }), { status: 200 })
      );
      await bWikiResponse.promise;
    });
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: "Wiki7", exact: true }))
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

test("actual submit sends pending folder and forced availability on current LangGraph thread", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sends: SendCall[] = [];
  const uploadFolders: string[] = [];
  const restoreFetch = installFetch({ uploadFolders });
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};

  try {
    const view = renderChat({
      client: makeClient(
        writes,
        (values) => typeof values.doc_folder === "string"
      ),
      chat: baseChat((message, values) =>
        sends.push({ threadId: "A", message, values })
      ),
    });
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

    await dropFile(view.container);
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/A"]));
    await waitFor(() =>
      assert.equal(
        writes.filter((write) => typeof write.values.doc_folder === "string")
          .length,
        1
      )
    );

    const composer = screen.getByPlaceholderText("Write your message...");
    fireEvent.change(composer, { target: { value: "Research this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    assert.deepEqual(sends, [
      {
        threadId: "A",
        message: "Research this",
        values: {
          no_web: false,
          has_documents: true,
          doc_folder: "docs/threads/A",
        },
      },
    ]);
  } finally {
    restoreFetch();
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test("actual submit sends exact folder while positive list persistence is pending", async () => {
  configure();
  const positivePersistence = deferred<void>();
  const persistedState: Record<string, unknown> = {
    has_documents: false,
    doc_folder: null,
  };
  const writes: StateWrite[] = [];
  const sends: SendCall[] = [];
  const uploadFolders: string[] = [];
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async () =>
      documentsResponse([{ name: "listed.pdf", size: 4, type: "file" }]),
  });
  const client = {
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
        if (values.has_documents === true) {
          await positivePersistence.promise;
        }
        Object.assign(persistedState, values);
      },
    },
  } as never;

  try {
    renderChat({
      client,
      chat: baseChat((message, values) =>
        sends.push({ threadId: "A", message, values })
      ),
    });
    await waitFor(() =>
      assert.ok(
        writes.some(
          (write) =>
            write.threadId === "A" && write.values.has_documents === true
        )
      )
    );
    assert.deepEqual(persistedState, {
      has_documents: false,
      doc_folder: null,
    });

    const composer = screen.getByPlaceholderText("Write your message...");
    fireEvent.change(composer, { target: { value: "Use listed document" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    assert.deepEqual(sends, [
      {
        threadId: "A",
        message: "Use listed document",
        values: {
          no_web: false,
          has_documents: true,
          doc_folder: "docs/threads/A",
        },
      },
    ]);
  } finally {
    await act(async () => {
      positivePersistence.resolve();
      await positivePersistence.promise;
    });
    restoreFetch();
  }
});

test("A to B navigation makes subsequent drag-drop upload and state update use B", async () => {
  configure();
  const writes: StateWrite[] = [];
  const uploadFolders: string[] = [];
  const restoreFetch = installFetch({ uploadFolders });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat(() => {}),
      canSwitch: true,
    });
    await waitFor(() =>
      assert.ok(writes.some((write) => write.threadId === "A"))
    );

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() =>
      assert.ok(writes.some((write) => write.threadId === "B"))
    );
    writes.length = 0;

    await dropFile(view.container, "b.pdf");
    await waitFor(() => assert.deepEqual(uploadFolders, ["threads/B"]));
    await waitFor(() =>
      assert.deepEqual(writes, [
        {
          threadId: "B",
          values: {
            has_documents: true,
            doc_folder: "docs/threads/B",
          },
        },
      ])
    );
  } finally {
    restoreFetch();
  }
});

test("same-thread upload wins over late empty list and submit never sends false", async () => {
  configure();
  const initialList = deferred<Response>();
  let listCalls = 0;
  const writes: StateWrite[] = [];
  const sends: SendCall[] = [];
  const uploadFolders: string[] = [];
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async () => {
      listCalls += 1;
      return listCalls === 1 ? initialList.promise : documentsResponse([]);
    },
  });

  try {
    const view = renderChat({
      client: makeClient(writes),
      chat: baseChat((message, values) =>
        sends.push({ threadId: "A", message, values })
      ),
    });
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

    await dropFile(view.container);
    await waitFor(() =>
      assert.ok(
        writes.some(
          (write) =>
            write.threadId === "A" && write.values.has_documents === true
        )
      )
    );
    await act(async () => {
      initialList.resolve(documentsResponse([]));
      await initialList.promise;
    });

    const composer = screen.getByPlaceholderText("Write your message...");
    fireEvent.change(composer, { target: { value: "Use my document" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    assert.equal(listCalls, 1);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].threadId, "A");
    assert.equal(sends[0].values.has_documents, true);
  } finally {
    restoreFetch();
  }
});

test("two concurrent successful deletes remove both documents and persist false", async () => {
  configure();
  const deleteOne = deferred<Response>();
  const deleteTwo = deferred<Response>();
  const writes: StateWrite[] = [];
  const uploadFolders: string[] = [];
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async () =>
      documentsResponse([
        { name: "one.pdf", size: 1, type: "file" },
        { name: "two.pdf", size: 2, type: "file" },
      ]),
    onDelete: async (filename) =>
      filename === "one.pdf" ? deleteOne.promise : deleteTwo.promise,
  });
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = () => true;

  try {
    renderChat({
      client: makeClient(writes),
      chat: baseChat(() => {}),
    });
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /Docs/ }))
    );
    fireEvent.click(screen.getByRole("button", { name: /Docs/ }));
    writes.length = 0;

    const deleteButton = (filename: string) => {
      const view = screen.getByTitle(`View ${filename}`);
      return view.parentElement!.querySelector(
        'button[title="Delete document"]'
      ) as HTMLButtonElement;
    };
    fireEvent.click(deleteButton("one.pdf"));
    fireEvent.click(deleteButton("two.pdf"));

    await act(async () => {
      deleteOne.resolve(new Response(null, { status: 200 }));
      deleteTwo.resolve(new Response(null, { status: 200 }));
      await Promise.all([deleteOne.promise, deleteTwo.promise]);
    });

    await waitFor(() =>
      assert.deepEqual(writes.at(-1), {
        threadId: "A",
        values: { has_documents: false, doc_folder: null },
      })
    );
    assert.equal(screen.queryByTitle("View one.pdf"), null);
    assert.equal(screen.queryByTitle("View two.pdf"), null);
  } finally {
    restoreFetch();
    globalThis.confirm = originalConfirm;
  }
});

test("last delete clears failed-upload pending folder before submit", async () => {
  configure();
  const writes: StateWrite[] = [];
  const sends: SendCall[] = [];
  const uploadFolders: string[] = [];
  const restoreFetch = installFetch({ uploadFolders });
  const originalConfirm = globalThis.confirm;
  const originalError = console.error;
  const originalWarn = console.warn;
  globalThis.confirm = () => true;
  console.error = () => {};
  console.warn = () => {};

  try {
    const view = renderChat({
      client: makeClient(
        writes,
        (values) => typeof values.doc_folder === "string"
      ),
      chat: baseChat((message, values) =>
        sends.push({ threadId: "A", message, values })
      ),
    });
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

    await dropFile(view.container, "only.pdf");
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /Docs/ }))
    );
    fireEvent.click(screen.getByRole("button", { name: /Docs/ }));
    const viewButton = screen.getByTitle("View only.pdf");
    const deleteButton = viewButton.parentElement!.querySelector(
      'button[title="Delete document"]'
    ) as HTMLButtonElement;
    fireEvent.click(deleteButton);
    await waitFor(() =>
      assert.deepEqual(writes.at(-1), {
        threadId: "A",
        values: { has_documents: false, doc_folder: null },
      })
    );

    const composer = screen.getByPlaceholderText("Write your message...");
    fireEvent.change(composer, { target: { value: "Continue" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    assert.deepEqual(sends, [
      {
        threadId: "A",
        message: "Continue",
        values: { no_web: false, has_documents: false },
      },
    ]);
  } finally {
    restoreFetch();
    globalThis.confirm = originalConfirm;
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test("cross-thread last delete cannot leak A pending folder into B or later A submit", async () => {
  configure();
  const deleteResponse = deferred<Response>();
  const writes: StateWrite[] = [];
  const sends: Array<{ message: string; values: Record<string, unknown> }> = [];
  const uploadFolders: string[] = [];
  const restoreFetch = installFetch({
    uploadFolders,
    onList: async () => documentsResponse([]),
    onDelete: async () => deleteResponse.promise,
  });
  const originalConfirm = globalThis.confirm;
  const originalError = console.error;
  const originalWarn = console.warn;
  globalThis.confirm = () => true;
  console.error = () => {};
  console.warn = () => {};

  try {
    const view = renderChat({
      client: makeClient(
        writes,
        (values) => typeof values.doc_folder === "string"
      ),
      chat: baseChat((message, values) => sends.push({ message, values })),
      canSwitch: true,
    });
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

    await dropFile(view.container, "only.pdf");
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /Docs/ }))
    );
    fireEvent.click(screen.getByRole("button", { name: /Docs/ }));
    const viewButton = screen.getByTitle("View only.pdf");
    const deleteButton = viewButton.parentElement!.querySelector(
      'button[title="Delete document"]'
    ) as HTMLButtonElement;
    fireEvent.click(deleteButton);

    fireEvent.click(screen.getByRole("button", { name: "Switch to B" }));
    await waitFor(() =>
      assert.ok(
        writes.some(
          (write) =>
            write.threadId === "B" && write.values.has_documents === false
        )
      )
    );
    await act(async () => {
      deleteResponse.resolve(new Response(null, { status: 200 }));
      await deleteResponse.promise;
    });

    const composer = screen.getByPlaceholderText("Write your message...");
    fireEvent.change(composer, { target: { value: "Research B" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    assert.deepEqual(sends.at(-1), {
      message: "Research B",
      values: { no_web: false, has_documents: false },
    });

    const writesBeforeReturn = writes.length;
    fireEvent.click(screen.getByRole("button", { name: "Switch to A" }));
    await waitFor(() =>
      assert.ok(
        writes
          .slice(writesBeforeReturn)
          .some(
            (write) =>
              write.threadId === "A" && write.values.has_documents === false
          )
      )
    );

    fireEvent.change(composer, { target: { value: "Research A" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    assert.deepEqual(sends.at(-1), {
      message: "Research A",
      values: { no_web: false, has_documents: false },
    });
  } finally {
    restoreFetch();
    globalThis.confirm = originalConfirm;
    console.error = originalError;
    console.warn = originalWarn;
  }
});
