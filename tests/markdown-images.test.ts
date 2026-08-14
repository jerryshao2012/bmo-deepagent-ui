import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as proxyImageUpload } from "../src/app/api/markdown-images/[markdownId]/[[...assetPath]]/route";
import {
  MARKDOWN_ARCHIVE_FORMATS,
  MARKDOWN_OFFICE_FAMILIES,
} from "../src/lib/markdown-attachment-types";
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
  isSupportedMarkdownAssetFile,
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
      new File(["image"], "chart.png", { type: "image/png" })
    );
    const request = new NextRequest(
      "http://localhost/api/markdown-images/123456",
      { method: "POST", body: formData }
    );

    const response = await proxyImageUpload(request, {
      params: Promise.resolve({ markdownId: "123456" }),
    });

    assert.equal(response.status, 200);
    assert.equal(forwardedAuthorization, "server-only-key");
    assert.equal(
      forwardedUrl,
      "http://localhost:2024/markdown-threads/123456/images"
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUploadKey === undefined) delete process.env.UPLOAD_API_KEY;
    else process.env.UPLOAD_API_KEY = originalUploadKey;
  }
});

test("asset proxy forwards extended archives in one ordered batch to the existing URL", async () => {
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
    const extendedArchives = MARKDOWN_ARCHIVE_FORMATS.filter(
      ({ extended }) => extended
    );
    for (const archive of extendedArchives) {
      formData.append(
        "files",
        new File(["archive"], `evidence${archive.suffix}`, {
          type: archive.normalizedContentType,
        })
      );
    }
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
    assert.doesNotMatch(forwardedUrl, /7z|tar|tgz|gzip|office/i);
    assert.deepEqual(
      forwardedFiles.map((file) => [file.name, file.type]),
      extendedArchives.map((archive) => [
        `evidence${archive.suffix}`,
        archive.normalizedContentType,
      ])
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUploadKey === undefined) delete process.env.UPLOAD_API_KEY;
    else process.env.UPLOAD_API_KEY = originalUploadKey;
  }
});

