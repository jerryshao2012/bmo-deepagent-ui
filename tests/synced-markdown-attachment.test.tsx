import "./setup-dom";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, mock, test } from "node:test";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";

import { MarkdownContent } from "../src/app/components/MarkdownContent";
import { SyncedMarkdownAttachment } from "../src/app/components/SyncedMarkdownAttachment";
import { buildSyncedAssetMarkdown } from "../src/lib/markdown-images";

afterEach(() => {
  cleanup();
});

const attachmentLabelCases = [
  ["bundle.zip", "ZIP archive"],
  ["bundle.7z", "7Z archive"],
  ["bundle.tar", "TAR archive"],
  ["bundle.tar.gz", "Gzipped TAR archive"],
  ["bundle.tgz", "Gzipped TAR archive"],
  ["report.docx", "Word document"],
  ["budget.xlsx", "Excel workbook"],
  ["briefing.pptx", "PowerPoint presentation"],
  ["records.accdb", "Access database"],
  ["network.vsdx", "Visio drawing"],
  ["notes.one", "OneNote file"],
  ["plan.mpp", "Project file"],
  ["mail.msg", "Outlook file"],
  ["brochure.pub", "Publisher document"],
  ["request.xsn", "InfoPath form"],
] as const;

test("renders exact archive and Office labels for lowercase and uppercase filenames", () => {
  for (const [lowercaseFilename, label] of attachmentLabelCases) {
    for (const filename of [
      lowercaseFilename,
      lowercaseFilename.toUpperCase(),
    ]) {
      render(
        <SyncedMarkdownAttachment
          markdownId="123456"
          assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
          filename={filename}
          size={1572864}
          allowDownload={true}
          light={true}
        />
      );

      const filenameElement = screen.getByText(filename);
      assert.equal(filenameElement.getAttribute("title"), filename);
      assert.ok(filenameElement.classList.contains("truncate"));
      assert.ok(screen.getByText(`${label} · 1.5 MiB`));
      const downloadButton = screen.getByRole("button", {
        name: `Download ${filename}`,
      });
      assert.equal(
        downloadButton.getAttribute("title"),
        `Download ${filename}`
      );
      cleanup();
    }
  }
});

test("falls back to Attachment for an unknown filename", () => {
  render(
    <SyncedMarkdownAttachment
      markdownId="123456"
      assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
      filename="bundle.unknown"
      size={1572864}
      allowDownload={true}
      light={true}
    />
  );

  assert.ok(screen.getByText("Attachment · 1.5 MiB"));
});

test("uses archive icons only for archive filenames", () => {
  const archive = render(
    <SyncedMarkdownAttachment
      markdownId="123456"
      assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
      filename="bundle.7z"
      size={1572864}
      allowDownload={true}
      light={true}
    />
  );
  assert.ok(archive.container.querySelector("svg.lucide-file-archive"));
  cleanup();

  for (const filename of ["quarterly-plan.docx", "bundle.unknown"]) {
    const attachment = render(
      <SyncedMarkdownAttachment
        markdownId="123456"
        assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
        filename={filename}
        size={1572864}
        allowDownload={true}
        light={true}
      />
    );
    assert.ok(attachment.container.querySelector("svg.lucide-file"));
    assert.equal(
      attachment.container.querySelector("svg.lucide-file-archive"),
      null
    );
    cleanup();
  }
});

test("omits separator and size when attachment size is missing or malformed", () => {
  for (const size of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    render(
      <SyncedMarkdownAttachment
        markdownId="123456"
        assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
        filename="audit bundle.zip"
        size={size}
        allowDownload={true}
        light={false}
      />
    );

    assert.ok(screen.getByText("ZIP archive"));
    assert.equal(screen.queryByText(/·/), null);
    cleanup();
  }
});

test("omits the download action and prevents requests when the render context disallows it", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unexpected fetch");
  };

  try {
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
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("renders Office attachments without viewer imports or byte fetches", async () => {
  const componentSource = await readFile(
    new URL(
      "../src/app/components/SyncedMarkdownAttachment.tsx",
      import.meta.url
    ),
    "utf8"
  );
  for (const viewerName of [
    "DocumentViewerPanel",
    "DocxViewer",
    "XlsxViewer",
    "PptxViewer",
  ]) {
    assert.doesNotMatch(componentSource, new RegExp(viewerName));
  }

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Unexpected render fetch");
  };

  try {
    render(
      <SyncedMarkdownAttachment
        markdownId="123456"
        assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
        filename="quarterly-plan.docx"
        size={1572864}
        allowDownload={true}
        light={true}
      />
    );

    assert.ok(screen.getByText("Word document · 1.5 MiB"));
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("downloads a gzipped TAR through the type-neutral authenticated asset URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalClick = window.HTMLAnchorElement.prototype.click;
  let requestedUrl = "";
  let downloadedFilename = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(new Blob(["archive"]), {
      headers: {
        "Content-Disposition":
          "attachment; filename*=UTF-8''server%20bundle.tar.gz",
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
        filename="fallback.tar.gz"
        size={7}
        allowDownload={true}
        light={true}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Download fallback.tar.gz" })
    );

    await waitFor(() => {
      assert.equal(
        requestedUrl,
        "/api/markdown-images/123456/1b14e924-5f0e-4fdb-b85d-4dddf8bc4271/download"
      );
      assert.equal(downloadedFilename, "server bundle.tar.gz");
    });
  } finally {
    globalThis.fetch = originalFetch;
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test("preserves the attachment download failure toast", async () => {
  const originalFetch = globalThis.fetch;
  let toastMessage = "";
  const toastError = mock.method(toast, "error", (message: unknown) => {
    toastMessage = String(message);
    return "toast-id";
  });
  globalThis.fetch = async () => new Response(null, { status: 500 });

  try {
    render(
      <SyncedMarkdownAttachment
        markdownId="123456"
        assetId="1b14e924-5f0e-4fdb-b85d-4dddf8bc4271"
        filename="broken.7z"
        size={7}
        allowDownload={true}
        light={false}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Download broken.7z" }));

    await waitFor(() => {
      assert.equal(toastMessage, "Failed to download attachment");
    });
  } finally {
    globalThis.fetch = originalFetch;
    toastError.mock.restore();
  }
});
