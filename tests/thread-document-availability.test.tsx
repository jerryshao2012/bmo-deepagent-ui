import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { useThreadDocumentAvailability } from "../src/app/hooks/useThreadDocumentAvailability";

/* Replaced persistence-focused coverage below with local-state coverage. */
/*
import { submitResearchMessage } from "../src/app/utils/submit-research-message";

afterEach(cleanup);

type StateUpdate = {
  threadId: string;
  values: Record<string, unknown>;
};

const listResponse = (items: unknown[]) =>
  new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderAvailability({
  threadId = "thread-1",
  selectedThreadStatus = null,
  listDocuments,
}: {
  threadId?: string | null;
  selectedThreadStatus?: "busy" | "idle" | "interrupted" | "error" | null;
  listDocuments: (threadId: string) => Promise<Response>;
}) {
  const updates: StateUpdate[] = [];
  const updateThreadState = async (
    updatedThreadId: string,
    values: Record<string, unknown>
  ) => {
    updates.push({ threadId: updatedThreadId, values });
  };
  const hook = renderHook(
    ({ activeThreadId, status }) =>
      useThreadDocumentAvailability({
        threadId: activeThreadId,
        selectedThreadStatus: status,
        listDocuments,
        updateThreadState,
      }),
    { initialProps: { activeThreadId: threadId, status: selectedThreadStatus } }
  );
  return { ...hook, updates };
}

test("starts unknown while document availability is loading", () => {
  const pending = deferred<Response>();
  const { result } = renderAvailability({
    listDocuments: async () => pending.promise,
  });

  assert.deepEqual(result.current.documents, []);
  assert.equal(result.current.availability, null);
});

test("confirmed 404 means no documents and clears doc_folder", async () => {
  const { result, updates } = renderAvailability({
    listDocuments: async () => new Response(null, { status: 404 }),
  });

  await waitFor(() => assert.equal(result.current.availability, false));
  assert.deepEqual(result.current.documents, []);
  assert.deepEqual(updates, [
    {
      threadId: "thread-1",
      values: { has_documents: false, doc_folder: null },
    },
  ]);
});

test("confirmed empty and nonempty 200 responses serialize matching state", async () => {
  const empty = renderAvailability({
    threadId: "empty-thread",
    listDocuments: async () => listResponse([]),
  });
  await waitFor(() => assert.equal(empty.result.current.availability, false));
  assert.deepEqual(empty.updates, [
    {
      threadId: "empty-thread",
      values: { has_documents: false, doc_folder: null },
    },
  ]);

  cleanup();

  const populated = renderAvailability({
    threadId: "populated-thread",
    listDocuments: async () =>
      listResponse([
        { name: "report.pdf", size: 42, type: "file" },
        { name: "ignored", size: 0, type: "directory" },
      ]),
  });
  await waitFor(() =>
    assert.equal(populated.result.current.availability, true)
  );
  assert.deepEqual(populated.result.current.documents, [
    { name: "report.pdf", size: 42, type: "file" },
  ]);
  assert.deepEqual(populated.updates, [
    {
      threadId: "populated-thread",
      values: {
        has_documents: true,
        doc_folder: "docs/threads/populated-thread",
      },
    },
  ]);
});

test("positive refresh restores cleared persisted document state", async () => {
  const threadId = "recovered-thread";
  const persistedState: Record<string, unknown> = {
    has_documents: false,
    doc_folder: null,
  };
  const { result } = renderHook(() =>
    useThreadDocumentAvailability({
      threadId,
      listDocuments: async () =>
        listResponse([{ name: "recovered.pdf", size: 42, type: "file" }]),
      updateThreadState: async (_updatedThreadId, values) => {
        Object.assign(persistedState, values);
      },
    })
  );

  await waitFor(() => assert.equal(result.current.availability, true));
  assert.deepEqual(persistedState, {
    has_documents: true,
    doc_folder: `docs/threads/${threadId}`,
  });
});

for (const [name, listDocuments] of [
  ["network rejection", async () => Promise.reject(new Error("offline"))],
  ["server error", async () => new Response(null, { status: 500 })],
  [
    "malformed JSON",
    async () =>
      new Response("{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ],
] as const) {
  test(`${name} remains unknown and never persists false`, async () => {
    const { result, updates } = renderAvailability({ listDocuments });

    await waitFor(() => assert.equal(result.current.isRefreshing, false));
    assert.equal(result.current.availability, null);
    assert.deepEqual(result.current.documents, []);
    assert.deepEqual(updates, []);
  });
}

test("upload success uses exact active LangGraph thread ID and persists its folder", async () => {
  const threadId = "existing-langgraph-thread";
  const { result, updates } = renderAvailability({
    threadId,
    listDocuments: async () => new Response(null, { status: 500 }),
  });
  await waitFor(() => assert.equal(result.current.isRefreshing, false));

  let persisted: boolean | "deferred" | undefined;
  await act(async () => {
    persisted = await result.current.recordUploadSuccess({
      activeThreadId: threadId,
      documents: [{ name: "upload.pdf", size: 99, type: "file" }],
      docFolder: `docs/threads/${threadId}`,
    });
  });

  assert.equal(persisted, true);
  assert.equal(result.current.availability, true);
  assert.deepEqual(result.current.documents, [
    { name: "upload.pdf", size: 99, type: "file" },
  ]);
  assert.deepEqual(updates.at(-1), {
    threadId,
    values: {
      has_documents: true,
      doc_folder: `docs/threads/${threadId}`,
    },
  });

  const sends: Array<{
    threadId: string;
    message: string;
    values: Record<string, unknown>;
  }> = [];
  submitResearchMessage({
    message: "research upload",
    noWeb: false,
    availability: result.current.availability,
    threadId,
    sendMessage: (message, values) => sends.push({ threadId, message, values }),
  });
  assert.deepEqual(sends, [
    {
      threadId,
      message: "research upload",
      values: {
        no_web: false,
        has_documents: true,
        doc_folder: `docs/threads/${threadId}`,
      },
    },
  ]);
});

test("upload callback accepts the existing created thread before query-state rerender", async () => {
  const threadId = "created-langgraph-thread";
  const { result, updates } = renderAvailability({
    threadId: null,
    listDocuments: async () => {
      throw new Error("no list before thread selection");
    },
  });

  await act(async () => {
    await result.current.recordUploadSuccess({
      activeThreadId: threadId,
      documents: [{ name: "early.pdf", size: 7, type: "file" }],
      docFolder: `docs/threads/${threadId}`,
    });
  });

  assert.equal(result.current.availability, true);
  assert.deepEqual(updates, [
    {
      threadId,
      values: {
        has_documents: true,
        doc_folder: `docs/threads/${threadId}`,
      },
    },
  ]);
});

test("known busy status defers latest document persistence without attempting a write", async () => {
  let attempts = 0;
  const updates: StateUpdate[] = [];
  const { result, rerender } = renderHook(
    ({ status }: { status: "busy" | "idle" }) =>
      useThreadDocumentAvailability({
        threadId: "thread-1",
        selectedThreadStatus: status,
        listDocuments: async () => listResponse([]),
        updateThreadState: async (_threadId, values) => {
          attempts += 1;
          updates.push({ threadId: "thread-1", values });
        },
      }),
    { initialProps: { status: "busy" as "busy" | "idle" } }
  );

  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  assert.equal(attempts, 0);

  let persisted!: boolean | "deferred";
  await act(async () => {
    persisted = await result.current.recordUploadSuccess({
      activeThreadId: "thread-1",
      documents: [{ name: "new.pdf", size: 9, type: "file" }],
      docFolder: "docs/threads/thread-1",
    });
  });
  assert.equal(persisted, "deferred");
  assert.equal(attempts, 0);

  rerender({ status: "idle" });
  await waitFor(() => assert.equal(attempts, 1));
  assert.deepEqual(updates, [
    {
      threadId: "thread-1",
      values: {
        has_documents: true,
        doc_folder: "docs/threads/thread-1",
      },
    },
  ]);
});

test("non-busy status defers backend 409 then retries after status revalidation", async () => {
  let allowWrite = false;
  let attempts = 0;
  const { result, rerender } = renderHook(
    ({ isValidating }: { isValidating: boolean }) =>
      useThreadDocumentAvailability({
        threadId: "thread-1",
        selectedThreadStatus: "idle",
        selectedThreadStatusIsValidating: isValidating,
        listDocuments: async () => listResponse([]),
        updateThreadState: async () => {
          attempts += 1;
          if (!allowWrite) {
            throw new Error(
              "HTTP 409: Cannot update thread state because it has in-flight runs"
            );
          }
        },
      }),
    { initialProps: { isValidating: false } }
  );

  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  assert.equal(attempts, 1);

  allowWrite = true;
  rerender({ isValidating: true });
  await act(async () => {
    rerender({ isValidating: false });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  await waitFor(() => assert.equal(attempts, 2));
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(attempts, 2);
});

test("upload 409 catch path returns deferred then retries after status revalidation", async () => {
  let allowWrite = false;
  let attempts = 0;
  const updates: StateUpdate[] = [];
  const { result, rerender } = renderHook(
    ({ isValidating }: { isValidating: boolean }) =>
      useThreadDocumentAvailability({
        threadId: "thread-1",
        selectedThreadStatus: "idle",
        selectedThreadStatusIsValidating: isValidating,
        listDocuments: async () => new Response(null, { status: 500 }),
        updateThreadState: async (threadId, values) => {
          attempts += 1;
          if (!allowWrite) {
            throw new Error(
              "HTTP 409: Cannot update thread state because it has in-flight runs"
            );
          }
          updates.push({ threadId, values });
        },
      }),
    { initialProps: { isValidating: false } }
  );

  let persisted!: boolean | "deferred";
  await act(async () => {
    persisted = await result.current.recordUploadSuccess({
      activeThreadId: "thread-1",
      documents: [{ name: "upload.pdf", size: 4, type: "file" }],
      docFolder: "docs/threads/thread-1",
    });
  });
  assert.equal(persisted, "deferred");
  assert.equal(attempts, 1);

  allowWrite = true;
  rerender({ isValidating: true });
  rerender({ isValidating: false });
  await waitFor(() => assert.equal(attempts, 2));
  assert.deepEqual(updates, [
    {
      threadId: "thread-1",
      values: {
        has_documents: true,
        doc_folder: "docs/threads/thread-1",
      },
    },
  ]);
});

test("stale upload HTTP 409 returns failure after thread changes", async () => {
  const started = deferred<void>();
  const rejected = deferred<never>();
  const { result, rerender } = renderHook(
    ({ threadId }: { threadId: "A" | "B" }) =>
      useThreadDocumentAvailability({
        threadId,
        selectedThreadStatus: "idle",
        listDocuments: async () => new Response(null, { status: 500 }),
        updateThreadState: async () => {
          started.resolve();
          await rejected.promise;
          throw new Error(
            "HTTP 409: Cannot update thread state because it has in-flight runs"
          );
        },
      }),
    { initialProps: { threadId: "A" as "A" | "B" } }
  );

  let upload!: Promise<boolean | "deferred">;
  act(() => {
    upload = result.current.recordUploadSuccess({
      activeThreadId: "A",
      documents: [{ name: "upload.pdf", size: 4, type: "file" }],
      docFolder: "docs/threads/A",
    });
  });
  await act(async () => {
    await started.promise;
  });
  rerender({ threadId: "B" });
  rejected.resolve(undefined as never);

  let persisted!: boolean | "deferred";
  await act(async () => {
    persisted = await upload;
  });
  assert.equal(persisted, false);
});

test("known-busy deferred persistence is discarded when selected thread changes", async () => {
  let allowWrite = false;
  const updates: StateUpdate[] = [];
  const { result, rerender } = renderHook(
    ({ threadId, status }: { threadId: string; status: "busy" | "idle" }) =>
      useThreadDocumentAvailability({
        threadId,
        selectedThreadStatus: status,
        listDocuments: async (listedThreadId) =>
          listedThreadId === "A"
            ? listResponse([])
            : new Response(null, { status: 500 }),
        updateThreadState: async (updatedThreadId, values) => {
          if (!allowWrite) {
            throw new Error(
              "HTTP 409: Cannot update thread state because it has in-flight runs"
            );
          }
          updates.push({ threadId: updatedThreadId, values });
        },
      }),
    {
      initialProps: {
        threadId: "A",
        status: "busy" as "busy" | "idle",
      },
    }
  );

  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  assert.deepEqual(updates, []);

  allowWrite = true;
  rerender({ threadId: "B", status: "idle" });
  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, []);
});

test("repeated HTTP 409 waits for a future status confirmation after one flush", async () => {
  let attempts = 0;
  const { result, rerender } = renderHook(
    ({ status }: { status: "busy" | "idle" }) =>
      useThreadDocumentAvailability({
        threadId: "thread-1",
        selectedThreadStatus: status,
        listDocuments: async () => listResponse([]),
        updateThreadState: async () => {
          attempts += 1;
          throw new Error(
            "HTTP 409: Cannot update thread state because it has in-flight runs"
          );
        },
      }),
    { initialProps: { status: "idle" as "busy" | "idle" } }
  );

  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  assert.equal(attempts, 1);

  await act(async () => {
    rerender({ status: "busy" });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(attempts, 1);
  await act(async () => {
    rerender({ status: "idle" });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(attempts, 2);
  await act(async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(attempts, 2);
});

test("unknown selected thread status retains deferred HTTP 409 without flushing", async () => {
  let allowWrite = false;
  const updates: StateUpdate[] = [];
  const { result, rerender } = renderHook(
    ({ status }: { status: "busy" | null }) =>
      useThreadDocumentAvailability({
        threadId: "thread-1",
        selectedThreadStatus: status,
        listDocuments: async () => listResponse([]),
        updateThreadState: async (threadId, values) => {
          if (!allowWrite) {
            throw new Error(
              "HTTP 409: Cannot update thread state because it has in-flight runs"
            );
          }
          updates.push({ threadId, values });
        },
      }),
    { initialProps: { status: null as "busy" | null } }
  );

  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  allowWrite = true;
  rerender({ status: null });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, []);
});

test("unmount discards known-busy deferred persistence", async () => {
  let allowWrite = false;
  const updates: StateUpdate[] = [];
  const { result, unmount } = renderHook(() =>
    useThreadDocumentAvailability({
      threadId: "thread-1",
      selectedThreadStatus: "busy",
      listDocuments: async () => listResponse([]),
      updateThreadState: async (threadId, values) => {
        if (!allowWrite) {
          throw new Error(
            "HTTP 409: Cannot update thread state because it has in-flight runs"
          );
        }
        updates.push({ threadId, values });
      },
    })
  );

  await waitFor(() => assert.equal(result.current.isRefreshing, false));
  unmount();
  allowWrite = true;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(updates, []);
});

test("successful non-last and last deletion update availability and persisted state", async () => {
  const { result, updates } = renderAvailability({
    listDocuments: async () =>
      listResponse([
        { name: "one.pdf", size: 1, type: "file" },
        { name: "two.pdf", size: 2, type: "file" },
      ]),
  });
  await waitFor(() => assert.equal(result.current.availability, true));

  await act(async () => {
    await result.current.recordDeleteSuccess("one.pdf");
  });
  assert.equal(result.current.availability, true);
  assert.deepEqual(
    result.current.documents.map((item) => item.name),
    ["two.pdf"]
  );
  assert.deepEqual(updates.at(-1), {
    threadId: "thread-1",
    values: { has_documents: true },
  });
  assert.equal(updates.length, 2);

  await act(async () => {
    await result.current.recordDeleteSuccess("two.pdf");
  });
  assert.equal(result.current.availability, false);
  assert.deepEqual(result.current.documents, []);
  assert.deepEqual(updates.at(-1), {
    threadId: "thread-1",
    values: { has_documents: false, doc_folder: null },
  });
  assert.equal(updates.length, 3);
});

test("late A response cannot overwrite B after thread change", async () => {
  const responseA = deferred<Response>();
  const responseB = deferred<Response>();
  const updates: StateUpdate[] = [];
  const listDocuments = (threadId: string) =>
    threadId === "A" ? responseA.promise : responseB.promise;
  const { result, rerender } = renderHook(
    ({ threadId }) =>
      useThreadDocumentAvailability({
        threadId,
        listDocuments,
        updateThreadState: async (updatedThreadId, values) => {
          updates.push({ threadId: updatedThreadId, values });
        },
      }),
    { initialProps: { threadId: "A" } }
  );

  rerender({ threadId: "B" });
  assert.deepEqual(result.current.documents, []);
  assert.equal(result.current.availability, null);

  await act(async () => {
    responseB.resolve(listResponse([{ name: "b.pdf", size: 2, type: "file" }]));
  });
  await waitFor(() => assert.equal(result.current.availability, true));

  await act(async () => {
    responseA.resolve(listResponse([]));
    await responseA.promise;
  });

  assert.equal(result.current.availability, true);
  assert.deepEqual(
    result.current.documents.map((item) => item.name),
    ["b.pdf"]
  );
  assert.deepEqual(updates, [
    {
      threadId: "B",
      values: { has_documents: true, doc_folder: "docs/threads/B" },
    },
  ]);
});

test("late A state-update completion cannot overwrite B", async () => {
  const updateA = deferred<void>();
  const { result, rerender } = renderHook(
    ({ threadId }) =>
      useThreadDocumentAvailability({
        threadId,
        listDocuments: async (listedThreadId) =>
          listedThreadId === "A"
            ? listResponse([])
            : listResponse([{ name: "b.pdf", size: 2, type: "file" }]),
        updateThreadState: async (updatedThreadId) => {
          if (updatedThreadId === "A") await updateA.promise;
        },
      }),
    { initialProps: { threadId: "A" } }
  );
  await waitFor(() => assert.equal(result.current.availability, false));

  rerender({ threadId: "B" });
  await waitFor(() => assert.equal(result.current.availability, true));

  await act(async () => {
    updateA.resolve();
    await updateA.promise;
  });
  assert.equal(result.current.availability, true);
  assert.deepEqual(
    result.current.documents.map((item) => item.name),
    ["b.pdf"]
  );
});

test("late same-thread empty refresh cannot overwrite a successful upload", async () => {
  const initialList = deferred<Response>();
  const writes: StateUpdate[] = [];
  const { result } = renderHook(() =>
    useThreadDocumentAvailability({
      threadId: "same-thread",
      listDocuments: async () => initialList.promise,
      updateThreadState: async (threadId, values) => {
        writes.push({ threadId, values });
      },
    })
  );

  await act(async () => {
    await result.current.recordUploadSuccess({
      activeThreadId: "same-thread",
      documents: [{ name: "new.pdf", size: 9, type: "file" }],
      docFolder: "docs/threads/same-thread",
    });
  });
  await act(async () => {
    initialList.resolve(listResponse([]));
    await initialList.promise;
  });

  assert.equal(result.current.availability, true);
  assert.deepEqual(
    result.current.documents.map((item) => item.name),
    ["new.pdf"]
  );
  assert.deepEqual(writes.at(-1), {
    threadId: "same-thread",
    values: {
      has_documents: true,
      doc_folder: "docs/threads/same-thread",
    },
  });
});

test("upload persistence runs after an already in-flight older refresh write", async () => {
  const releaseOldWrite = deferred<void>();
  const oldWriteStarted = deferred<void>();
  const completedWrites: StateUpdate[] = [];
  const { result } = renderHook(() =>
    useThreadDocumentAvailability({
      threadId: "same-thread",
      listDocuments: async () => listResponse([]),
      updateThreadState: async (threadId, values) => {
        if (values.has_documents === false) {
          oldWriteStarted.resolve();
          await releaseOldWrite.promise;
        }
        completedWrites.push({ threadId, values });
      },
    })
  );
  await act(async () => {
    await oldWriteStarted.promise;
  });

  let uploadSettled = false;
  let upload!: Promise<boolean | "deferred">;
  act(() => {
    upload = result.current.recordUploadSuccess({
      activeThreadId: "same-thread",
      documents: [{ name: "new.pdf", size: 9, type: "file" }],
      docFolder: "docs/threads/same-thread",
    });
  });
  void upload.then(() => {
    uploadSettled = true;
  });
  await Promise.resolve();
  assert.equal(uploadSettled, false);

  await act(async () => {
    releaseOldWrite.resolve();
    await upload;
  });

  assert.deepEqual(completedWrites, [
    {
      threadId: "same-thread",
      values: { has_documents: false, doc_folder: null },
    },
    {
      threadId: "same-thread",
      values: {
        has_documents: true,
        doc_folder: "docs/threads/same-thread",
      },
    },
  ]);
});

test("unmount invalidates a pending refresh before local or persisted mutation", async () => {
  const pendingList = deferred<Response>();
  const writes: StateUpdate[] = [];
  const { unmount } = renderHook(() =>
    useThreadDocumentAvailability({
      threadId: "thread-unmounted",
      listDocuments: async () => pendingList.promise,
      updateThreadState: async (threadId, values) => {
        writes.push({ threadId, values });
      },
    })
  );

  unmount();
  pendingList.resolve(
    listResponse([{ name: "late.pdf", size: 1, type: "file" }])
  );
  await pendingList.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(writes, []);
});

test("StrictMode effect replay keeps mounted operations active", async () => {
  const writes: StateUpdate[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>{children}</StrictMode>
  );
  const { result } = renderHook(
    () =>
      useThreadDocumentAvailability({
        threadId: "strict-thread",
        listDocuments: async () =>
          listResponse([{ name: "strict.pdf", size: 1, type: "file" }]),
        updateThreadState: async (threadId, values) => {
          writes.push({ threadId, values });
        },
      }),
    { wrapper }
  );

  await waitFor(() => assert.equal(result.current.availability, true));
  assert.deepEqual(writes.at(-1), {
    threadId: "strict-thread",
    values: {
      has_documents: true,
      doc_folder: "docs/threads/strict-thread",
    },
  });
});

test("upload persistence rejection logs but preserves confirmed true for submit fallback", async () => {
  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  try {
    const { result } = renderHook(() =>
      useThreadDocumentAvailability({
        threadId: "thread-1",
        listDocuments: async () => new Response(null, { status: 500 }),
        updateThreadState: async () => {
          throw new Error("state unavailable");
        },
      })
    );
    await waitFor(() => assert.equal(result.current.isRefreshing, false));

    let persisted: boolean | "deferred" | undefined;
    await act(async () => {
      persisted = await result.current.recordUploadSuccess({
        activeThreadId: "thread-1",
        documents: [{ name: "upload.pdf", size: 4, type: "file" }],
        docFolder: "docs/threads/thread-1",
      });
    });

    assert.equal(persisted, false);
    assert.equal(result.current.availability, true);
    assert.equal(errors.length, 1);
    const sends: Array<Record<string, unknown>> = [];
    submitResearchMessage({
      message: "Use upload",
      noWeb: false,
      availability: result.current.availability,
      threadId: "thread-1",
      sendMessage: (_message, values) => sends.push(values),
    });
    assert.deepEqual(sends, [
      {
        no_web: false,
        has_documents: true,
        doc_folder: "docs/threads/thread-1",
      },
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("rejected persistence is surfaced and a delete performs one graph write", async () => {
  const errors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  let rejectWrites = false;
  let mutationWrites = 0;

  try {
    const { result } = renderHook(() =>
      useThreadDocumentAvailability({
        threadId: "thread-1",
        listDocuments: async () =>
          listResponse([{ name: "one.pdf", size: 1, type: "file" }]),
        updateThreadState: async () => {
          if (rejectWrites) {
            mutationWrites += 1;
            throw new Error("state unavailable");
          }
        },
      })
    );
    await waitFor(() => assert.equal(result.current.availability, true));
    rejectWrites = true;

    let persisted: boolean | undefined;
    await act(async () => {
      persisted = (await result.current.recordDeleteSuccess("one.pdf"))
        .persisted;
    });

    assert.equal(persisted, false);
    assert.equal(result.current.availability, false);
    assert.equal(mutationWrites, 1);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][0]), /persist document availability/i);
    assert.match(String(errors[0][1]), /state unavailable/i);
    const sends: Array<Record<string, unknown>> = [];
    submitResearchMessage({
      message: "Continue without documents",
      noWeb: false,
      availability: result.current.availability,
      threadId: "thread-1",
      sendMessage: (_message, values) => sends.push(values),
    });
    assert.deepEqual(sends, [
      { no_web: false, has_documents: false, doc_folder: null },
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("two confirmed deletes remove cumulatively and persist final false", async () => {
  const writes: StateUpdate[] = [];
  const { result } = renderHook(() =>
    useThreadDocumentAvailability({
      threadId: "thread-1",
      listDocuments: async () =>
        listResponse([
          { name: "one.pdf", size: 1, type: "file" },
          { name: "two.pdf", size: 2, type: "file" },
        ]),
      updateThreadState: async (threadId, values) => {
        writes.push({ threadId, values });
      },
    })
  );
  await waitFor(() => assert.equal(result.current.documents.length, 2));
  writes.length = 0;

  let first!: ReturnType<typeof result.current.recordDeleteSuccess>;
  let second!: ReturnType<typeof result.current.recordDeleteSuccess>;
  act(() => {
    first = result.current.recordDeleteSuccess("one.pdf");
    second = result.current.recordDeleteSuccess("two.pdf");
  });
  await act(async () => {
    await Promise.all([first, second]);
  });

  assert.deepEqual(result.current.documents, []);
  assert.equal(result.current.availability, false);
  assert.deepEqual(writes.at(-1), {
    threadId: "thread-1",
    values: { has_documents: false, doc_folder: null },
  });
});

test("thread B persistence completes while thread A write remains pending", async () => {
  const aWriteStarted = deferred<void>();
  const releaseAWrite = deferred<void>();
  const bWrites: StateUpdate[] = [];
  const { result, rerender } = renderHook(
    ({ threadId }) =>
      useThreadDocumentAvailability({
        threadId,
        listDocuments: async (listedThreadId) =>
          listedThreadId === "A"
            ? listResponse([])
            : new Response(null, { status: 500 }),
        updateThreadState: async (updatedThreadId, values) => {
          if (updatedThreadId === "A") {
            aWriteStarted.resolve();
            await releaseAWrite.promise;
            return;
          }
          bWrites.push({ threadId: updatedThreadId, values });
        },
      }),
    { initialProps: { threadId: "A" } }
  );
  await act(async () => {
    await aWriteStarted.promise;
  });

  rerender({ threadId: "B" });
  await waitFor(() => assert.equal(result.current.isRefreshing, false));

  let bSettled = false;
  let bUpload!: ReturnType<typeof result.current.recordUploadSuccess>;
  act(() => {
    bUpload = result.current.recordUploadSuccess({
      activeThreadId: "B",
      documents: [{ name: "b.pdf", size: 2, type: "file" }],
      docFolder: "docs/threads/B",
    });
  });
  void bUpload.then(() => {
    bSettled = true;
  });
  for (let index = 0; index < 10 && !bSettled; index += 1) {
    await Promise.resolve();
  }
  const settledBeforeA = bSettled;
  const writesBeforeA = [...bWrites];

  await act(async () => {
    releaseAWrite.resolve();
    await bUpload;
  });

  assert.equal(settledBeforeA, true);
  assert.deepEqual(writesBeforeA, [
    {
      threadId: "B",
      values: {
        has_documents: true,
        doc_folder: "docs/threads/B",
      },
    },
  ]);
});

*/
afterEach(cleanup);