test("asset proxy preserves Office filenames and wrong MIME values on the existing URL", async () => {
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
      new File(["office"], "forecast.XLSX", { type: "text/plain" })
    );
    formData.append(
      "files",
      new File(["office"], "diagram.vsdx", {
        type: "application/x-arbitrary-vendor",
      })
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
    assert.doesNotMatch(forwardedUrl, /xlsx|visio|office|vendor/i);
    assert.deepEqual(
      forwardedFiles.map((file) => [file.name, file.type]),
      [
        ["forecast.XLSX", "text/plain"],
        ["diagram.vsdx", "application/x-arbitrary-vendor"],
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
      "![two.png](/__markdown-image/1df760fa-5e2e-4e83-8a43-f2e939f64d08)"
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

test("builds type-neutral attachment Markdown for normalized archives and Office assets", () => {
  const ids = [
    "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271",
    "1df760fa-5e2e-4e83-8a43-f2e939f64d08",
    "2882c02f-80ce-48aa-bff8-2f04336b5451",
    "31f4dfe4-720c-4f9a-a2f7-208a2b6ee55d",
    "4b17e13e-ec24-47b4-9f26-c73671a45dbd",
    "5ef87df7-31cb-4b61-9c53-7e8b50191a3e",
  ];
  const normalizedArchives = Array.from(
    new Set(
      MARKDOWN_ARCHIVE_FORMATS.map(
        ({ normalizedContentType }) => normalizedContentType
      )
    )
  );
  const assets = [
    ...normalizedArchives.map((contentType, index) => ({
      id: ids[index],
      filename: `archive-${index} [copy].bin`,
      content_type: contentType,
      size: 100 + index,
    })),
    {
      id: ids[4],
      filename: "report_*final*.DOCX",
      content_type: "application/octet-stream",
      size: 1048576,
    },
    {
      id: ids[5],
      filename: "photo.png",
      content_type: "image/png",
      size: 2048,
    },
  ];

  const references = buildSyncedAssetMarkdown(assets).split("\n\n");

  assert.deepEqual(
    references,
    assets.map((asset, index) => {
      const label =
        index === 4
          ? "report\\_\\*final\\*.DOCX"
          : index === 5
          ? "photo.png"
          : `archive-${index} \\[copy\\].bin`;
      return index === 5
        ? `![${label}](/__markdown-image/${asset.id})`
        : `[${label}](/__markdown-attachment/${asset.id} "size=${asset.size}")`;
    })
  );
  for (const reference of references.slice(0, -1)) {
    const href = /\]\((\/__markdown-attachment\/[^ ]+)/.exec(reference)?.[1];
    assert.match(href ?? "", /^\/__markdown-attachment\/[0-9a-f-]{36}$/);
  }
});

test("uses response content type for images and leaves unknown octet-stream responses unsupported", () => {
  const archiveId = "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271";
  const imageId = "1df760fa-5e2e-4e83-8a43-f2e939f64d08";
  const unknownId = "2882c02f-80ce-48aa-bff8-2f04336b5451";

  assert.equal(
    buildSyncedAssetMarkdown([
      {
        id: archiveId,
        filename: "misleading.png",
        content_type: "application/x-tar",
        size: 1,
      },
      {
        id: imageId,
        filename: "misleading.docx",
        content_type: "image/png",
        size: 2,
      },
      {
        id: unknownId,
        filename: "unknown.bin",
        content_type: "application/octet-stream",
        size: 3,
      },
    ]),
    `[misleading.png](/__markdown-attachment/${archiveId} "size=1")\n\n` +
      `![misleading.docx](/__markdown-image/${imageId})\n\n` +
      `![unknown.bin](/__markdown-image/${unknownId})`
  );
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
    "hello ![chart](/__markdown-image/id) world"
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
    "new remote text\n\n![chart](/__markdown-image/id)"
  );
});

test("validates image type, extension, size, and five-file limit", () => {
  const files = [
    { name: "one.png", type: "image/png", size: 10 },
    { name: "two.jpg", type: "image/jpeg", size: 10 },
    { name: "wrong.svg", type: "image/svg+xml", size: 10 },
    {
      name: "large.png",
      type: "image/png",
      size: MAX_MARKDOWN_IMAGE_BYTES + 1,
    },
  ];

  const result = validateImageFiles(files);

  assert.deepEqual(
    result.accepted.map((file) => file.name),
    ["one.png", "two.jpg"]
  );
  assert.deepEqual(
    result.rejected.map((item) => item.filename),
    ["wrong.svg", "large.png"]
  );
  assert.equal(result.rejected[1].code, "file_too_large");
});

test("accepts at most five images from one gesture", () => {
  const result = validateImageFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `${index}.png`,
      type: "image/png",
      size: 10,
    }))
  );

  assert.equal(result.accepted.length, 5);
  assert.equal(result.rejected[0].code, "too_many_files");
});

test("accepts every configured archive suffix and MIME variant", () => {
  for (const archive of MARKDOWN_ARCHIVE_FORMATS) {
    for (const type of archive.acceptedContentTypes) {
      const file = { name: `bundle${archive.suffix}`, type, size: 10 };
      assert.equal(
        isSupportedMarkdownAssetFile(file),
        true,
        `${file.name}: ${type}`
      );
      assert.deepEqual(validateMarkdownAssetFiles([file]).accepted, [file]);
    }
    assert.equal(
      isSupportedMarkdownAssetFile({
        name: `BUNDLE${archive.suffix.toUpperCase()}`,
        type: archive.normalizedContentType.toUpperCase(),
        size: 10,
      }),
      true
    );
  }
});

test("accepts every Office family regardless of supplied MIME", () => {
  const suppliedTypes = [
    "",
    "text/plain",
    "application/octet-stream",
    "application/vnd.microsoft-office",
  ];
  for (const office of Object.values(MARKDOWN_OFFICE_FAMILIES)) {
    const extension = office.extensions[0];
    for (const type of suppliedTypes) {
      const file = { name: `report.${extension}`, type, size: 10 };
      assert.equal(
        isSupportedMarkdownAssetFile(file),
        true,
        `${file.name}: ${type}`
      );
      assert.deepEqual(validateMarkdownAssetFiles([file]).accepted, [file]);
    }
    assert.equal(
      isSupportedMarkdownAssetFile({
        name: `REPORT.${extension.toUpperCase()}`,
        type: "application/x-incorrect",
        size: 10,
      }),
      true
    );
  }
});

