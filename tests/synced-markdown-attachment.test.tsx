import "./setup-dom";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { MarkdownContent } from "../src/app/components/MarkdownContent";
import { SyncedMarkdownAttachment } from "../src/app/components/SyncedMarkdownAttachment";
import { buildSyncedAssetMarkdown } from "../src/lib/markdown-images";

afterEach(() => {
  cleanup();
});

test("renders a compact archive card with filename, size, and accessible download", () => {
  render(
    <SyncedMarkdownAttachment
      markdownId="123456"
      assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
      filename="audit bundle.zip"
      size={1572864}
      allowDownload={true}
      light={true}
    />
  );

  assert.ok(screen.getByText("audit bundle.zip"));
  assert.ok(screen.getByText("ZIP archive · 1.5 MiB"));
  assert.ok(screen.getByRole("button", { name: "Download audit bundle.zip" }));
});

test("omits the download action when the render context disallows it", () => {
  render(
    <SyncedMarkdownAttachment
      markdownId="123456"
      assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
      filename="audit bundle.zip"
      size={null}
      allowDownload={false}
      light={false}
    />
  );

  assert.ok(screen.getByText("ZIP archive"));
  assert.equal(screen.queryByRole("button"), null);
});

test("preserves Markdown punctuation in generated attachment filenames", () => {
  const filename = "audit *final* _copy_ `raw` ~old~ | set.zip";
  const content = buildSyncedAssetMarkdown([
    {
      id: "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271",
      filename,
      content_type: "application/zip",
      size: 7,
    },
  ]);

  render(
    <MarkdownContent
      content={content}
      light={true}
      syncedAssetContext={{ markdownId: "123456", allowDownload: true }}
    />
  );

  assert.ok(screen.getByText(filename));
  assert.ok(screen.getByRole("button", { name: `Download ${filename}` }));
});

test("downloads through the existing authenticated asset URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalClick = window.HTMLAnchorElement.prototype.click;
  let requestedUrl = "";
  let downloadedFilename = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(new Blob(["archive"]), {
      headers: {
        "Content-Disposition":
          "attachment; filename*=UTF-8''server%20bundle.zip",
      },
    });
  };
  window.HTMLAnchorElement.prototype.click = function () {
    downloadedFilename = this.download;
  };

  try {
    render(
      <SyncedMarkdownAttachment
        markdownId="123456"
        assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
        filename="fallback.zip"
        size={7}
        allowDownload={true}
        light={true}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Download fallback.zip" })
    );

    await waitFor(() => {
      assert.equal(
        requestedUrl,
        "/api/markdown-images/123456/1b14e924-5f0e-4fdb-b85d-4dddf8bc4271/download"
      );
      assert.equal(downloadedFilename, "server bundle.zip");
    });
  } finally {
    globalThis.fetch = originalFetch;
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});
