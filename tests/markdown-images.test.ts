import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as proxyImageUpload } from "../src/app/api/markdown-images/[markdownId]/[[...assetPath]]/route";
import {
  MAX_MARKDOWN_IMAGE_BYTES,
  buildSyncedImageMarkdown,
  canStartSyncedImageGesture,
  insertSyncedImageMarkdown,
  parseContentDispositionFilename,
  parseSyncedImageSource,
  removeSyncedMarkdownWorkspace,
  shouldApplySyncedImageUpload,
  validateImageFiles,
} from "../src/lib/markdown-images";

test("image proxy authenticates backend with server-side upload key", async () => {
  const originalFetch = globalThis.fetch;
  const originalUploadKey = process.env.UPLOAD_API_KEY;
  let forwardedUrl = "";
  let forwardedAuthorization = "";
  process.env.UPLOAD_API_KEY = "server-only-key";
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input);
    forwardedAuthorization = new Headers(init?.headers).get("X-API-Key") || "";
    return Response.json({ assets: [], errors: [] });
  };

  try {
    const formData = new FormData();
    formData.append(
      "files",
      new File(["image"], "chart.png", { type: "image/png" }),
    );
    const request = new NextRequest(
      "http://localhost/api/markdown-images/123456",
      { method: "POST", body: formData },
    );

    const response = await proxyImageUpload(request, {
      params: Promise.resolve({ markdownId: "123456" }),
    });

    assert.equal(response.status, 200);
    assert.equal(forwardedAuthorization, "server-only-key");
    assert.equal(
      forwardedUrl,
      "http://localhost:2024/markdown-threads/123456/images",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUploadKey === undefined) delete process.env.UPLOAD_API_KEY;
    else process.env.UPLOAD_API_KEY = originalUploadKey;
  }
});

test("parses only canonical synced-image logical paths", () => {
  const id = "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271";

  assert.equal(parseSyncedImageSource(`/__markdown-image/${id}`), id);
  assert.equal(parseSyncedImageSource(`https://example.com/${id}.png`), null);
  assert.equal(parseSyncedImageSource(`/__markdown-image/not-a-uuid`), null);
  assert.equal(parseSyncedImageSource(`/__markdown-image/${id}/extra`), null);
});

test("builds ordered Markdown references with escaped alt text", () => {
  const markdown = buildSyncedImageMarkdown([
    { id: "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271", filename: "one [draft].png" },
    { id: "1df760fa-5e2e-4e83-8a43-f2e939f64d08", filename: "two.png" },
  ]);

  assert.equal(
    markdown,
    "![one \\[draft\\].png](/__markdown-image/1b14e924-5f0e-4fdb-b85d-4dddf8bc4271)\n\n" +
      "![two.png](/__markdown-image/1df760fa-5e2e-4e83-8a43-f2e939f64d08)",
  );
});

test("replaces the captured selection when content is unchanged", () => {
  assert.equal(
    insertSyncedImageMarkdown({
      content: "hello selected world",
      markdown: "![chart](/__markdown-image/id)",
      selectionStart: 6,
      selectionEnd: 14,
      contentChanged: false,
    }),
    "hello ![chart](/__markdown-image/id) world",
  );
});

test("appends after exactly one blank line when content changed", () => {
  assert.equal(
    insertSyncedImageMarkdown({
      content: "new remote text\n\n\n",
      markdown: "![chart](/__markdown-image/id)",
      selectionStart: 0,
      selectionEnd: 0,
      contentChanged: true,
    }),
    "new remote text\n\n![chart](/__markdown-image/id)",
  );
});

test("validates image type, extension, size, and five-file limit", () => {
  const files = [
    { name: "one.png", type: "image/png", size: 10 },
    { name: "two.jpg", type: "image/jpeg", size: 10 },
    { name: "wrong.svg", type: "image/svg+xml", size: 10 },
    { name: "large.png", type: "image/png", size: MAX_MARKDOWN_IMAGE_BYTES + 1 },
  ];

  const result = validateImageFiles(files);

  assert.deepEqual(result.accepted.map((file) => file.name), [
    "one.png",
    "two.jpg",
  ]);
  assert.deepEqual(result.rejected.map((item) => item.filename), [
    "wrong.svg",
    "large.png",
  ]);
  assert.equal(result.rejected[1].code, "file_too_large");
});

test("accepts at most five images from one gesture", () => {
  const result = validateImageFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `${index}.png`,
      type: "image/png",
      size: 10,
    })),
  );

  assert.equal(result.accepted.length, 5);
  assert.equal(result.rejected[0].code, "too_many_files");
});

test("parses UTF-8 and quoted Content-Disposition filenames", () => {
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''my%20chart.png"),
    "my chart.png",
  );
  assert.equal(
    parseContentDispositionFilename('attachment; filename="fallback.png"'),
    "fallback.png",
  );
});

test("discards late upload insertion after Markdown ID or epoch changes", () => {
  assert.equal(
    shouldApplySyncedImageUpload({
      markdownIdAtStart: "123456",
      currentMarkdownId: "123456",
      epochAtStart: 4,
      currentEpoch: 4,
    }),
    true,
  );
  assert.equal(
    shouldApplySyncedImageUpload({
      markdownIdAtStart: "123456",
      currentMarkdownId: "654321",
      epochAtStart: 4,
      currentEpoch: 4,
    }),
    false,
  );
  assert.equal(
    shouldApplySyncedImageUpload({
      markdownIdAtStart: "123456",
      currentMarkdownId: "123456",
      epochAtStart: 4,
      currentEpoch: 5,
    }),
    false,
  );
});

test("blocks image gestures during upload and removal", () => {
  assert.equal(
    canStartSyncedImageGesture({
      markdownId: "123456",
      uploadActive: false,
      removalActive: false,
    }),
    true,
  );
  assert.equal(
    canStartSyncedImageGesture({
      markdownId: "123456",
      uploadActive: true,
      removalActive: false,
    }),
    false,
  );
  assert.equal(
    canStartSyncedImageGesture({
      markdownId: "123456",
      uploadActive: false,
      removalActive: true,
    }),
    false,
  );
});

test("Remove publishes empty, awaits upload, then deletes snapshotted ID", async () => {
  const events: string[] = [];
  let finishUpload!: () => void;
  const activeUpload = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  let currentMarkdownId = "123456";

  const removal = removeSyncedMarkdownWorkspace({
    markdownId: currentMarkdownId,
    activeUpload,
    publishEmpty: () => events.push("publish-empty"),
    deleteNamespace: async (markdownId) => {
      events.push(`delete:${markdownId}`);
    },
  });
  currentMarkdownId = "654321";

  assert.deepEqual(events, ["publish-empty"]);
  finishUpload();
  await removal;
  assert.equal(currentMarkdownId, "654321");
  assert.deepEqual(events, ["publish-empty", "delete:123456"]);
});