test("rejects misleading attachment suffixes and preserves shared size caps", () => {
  for (const file of [
    { name: "bundle.zip.exe", type: "application/zip", size: 10 },
    { name: "bundle.tar.gz.txt", type: "application/gzip", size: 10 },
    { name: "report.docx.exe", type: "application/octet-stream", size: 10 },
  ]) {
    assert.equal(isSupportedMarkdownAssetFile(file), false, file.name);
  }

  const result = validateMarkdownAssetFiles([
    {
      name: "accepted.docx",
      type: "application/octet-stream",
      size: MAX_MARKDOWN_ASSET_BYTES,
    },
    {
      name: "large.tar",
      type: "application/x-tar",
      size: MAX_MARKDOWN_ASSET_BYTES + 1,
    },
  ]);

  assert.deepEqual(
    result.accepted.map((file) => file.name),
    ["accepted.docx"]
  );
  assert.deepEqual(
    result.rejected.map((item) => item.code),
    ["file_too_large"]
  );
  assert.equal(MAX_MARKDOWN_ASSET_BYTES, MAX_MARKDOWN_IMAGE_BYTES);
});

test("shares the ordered five-file gesture cap across images, archives, and Office", () => {
  const result = validateMarkdownAssetFiles([
    { name: "one.png", type: "image/png", size: 10 },
    { name: "two.7z", type: "application/7z", size: 10 },
    { name: "three.docx", type: "text/plain", size: 10 },
    { name: "four.jpg", type: "image/jpeg", size: 10 },
    { name: "five.tar.gz", type: "application/x-tgz", size: 10 },
    { name: "six.xlsx", type: "application/octet-stream", size: 10 },
  ]);

  assert.deepEqual(
    result.accepted.map((file) => file.name),
    ["one.png", "two.7z", "three.docx", "four.jpg", "five.tar.gz"]
  );
  assert.deepEqual(result.rejected, [
    {
      filename: "six.xlsx",
      code: "too_many_files",
      message: "Only 5 attachments can be uploaded at once",
    },
  ]);
});

test("uses gate-specific unsupported-file messages", () => {
  assert.deepEqual(
    validateMarkdownAssetFiles([
      { name: "notes.txt", type: "text/plain", size: 10 },
    ]).rejected,
    [
      {
        filename: "notes.txt",
        code: "unsupported_file",
        message:
          "Only supported images, archives, and Microsoft Office files can be uploaded",
      },
    ]
  );

  const output = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import { validateMarkdownAssetFiles } from "./src/lib/markdown-images.ts";
       process.stdout.write(JSON.stringify(validateMarkdownAssetFiles([
         { name: "bundle.7z", type: "application/7z", size: 10 },
         { name: "notes.txt", type: "text/plain", size: 10 }
       ]).rejected));`,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED: "false",
      },
      encoding: "utf8",
    }
  );

  assert.deepEqual(JSON.parse(output), [
    {
      filename: "bundle.7z",
      code: "unsupported_file",
      message: "Only PNG, JPEG, WebP, GIF, and ZIP files are supported",
    },
    {
      filename: "notes.txt",
      code: "unsupported_file",
      message: "Only PNG, JPEG, WebP, GIF, and ZIP files are supported",
    },
  ]);
});

test("parses UTF-8 and quoted Content-Disposition filenames", () => {
  assert.equal(
    parseContentDispositionFilename(
      "attachment; filename*=UTF-8''my%20chart.png"
    ),
    "my chart.png"
  );
  assert.equal(
    parseContentDispositionFilename('attachment; filename="fallback.png"'),
    "fallback.png"
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
    true
  );
  assert.equal(
    shouldApplySyncedImageUpload({
      markdownIdAtStart: "123456",
      currentMarkdownId: "654321",
      epochAtStart: 4,
      currentEpoch: 4,
    }),
    false
  );
  assert.equal(
    shouldApplySyncedImageUpload({
      markdownIdAtStart: "123456",
      currentMarkdownId: "123456",
      epochAtStart: 4,
      currentEpoch: 5,
    }),
    false
  );
});

test("blocks image gestures during upload and removal", () => {
  assert.equal(
    canStartSyncedImageGesture({
      markdownId: "123456",
      uploadActive: false,
      removalActive: false,
    }),
    true
  );
  assert.equal(
    canStartSyncedImageGesture({
      markdownId: "123456",
      uploadActive: true,
      removalActive: false,
    }),
    false
  );
  assert.equal(
    canStartSyncedImageGesture({
      markdownId: "123456",
      uploadActive: false,
      removalActive: true,
    }),
    false
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
