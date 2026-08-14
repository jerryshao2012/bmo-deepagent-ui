export const EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED =
  process.env.NEXT_PUBLIC_MARKDOWN_EXTENDED_ATTACHMENTS_ENABLED !== "false";

export type MarkdownArchiveFamily = "zip" | "7z" | "tar" | "tar-gzip";

export interface MarkdownArchiveFormat {
  readonly suffix: string;
  readonly family: MarkdownArchiveFamily;
  readonly label: string;
  readonly normalizedContentType: string;
  readonly acceptedContentTypes: ReadonlySet<string>;
  readonly extended: boolean;
}

class ImmutableReadonlySet<T> implements ReadonlySet<T> {
  readonly #values: Set<T>;

  constructor(values: readonly T[]) {
    this.#values = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: T): boolean {
    return this.#values.has(value);
  }

  entries(): SetIterator<[T, T]> {
    return this.#values.entries();
  }

  keys(): SetIterator<T> {
    return this.#values.keys();
  }

  values(): SetIterator<T> {
    return this.#values.values();
  }

  forEach(
    callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
    thisArg?: unknown
  ): void {
    this.#values.forEach((value) => callback.call(thisArg, value, value, this));
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }

  get [Symbol.toStringTag](): string {
    return "Set";
  }

  union<U>(other: ReadonlySetLike<U>): Set<T | U> {
    const result = new Set<T | U>(this.#values);
    const iterator = other.keys();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      result.add(next.value);
    }
    return result;
  }

  intersection<U>(other: ReadonlySetLike<U>): Set<T & U> {
    const result = new Set<T & U>();
    if (this.size <= other.size) {
      for (const value of this.#values) {
        if (other.has(value as unknown as U)) result.add(value as T & U);
      }
      return result;
    }
    const iterator = other.keys();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      if (this.has(next.value as unknown as T)) result.add(next.value as T & U);
    }
    return result;
  }

  difference<U>(other: ReadonlySetLike<U>): Set<T> {
    const result = new Set<T>();
    for (const value of this.#values) {
      if (!other.has(value as unknown as U)) result.add(value);
    }
    return result;
  }

  symmetricDifference<U>(other: ReadonlySetLike<U>): Set<T | U> {
    const result = new Set<T | U>(this.#values);
    const iterator = other.keys();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      const value = next.value;
      if (this.#values.has(value as unknown as T)) result.delete(value);
      else result.add(value);
    }
    return result;
  }

  isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
    if (this.size > other.size) return false;
    for (const value of this.#values) {
      if (!other.has(value)) return false;
    }
    return true;
  }

  isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
    if (this.size < other.size) return false;
    const iterator = other.keys();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      if (!this.has(next.value as T)) return false;
    }
    return true;
  }

  isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
    for (const value of this.#values) {
      if (other.has(value)) return false;
    }
    return true;
  }

  add(_value: T): never {
    throw new TypeError("Cannot mutate immutable Set");
  }

  delete(_value: T): never {
    throw new TypeError("Cannot mutate immutable Set");
  }

  clear(): never {
    throw new TypeError("Cannot mutate immutable Set");
  }
}

function contentTypes(values: readonly string[]): ReadonlySet<string> {
  return new ImmutableReadonlySet(values);
}

export const MARKDOWN_ARCHIVE_FORMATS: readonly MarkdownArchiveFormat[] =
  Object.freeze([
    Object.freeze({
      suffix: ".tar.gz",
      family: "tar-gzip",
      label: "Gzipped TAR archive",
      normalizedContentType: "application/gzip",
      acceptedContentTypes: contentTypes([
        "",
        "application/octet-stream",
        "application/gzip",
        "application/x-gzip",
        "application/x-compressed-tar",
        "application/x-gtar",
        "application/x-tgz",
      ]),
      extended: true,
    }),
    Object.freeze({
      suffix: ".tgz",
      family: "tar-gzip",
      label: "Gzipped TAR archive",
      normalizedContentType: "application/gzip",
      acceptedContentTypes: contentTypes([
        "",
        "application/octet-stream",
        "application/gzip",
        "application/x-gzip",
        "application/x-compressed-tar",
        "application/x-gtar",
        "application/x-tgz",
      ]),
      extended: true,
    }),
    Object.freeze({
      suffix: ".zip",
      family: "zip",
      label: "ZIP archive",
      normalizedContentType: "application/zip",
      acceptedContentTypes: contentTypes([
        "",
        "application/octet-stream",
        "application/zip",
        "application/x-zip-compressed",
      ]),
      extended: false,
    }),
    Object.freeze({
      suffix: ".7z",
      family: "7z",
      label: "7Z archive",
      normalizedContentType: "application/x-7z-compressed",
      acceptedContentTypes: contentTypes([
        "",
        "application/octet-stream",
        "application/x-7z-compressed",
        "application/7z",
        "application/vnd.7zip",
      ]),
      extended: true,
    }),
    Object.freeze({
      suffix: ".tar",
      family: "tar",
      label: "TAR archive",
      normalizedContentType: "application/x-tar",
      acceptedContentTypes: contentTypes([
        "",
        "application/octet-stream",
        "application/x-tar",
        "application/tar",
      ]),
      extended: true,
    }),
  ] satisfies MarkdownArchiveFormat[]);

