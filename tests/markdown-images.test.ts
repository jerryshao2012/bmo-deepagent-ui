import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as proxyImageUpload } from "../src/app/api/markdown-images/[markdownId]/[[...assetPath]]/route";
import {
  MAX_MARKDOWN_ASSET_BYTES,
  MAX_MARKDOWN_IMAGE_BYTES,
  buildSyncedAssetMarkdown,
  buildSyncedImageMarkdown,
  canStartSyncedImageGesture,
  formatMarkdownAttachmentSize,
  insertSyncedImageMarkdown,
  parseContentDispositionFilename,
  parseSyncedAttachmentHref,
  parseSyncedAttachmentSize,
  parseSyncedImageSource,
  removeSyncedMarkdownWorkspace,
  shouldApplySyncedImageUpload,
  validateMarkdownAssetFiles,
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

test("asset proxy forwards mixed image and archive uploads to the existing URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalUploadKey = process.env.UPLOAD_API_KEY;
  let forwardedUrl = "";
  let forwardedFiles: File[] = [];
  process.env.UPLOAD_API_KEY = "server-only-key";
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input);
    forwardedFiles = (init?.body as FormData).getAll("files") as File[];
    return Response.json({ assets: [], errors: [] });
  };

  try {
    const formData = new FormData();
    formData.append(
      "files",
      new File(["image"], "chart.png", { type: "image/png" })
    );
    formData.append(
      "files",
      new File(["archive"], "evidence.zip", { type: "application/zip" })
    );
    const request = new NextRequest(
      "http://localhost/api/markdown-images/123456",
      { method: "POST", body: formData }
    );

    const response = await proxyImageUpload(request, {
      params: Promise.resolve({ markdownId: "123456" }),
    });

    assert.equal(response.status, 200);
    assert.equal(
      forwardedUrl,
      "http://localhost:2024/markdown-threads/123456/images"
    );
    assert.deepEqual(
      forwardedFiles.map((file) => [file.name, file.type]),
      [
        ["chart.png", "image/png"],
        ["evidence.zip", "application/zip"],
      ]
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

test("keeps existing image Markdown unchanged for emphasis punctuation", () => {
  const id = "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271";

  assert.equal(
    buildSyncedImageMarkdown([
      { id, filename: "audit *final* _copy_ `raw` ~old~ | set.png" },
    ]),
    `![audit *final* _copy_ \`raw\` ~old~ | set.png](/__markdown-image/${id})`
  );
});

test("parses only canonical type-neutral attachment paths", () => {
  const id = "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271";

  assert.equal(parseSyncedAttachmentHref(`/__markdown-attachment/${id}`), id);
  assert.equal(
    parseSyncedAttachmentHref(`/__markdown-attachment/${id}/extra`),
    null
  );
  assert.equal(
    parseSyncedAttachmentHref(`/__markdown-attachment/not-a-uuid`),
    null
  );
  assert.equal(parseSyncedAttachmentHref(`/__markdown-zip/${id}`), null);
});

test("builds mixed image and attachment Markdown in upload order", () => {
  const markdown = buildSyncedAssetMarkdown([
    {
      id: "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271",
      filename: "one [draft].png",
      content_type: "image/png",
      size: 2048,
    },
    {
      id: "1df760fa-5e2e-4e83-8a43-f2e939f64d08",
      filename: "audit [final].zip",
      content_type: "application/zip",
      size: 1048576,
    },
  ]);

  assert.equal(
    markdown,
    "![one \\[draft\\].png](/__markdown-image/1b14e924-5f0e-4fdb-b85d-4dddf8bc4271)\n\n" +
      '[audit \\[final\\].zip](/__markdown-attachment/1df760fa-5e2e-4e83-8a43-f2e939f64d08 "size=1048576")'
  );
  assert.doesNotMatch(markdown, /__markdown-zip/);
});

test("uses returned content type rather than filename suffix for asset Markdown", () => {
  const markdown = buildSyncedAssetMarkdown([
    {
      id: "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271",
      filename: "evidence.bundle",
      content_type: "application/zip",
      size: 42,
    },
    {
      id: "1df760fa-5e2e-4e83-8a43-f2e939f64d08",
      filename: "misleading.zip",
      content_type: "image/png",
      size: 42,
    },
  ]);

  assert.equal(
    markdown,
    '[evidence.bundle](/__markdown-attachment/1b14e924-5f0e-4fdb-b85d-4dddf8bc4271 "size=42")\n\n' +
      "![misleading.zip](/__markdown-image/1df760fa-5e2e-4e83-8a43-f2e939f64d08)"
  );
});

test("parses attachment byte metadata and formats binary sizes", () => {
  assert.equal(parseSyncedAttachmentSize("size=1048576"), 1048576);
  assert.equal(parseSyncedAttachmentSize("size=-1"), null);
  assert.equal(parseSyncedAttachmentSize("1 MiB"), null);
  assert.equal(parseSyncedAttachmentSize(undefined), null);
  assert.equal(formatMarkdownAttachmentSize(0), "0 B");
  assert.equal(formatMarkdownAttachmentSize(1024), "1 KiB");
  assert.equal(formatMarkdownAttachmentSize(1572864), "1.5 MiB");
  assert.equal(formatMarkdownAttachmentSize(null), null);
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

test("accepts common browser ZIP MIME values with the shared size limit", () => {
  const result = validateMarkdownAssetFiles([
    { name: "one.zip", type: "application/zip", size: 10 },
    { name: "two.ZIP", type: "application/x-zip-compressed", size: 10 },
    { name: "three.zip", type: "application/octet-stream", size: 10 },
    { name: "four.zip", type: "", size: 10 },
    { name: "wrong.txt", type: "application/zip", size: 10 },
    {
      name: "large.zip",
      type: "application/zip",
      size: MAX_MARKDOWN_ASSET_BYTES + 1,
    },
  ]);

  assert.deepEqual(
    result.accepted.map((file) => file.name),
    ["one.zip", "two.ZIP", "three.zip", "four.zip"]
  );
  assert.deepEqual(
    result.rejected.map((item) => item.code),
    ["unsupported_file", "file_too_large"]
  );
  assert.equal(MAX_MARKDOWN_ASSET_BYTES, MAX_MARKDOWN_IMAGE_BYTES);
});

test("shares the five-file gesture cap across images and archives", () => {
  const result = validateMarkdownAssetFiles([
    { name: "one.png", type: "image/png", size: 10 },
    { name: "two.zip", type: "application/zip", size: 10 },
    { name: "three.jpg", type: "image/jpeg", size: 10 },
    { name: "four.zip", type: "", size: 10 },
    { name: "five.webp", type: "image/webp", size: 10 },
    { name: "six.zip", type: "application/zip", size: 10 },
  ]);

  assert.deepEqual(
    result.accepted.map((file) => file.name),
    ["one.png", "two.zip", "three.jpg", "four.zip", "five.webp"]
  );
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