const localListResponse = (items: unknown[]) =>
  new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function localDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderLocalAvailability(
  threadId: string | null,
  listDocuments: (threadId: string) => Promise<Response>
) {
  return renderHook(
    ({ activeThreadId }) =>
      useThreadDocumentAvailability({
        threadId: activeThreadId,
        listDocuments,
      }),
    { initialProps: { activeThreadId: threadId } }
  );
}

test("empty and populated lists update only local documents and tagged evidence", async () => {
  const empty = renderLocalAvailability("empty", async () =>
    localListResponse([])
  );
  await waitFor(() => assert.equal(empty.result.current.availability, false));
  assert.deepEqual(empty.result.current.availabilityEvidence, {
    threadId: "empty",
    available: false,
  });
  empty.unmount();

  const populated = renderLocalAvailability("populated", async () =>
    localListResponse([
      { name: "report.pdf", size: 1, type: "file" },
      { name: "directory", size: 0, type: "directory" },
    ])
  );
  await waitFor(() =>
    assert.equal(populated.result.current.availability, true)
  );
  assert.deepEqual(
    populated.result.current.documents.map((item) => item.name),
    ["report.pdf"]
  );
  assert.deepEqual(populated.result.current.availabilityEvidence, {
    threadId: "populated",
    available: true,
  });
});