export const MARKDOWN_ARCHIVE_CONTENT_TYPES: ReadonlySet<string> =
  new ImmutableReadonlySet([
    "application/zip",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
  ]);

export type MarkdownOfficeFamily =
  | "word"
  | "excel"
  | "powerpoint"
  | "access"
  | "visio"
  | "onenote"
  | "project"
  | "outlook"
  | "publisher"
  | "infopath";

export interface MarkdownOfficeFamilyDefinition {
  readonly extensions: readonly string[];
  readonly label: string;
}

export const MARKDOWN_OFFICE_FAMILIES: Readonly<
  Record<MarkdownOfficeFamily, MarkdownOfficeFamilyDefinition>
> = Object.freeze({
  word: Object.freeze({
    extensions: Object.freeze([
      "doc",
      "docx",
      "docm",
      "dot",
      "dotx",
      "dotm",
      "rtf",
      "wbk",
    ]),
    label: "Word document",
  }),
  excel: Object.freeze({
    extensions: Object.freeze([
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
    ]),
    label: "Excel workbook",
  }),
  powerpoint: Object.freeze({
    extensions: Object.freeze([
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
    ]),
    label: "PowerPoint presentation",
  }),
  access: Object.freeze({
    extensions: Object.freeze([
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
    ]),
    label: "Access database",
  }),
  visio: Object.freeze({
    extensions: Object.freeze([
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
    ]),
    label: "Visio drawing",
  }),
  onenote: Object.freeze({
    extensions: Object.freeze(["one", "onepkg", "onetoc2"]),
    label: "OneNote file",
  }),
  project: Object.freeze({
    extensions: Object.freeze(["mpp", "mpt", "mpd", "mpx"]),
    label: "Project file",
  }),
  outlook: Object.freeze({
    extensions: Object.freeze(["pst", "ost", "msg", "oft"]),
    label: "Outlook file",
  }),
  publisher: Object.freeze({
    extensions: Object.freeze(["pub"]),
    label: "Publisher document",
  }),
  infopath: Object.freeze({
    extensions: Object.freeze(["xsn"]),
    label: "InfoPath form",
  }),
});

interface MarkdownFileLike {
  readonly name: string;
  readonly type: string;
}

interface MarkdownAssetLike {
  readonly filename: string;
  readonly contentType: string;
}

const OFFICE_EXTENSION_FAMILIES = new Map<string, MarkdownOfficeFamily>(
  Object.entries(MARKDOWN_OFFICE_FAMILIES).flatMap(([family, definition]) =>
    definition.extensions.map((extension) => [
      extension,
      family as MarkdownOfficeFamily,
    ])
  )
);

function archiveFormatForFilename(
  filename: string
): MarkdownArchiveFormat | null {
  const normalizedFilename = filename.toLowerCase();
  return (
    MARKDOWN_ARCHIVE_FORMATS.find(({ suffix }) =>
      normalizedFilename.endsWith(suffix)
    ) ?? null
  );
}

export function isMarkdownArchiveContentType(contentType: string): boolean {
  return MARKDOWN_ARCHIVE_CONTENT_TYPES.has(contentType.toLowerCase());
}

export function isSupportedMarkdownArchiveFile(
  file: MarkdownFileLike,
  extendedEnabled = EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED
): boolean {
  const format = archiveFormatForFilename(file.name);
  if (!format || (format.extended && !extendedEnabled)) return false;
  return format.acceptedContentTypes.has(file.type.toLowerCase());
}

export function officeFamilyForFilename(
  filename: string
): MarkdownOfficeFamily | null {
  if (filename.includes("/") || filename.includes("\\")) return null;
  const match = /^(.+)\.([^.]+)$/.exec(filename);
  if (!match) return null;
  return OFFICE_EXTENSION_FAMILIES.get(match[2].toLowerCase()) ?? null;
}

export function isSupportedMarkdownOfficeFile(
  file: MarkdownFileLike,
  extendedEnabled = EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED
): boolean {
  return extendedEnabled && officeFamilyForFilename(file.name) !== null;
}

export function isSupportedMarkdownAttachmentFile(
  file: MarkdownFileLike,
  extendedEnabled = EXTENDED_MARKDOWN_ATTACHMENT_UPLOADS_ENABLED
): boolean {
  return (
    isSupportedMarkdownArchiveFile(file, extendedEnabled) ||
    isSupportedMarkdownOfficeFile(file, extendedEnabled)
  );
}

export function isMarkdownAttachmentAsset(asset: MarkdownAssetLike): boolean {
  const normalizedContentType = asset.contentType.toLowerCase();
  return (
    isMarkdownArchiveContentType(normalizedContentType) ||
    (normalizedContentType === "application/octet-stream" &&
      officeFamilyForFilename(asset.filename) !== null)
  );
}

export function markdownArchiveLabel(filename: string): string | null {
  return archiveFormatForFilename(filename)?.label ?? null;
}

export function markdownAttachmentLabel(filename: string): string {
  const archiveLabel = markdownArchiveLabel(filename);
  if (archiveLabel) return archiveLabel;
  const officeFamily = officeFamilyForFilename(filename);
  return officeFamily
    ? MARKDOWN_OFFICE_FAMILIES[officeFamily].label
    : "Attachment";
}
