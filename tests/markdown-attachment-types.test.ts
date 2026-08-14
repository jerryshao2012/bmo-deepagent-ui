import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED,
  MARKDOWN_ARCHIVE_CONTENT_TYPES,
  MARKDOWN_ARCHIVE_FORMATS,
  MARKDOWN_OFFICE_FAMILIES,
  isMarkdownArchiveContentType,
  isMarkdownAttachmentAsset,
  isSupportedMarkdownArchiveFile,
  isSupportedMarkdownAttachmentFile,
  isSupportedMarkdownOfficeFile,
  markdownArchiveLabel,
  markdownAttachmentLabel,
  officeFamilyForFilename,
} from "../src/lib/markdown-attachment-types";

async function importFreshAttachmentTypes(cacheKey: string) {
  return import(`../src/lib/markdown-attachment-types?${cacheKey}`);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const archiveCases = [
  {
    suffix: ".zip",
    family: "zip",
    label: "ZIP archive",
    normalizedType: "application/zip",
    acceptedTypes: [
      "",
      "application/octet-stream",
      "application/zip",
      "application/x-zip",
    ],
  },
  {
    suffix: ".7z",
    family: "7z",
    label: "7Z archive",
    normalizedType: "application/x-7z-compressed",
    acceptedTypes: [
      "",
      "application/octet-stream",
      "application/x-7z-compressed",
      "application/7z",
      "application/vnd.7zip",
    ],
  },
  {
    suffix: ".tar",
    family: "tar",
    label: "TAR archive",
    normalizedType: "application/x-tar",
    acceptedTypes: [
      "",
      "application/octet-stream",
      "application/x-tar",
      "application/tar",
    ],
  },
  {
    suffix: ".tar.gz",
    family: "tar-gzip",
    label: "Gzipped TAR archive",
    normalizedType: "application/gzip",
    acceptedTypes: [
      "",
      "application/octet-stream",
      "application/gzip",
      "application/x-gzip",
      "application/x-compressed-tar",
      "application/x-gtar",
      "application/x-tgz",
    ],
  },
  {
    suffix: ".tgz",
    family: "tar-gzip",
    label: "Gzipped TAR archive",
    normalizedType: "application/gzip",
    acceptedTypes: [
      "",
      "application/octet-stream",
      "application/gzip",
      "application/x-gzip",
      "application/x-compressed-tar",
      "application/x-gtar",
      "application/x-tgz",
    ],
  },
] as const;

const officeCases = {
  word: {
    extensions: ["doc", "docx", "docm", "dot", "dotx", "dotm", "rtf", "wbk"],
    label: "Word document",
  },
  excel: {
    extensions: [
      "xls",
      "xlsx",
      "xlsm",
      "xlsb",
      "xlt",
      "xltx",
      "xltm",
      "xla",
      "xlam",
      "xll",
      "xlm",
      "xlw",
    ],
    label: "Excel workbook",
  },
  powerpoint: {
    extensions: [
      "ppt",
      "pptx",
      "pptm",
      "pot",
      "potx",
      "potm",
      "pps",
      "ppsx",
      "ppsm",
      "ppa",
      "ppam",
      "sldx",
      "sldm",
      "thmx",
    ],
    label: "PowerPoint presentation",
  },
  access: {
    extensions: [
      "accdb",
      "accde",
      "accdr",
      "accdt",
      "accdc",
      "mdb",
      "mde",
      "mda",
      "mdw",
      "ade",
      "adp",
    ],
    label: "Access database",
  },
  visio: {
    extensions: [
      "vsd",
      "vsdx",
      "vsdm",
      "vss",
      "vssx",
      "vssm",
      "vst",
      "vstx",
      "vstm",
      "vdw",
      "vdx",
      "vsx",
      "vtx",
    ],
    label: "Visio drawing",
  },
  onenote: {
    extensions: ["one", "onepkg", "onetoc2"],
    label: "OneNote file",
  },
  project: {
    extensions: ["mpp", "mpt", "mpd", "mpx"],
    label: "Project file",
  },
  outlook: {
    extensions: ["pst", "ost", "msg", "oft"],
    label: "Outlook file",
  },
  publisher: { extensions: ["pub"], label: "Publisher document" },
  infopath: { extensions: ["xsn"], label: "InfoPath form" },
} as const;

test("exports only normalized backend archive content types", () => {
  assert.equal(typeof EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED, "boolean");
  assert.deepEqual(
    [...MARKDOWN_ARCHIVE_CONTENT_TYPES],
    [
      "application/zip",
      "application/x-7z-compressed",
      "application/x-tar",
      "application/gzip",
    ]
  );
  for (const contentType of MARKDOWN_ARCHIVE_CONTENT_TYPES) {
    assert.equal(isMarkdownArchiveContentType(contentType.toUpperCase()), true);
  }
  assert.equal(isMarkdownArchiveContentType("application/x-zip"), false);
});

test("accepts every archive suffix only with a matching MIME", () => {
  for (const archive of archiveCases) {
    for (const type of archive.acceptedTypes) {
      assert.equal(
        isSupportedMarkdownArchiveFile({
          name: `bundle${archive.suffix}`,
          type,
        }),
        true,
        `${archive.suffix} should accept ${type || "empty MIME"}`
      );
      assert.equal(
        isSupportedMarkdownArchiveFile({
          name: `BUNDLE${archive.suffix.toUpperCase()}`,
          type: type.toUpperCase(),
        }),
        true,
        `${archive.suffix} and MIME should be case-insensitive`
      );
    }
  }

  assert.equal(
    isSupportedMarkdownArchiveFile({
      name: "bundle.zip",
      type: "application/x-tar",
    }),
    false
  );
  assert.equal(
    isSupportedMarkdownArchiveFile({
      name: "bundle.tar",
      type: "application/zip",
    }),
    false
  );
  assert.equal(
    isSupportedMarkdownArchiveFile({
      name: "bundle.tar.gz",
      type: "application/x-tar",
    }),
    false,
    "longest suffix must select gzipped TAR rules"
  );
  assert.equal(
    isSupportedMarkdownArchiveFile({
      name: "bundle.tar.gz.zip",
      type: "application/gzip",
    }),
    false
  );
  assert.equal(
    isSupportedMarkdownArchiveFile({
      name: "bundle.zip.exe",
      type: "application/zip",
    }),
    false
  );
});

test("feature gate keeps ZIP uploads and disables extended archive uploads", () => {
  assert.equal(
    isSupportedMarkdownArchiveFile(
      { name: "bundle.zip", type: "application/zip" },
      false
    ),
    true
  );
  for (const archive of archiveCases.filter(
    ({ suffix }) => suffix !== ".zip"
  )) {
    assert.equal(
      isSupportedMarkdownArchiveFile(
        { name: `bundle${archive.suffix}`, type: archive.normalizedType },
        false
      ),
      false
    );
  }
});

test("documented env gate disables extended attachments at module load", async () => {
  const gateName = "NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED";
  const oldGateName = "NEXT_PUBLIC_EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS";
  const originalGate = process.env[gateName];
  const originalOldGate = process.env[oldGateName];
  process.env[gateName] = "false";
  process.env[oldGateName] = "true";

  try {
    const gated = await importFreshAttachmentTypes("documented-gate-false");
    assert.equal(gated.EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED, false);
    assert.equal(
      gated.isSupportedMarkdownArchiveFile({
        name: "bundle.zip",
        type: "application/zip",
      }),
      true
    );
    assert.equal(
      gated.isSupportedMarkdownArchiveFile({
        name: "bundle.7z",
        type: "application/7z",
      }),
      false
    );
    assert.equal(
      gated.isSupportedMarkdownArchiveFile({
        name: "bundle.tar",
        type: "application/x-tar",
      }),
      false
    );
    assert.equal(
      gated.isSupportedMarkdownOfficeFile({
        name: "report.docx",
        type: "application/octet-stream",
      }),
      false
    );
  } finally {
    restoreEnv(gateName, originalGate);
    restoreEnv(oldGateName, originalOldGate);
  }
});

test("obsolete env name has no effect on the module-load gate", async () => {
  const gateName = "NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED";
  const oldGateName = "NEXT_PUBLIC_EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS";
  const originalGate = process.env[gateName];
  const originalOldGate = process.env[oldGateName];
  delete process.env[gateName];
  process.env[oldGateName] = "false";

  try {
    const gated = await importFreshAttachmentTypes("obsolete-gate-false");
    assert.equal(gated.EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED, true);
    assert.equal(
      gated.isSupportedMarkdownArchiveFile({
        name: "bundle.7z",
        type: "application/7z",
      }),
      true
    );
    assert.equal(
      gated.isSupportedMarkdownOfficeFile({
        name: "report.docx",
        type: "application/octet-stream",
      }),
      true
    );
  } finally {
    restoreEnv(gateName, originalGate);
    restoreEnv(oldGateName, originalOldGate);
  }
});

test("archive content types cannot be mutated through runtime casts", () => {
  const mutableContentTypes = MARKDOWN_ARCHIVE_CONTENT_TYPES as Set<string>;

  assert.throws(() => mutableContentTypes.add("image/png"), TypeError);
  assert.throws(() => mutableContentTypes.delete("application/zip"), TypeError);
  assert.throws(() => mutableContentTypes.clear(), TypeError);
  assert.equal(isMarkdownArchiveContentType("image/png"), false);
  assert.equal(isMarkdownArchiveContentType("application/zip"), true);
});

test("exported archive and Office catalogs are deeply immutable", () => {
  const mutableFormats = MARKDOWN_ARCHIVE_FORMATS as unknown as Array<
    (typeof MARKDOWN_ARCHIVE_FORMATS)[number]
  >;
  const zipFormat = MARKDOWN_ARCHIVE_FORMATS.find(
    ({ family }) => family === "zip"
  );
  assert.ok(zipFormat);
  assert.throws(() => mutableFormats.pop(), TypeError);
  assert.throws(() => {
    (zipFormat as { label: string }).label = "Changed";
  }, TypeError);
  assert.throws(
    () => (zipFormat.acceptedContentTypes as Set<string>).clear(),
    TypeError
  );

  assert.throws(() => {
    (MARKDOWN_OFFICE_FAMILIES as unknown as Record<string, unknown>).word =
      null;
  }, TypeError);
  assert.throws(() => {
    (MARKDOWN_OFFICE_FAMILIES.word as { label: string }).label = "Changed";
  }, TypeError);
  assert.throws(
    () =>
      (MARKDOWN_OFFICE_FAMILIES.word.extensions as unknown as string[]).pop(),
    TypeError
  );

  assert.equal(markdownArchiveLabel("bundle.zip"), "ZIP archive");
  assert.equal(markdownAttachmentLabel("report.docx"), "Word document");
  assert.equal(
    isSupportedMarkdownArchiveFile({
      name: "bundle.zip",
      type: "application/zip",
    }),
    true
  );
});

test("recognizes every Office extension by final suffix and ignores MIME", () => {
  for (const [family, office] of Object.entries(officeCases)) {
    for (const extension of office.extensions) {
      const lower = `report.${extension}`;
      const upper = `REPORT.${extension.toUpperCase()}`;
      assert.equal(officeFamilyForFilename(lower), family);
      assert.equal(officeFamilyForFilename(upper), family);
      assert.equal(
        isSupportedMarkdownOfficeFile({
          name: lower,
          type: "application/x-arbitrary",
        }),
        true
      );
      assert.equal(markdownAttachmentLabel(lower), office.label);
    }
  }
});

test("rejects path-like, misleading, and generic Office filenames", () => {
  for (const name of [
    "folder/report.docx",
    "folder\\report.docx",
    "/report.docx",
    "report.docx.exe",
    "report",
    ".docx",
    "report.pdf",
    "report.txt",
    "report.csv",
    "report.odt",
  ]) {
    assert.equal(officeFamilyForFilename(name), null, name);
    assert.equal(
      isSupportedMarkdownOfficeFile({ name, type: "application/octet-stream" }),
      false,
      name
    );
  }
});

test("feature gate disables all Office and combines Office with archive uploads", () => {
  assert.equal(
    isSupportedMarkdownOfficeFile(
      { name: "report.docx", type: "text/plain" },
      false
    ),
    false
  );
  assert.equal(
    isSupportedMarkdownAttachmentFile({
      name: "report.docx",
      type: "text/plain",
    }),
    true
  );
  assert.equal(
    isSupportedMarkdownAttachmentFile({
      name: "bundle.7z",
      type: "application/7z",
    }),
    true
  );
  assert.equal(
    isSupportedMarkdownAttachmentFile(
      { name: "bundle.zip", type: "application/zip" },
      false
    ),
    true
  );
  assert.equal(
    isSupportedMarkdownAttachmentFile(
      { name: "report.docx", type: "text/plain" },
      false
    ),
    false
  );
});

test("stored-response classification is authoritative and gate-independent", () => {
  for (const archive of archiveCases) {
    assert.equal(
      isMarkdownAttachmentAsset({
        filename: "misleading.bin",
        contentType: archive.normalizedType.toUpperCase(),
      }),
      true
    );
  }
  assert.equal(
    isMarkdownAttachmentAsset({
      filename: "report.docx",
      contentType: "application/octet-stream",
    }),
    true
  );
  assert.equal(
    isMarkdownAttachmentAsset({
      filename: "unknown.bin",
      contentType: "application/octet-stream",
    }),
    false
  );
  assert.equal(
    isMarkdownAttachmentAsset({
      filename: "report.docx",
      contentType: "application/msword",
    }),
    false
  );
  assert.equal(
    isMarkdownAttachmentAsset({
      filename: "misleading.zip",
      contentType: "image/png",
    }),
    false
  );
});

test("returns exact archive, Office, and fallback labels", () => {
  for (const archive of archiveCases) {
    assert.equal(
      markdownArchiveLabel(`bundle${archive.suffix}`),
      archive.label
    );
    assert.equal(
      markdownAttachmentLabel(`bundle${archive.suffix}`),
      archive.label
    );
  }
  for (const office of Object.values(officeCases)) {
    assert.equal(
      markdownAttachmentLabel(`REPORT.${office.extensions[0].toUpperCase()}`),
      office.label
    );
  }
  assert.equal(markdownArchiveLabel("unknown.bin"), null);
  assert.equal(markdownAttachmentLabel("unknown.bin"), "Attachment");
});