for (const listDocuments of [
  async () => Promise.reject(new Error("offline")),
  async () => new Response(null, { status: 500 }),
  async () => new Response("{", { status: 200 }),
]) {
  test("failed document list leaves evidence unknown", async () => {
    const { result } = renderLocalAvailability("failed", listDocuments);
    await waitFor(() => assert.equal(result.current.isRefreshing, false));
    assert.equal(result.current.availability, null);
    assert.equal(result.current.availabilityEvidence, null);
  });
}

test("upload resolves void and records local evidence for created thread", async () => {
  const { result } = renderLocalAvailability(
    null,
    async () => new Response(null, { status: 500 })
  );
  let uploadResult: unknown = "not-called";
  await act(async () => {
    uploadResult = await result.current.recordUploadSuccess({
      activeThreadId: "created",
      documents: [{ name: "upload.pdf", size: 1, type: "file" }],
    });
  });
  assert.equal(uploadResult, undefined);
  assert.deepEqual(result.current.availabilityEvidence, {
    threadId: "created",
    available: true,
  });
});

test("deletes accumulate locally and return only hasDocuments", async () => {
  const { result } = renderLocalAvailability("delete", async () =>
    localListResponse([
      { name: "one.pdf", size: 1, type: "file" },
      { name: "two.pdf", size: 1, type: "file" },
    ])
  );
  await waitFor(() => assert.equal(result.current.documents.length, 2));
  let one!: { hasDocuments: boolean | null };
  let two!: { hasDocuments: boolean | null };
  await act(async () => {
    one = await result.current.recordDeleteSuccess("one.pdf");
    two = await result.current.recordDeleteSuccess("two.pdf");
  });
  assert.deepEqual(one, { hasDocuments: true });
  assert.deepEqual(two, { hasDocuments: false });
  assert.deepEqual(result.current.availabilityEvidence, {
    threadId: "delete",
    available: false,
  });
});

