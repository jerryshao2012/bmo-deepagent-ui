import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { useThreadDocumentAvailability } from "../src/app/hooks/useThreadDocumentAvailability";

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

test("upload without an owning thread resolves undefined", async () => {
  const { result } = renderLocalAvailability(
    null,
    async () => new Response(null, { status: 500 })
  );
  const uploadResult = await result.current.recordUploadSuccess({
    documents: [{ name: "orphan.pdf", size: 1, type: "file" }],
  });
  assert.equal(uploadResult, undefined);
  assert.equal(result.current.availabilityEvidence, null);
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