test("late same-thread refresh cannot overwrite upload", async () => {
  const list = localDeferred<Response>();
  const { result } = renderLocalAvailability("same", async () => list.promise);
  await act(async () => {
    await result.current.recordUploadSuccess({
      activeThreadId: "same",
      documents: [{ name: "new.pdf", size: 1, type: "file" }],
    });
    list.resolve(localListResponse([]));
  });
  assert.equal(result.current.availability, true);
  assert.deepEqual(
    result.current.documents.map((item) => item.name),
    ["new.pdf"]
  );
});

test("late A response cannot overwrite B evidence after navigation", async () => {
  const responseA = localDeferred<Response>();
  const responseB = localDeferred<Response>();
  const { result, rerender } = renderHook(
    ({ threadId }) =>
      useThreadDocumentAvailability({
        threadId,
        listDocuments: (target) =>
          target === "A" ? responseA.promise : responseB.promise,
      }),
    { initialProps: { threadId: "A" } }
  );
  rerender({ threadId: "B" });
  await act(async () => {
    responseB.resolve(
      localListResponse([{ name: "b.pdf", size: 1, type: "file" }])
    );
  });
  await waitFor(() => assert.equal(result.current.availability, true));
  await act(async () => responseA.resolve(localListResponse([])));
  assert.deepEqual(result.current.availabilityEvidence, {
    threadId: "B",
    available: true,
  });
});

test("unmount and StrictMode preserve mounted-operation guards", async () => {
  const pending = localDeferred<Response>();
  const pendingHook = renderLocalAvailability(
    "unmounted",
    async () => pending.promise
  );
  pendingHook.unmount();
  await act(async () =>
    pending.resolve(
      localListResponse([{ name: "late.pdf", size: 1, type: "file" }])
    )
  );
  assert.equal(pendingHook.result.current.availability, null);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>{children}</StrictMode>
  );
  const strict = renderHook(
    () =>
      useThreadDocumentAvailability({
        threadId: "strict",
        listDocuments: async () =>
          localListResponse([{ name: "strict.pdf", size: 1, type: "file" }]),
      }),
    { wrapper }
  );
  await waitFor(() => assert.equal(strict.result.current.availability, true));
});

test("confirmed document result exposes owner-tagged evidence without a graph write", async () => {
  const { result } = renderLocalAvailability(
    "evidence-thread",
    async () => new Response(null, { status: 404 })
  );

  await waitFor(() => assert.equal(result.current.availability, false));
  assert.deepEqual(result.current.availabilityEvidence, {
    threadId: "evidence-thread",
    available: false,
  });
});
