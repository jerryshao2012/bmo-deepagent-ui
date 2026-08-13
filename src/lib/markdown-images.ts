export const MAX_MARKDOWN_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_MARKDOWN_ASSET_COUNT = 5;
export const MAX_MARKDOWN_IMAGE_BYTES = MAX_MARKDOWN_ASSET_BYTES;
export const MAX_MARKDOWN_IMAGE_COUNT = MAX_MARKDOWN_ASSET_COUNT;

const SYNCED_IMAGE_RE =
  /^\/__markdown-image\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const SYNCED_ATTACHMENT_RE =
  /^\/__markdown-attachment\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const ALLOWED_IMAGE_EXTENSIONS: Record<string, ReadonlySet<string>> = {
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/webp": new Set(["webp"]),
  "image/gif": new Set(["gif"]),
};

const ALLOWED_ZIP_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/x-zip-compressed",
  "application/zip",
]);

export interface MarkdownAsset {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

export type MarkdownImageAsset = MarkdownAsset;

export interface MarkdownImageError {
  filename: string;
  code: string;
  message: string;
}

export interface MarkdownImageUploadResponse {
  assets: MarkdownImageAsset[];
  errors: MarkdownImageError[];
}

export type MarkdownAssetUploadResponse = MarkdownImageUploadResponse;

interface ImageFileLike {
  name: string;
  type: string;
  size: number;
}

type MarkdownAssetFileLike = ImageFileLike;

export function isSupportedMarkdownAssetFile(
  file: MarkdownAssetFileLike,
): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "zip") {
    return ALLOWED_ZIP_CONTENT_TYPES.has(file.type);
  }
  return Boolean(ALLOWED_IMAGE_EXTENSIONS[file.type]?.has(extension));
}

function assertMarkdownId(markdownId: string): void {
  if (!/^\d{6}$/.test(markdownId)) {
    throw new Error("Markdown ID must contain exactly six digits");
  }
}

function imageApiPath(markdownId: string): string {
  assertMarkdownId(markdownId);
  return `/api/markdown-images/${markdownId}`;
}

export function parseSyncedImageSource(src?: string): string | null {
  if (!src) return null;
  return SYNCED_IMAGE_RE.exec(src)?.[1].toLowerCase() ?? null;
}

export function parseSyncedAttachmentHref(href?: string): string | null {
  if (!href) return null;
  return SYNCED_ATTACHMENT_RE.exec(href)?.[1].toLowerCase() ?? null;
}

export function parseSyncedAttachmentSize(title?: string): number | null {
  const match = /^size=(0|[1-9]\d*)$/.exec(title ?? "");
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isSafeInteger(size) && size <= MAX_MARKDOWN_ASSET_BYTES
    ? size
    : null;
}

export function formatMarkdownAttachmentSize(
  size: number | null
): string | null {
  if (size === null || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${Math.floor(size)} B`;
  const kibibytes = size / 1024;
  if (kibibytes < 1024) {
    return `${
      Number.isInteger(kibibytes) ? kibibytes : kibibytes.toFixed(1)
    } KiB`;
  }
  const mebibytes = kibibytes / 1024;
  return `${
    Number.isInteger(mebibytes) ? mebibytes : mebibytes.toFixed(1)
  } MiB`;
}

export function escapeMarkdownAlt(filename: string): string {
  return filename
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/[\r\n]+/g, " ");
}

export function escapeMarkdownAttachmentLabel(filename: string): string {
  return escapeMarkdownAlt(filename)
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/~/g, "\\~")
    .replace(/\|/g, "\\|");
}

export function buildSyncedImageMarkdown(
  assets: ReadonlyArray<Pick<MarkdownImageAsset, "id" | "filename">>,
): string {
  return assets
    .map(
      ({ id, filename }) =>
        `![${escapeMarkdownAlt(filename)}](/__markdown-image/${id})`,
    )
    .join("\n\n");
}

export function buildSyncedAssetMarkdown(
  assets: ReadonlyArray<MarkdownAsset>
): string {
  return assets
    .map((asset) => {
      if (asset.content_type.toLowerCase() === "application/zip") {
        const filename = escapeMarkdownAttachmentLabel(asset.filename);
        return `[${filename}](/__markdown-attachment/${asset.id} "size=${asset.size}")`;
      }
      const filename = escapeMarkdownAlt(asset.filename);
      return `![${filename}](/__markdown-image/${asset.id})`;
    })
    .join("\n\n");
}

export function insertSyncedImageMarkdown({
  content,
  markdown,
  selectionStart,
  selectionEnd,
  contentChanged,
}: {
  content: string;
  markdown: string;
  selectionStart: number;
  selectionEnd: number;
  contentChanged: boolean;
}): string {
  if (contentChanged) {
    const trimmed = content.replace(/\s+$/, "");
    return trimmed ? `${trimmed}\n\n${markdown}` : markdown;
  }
  const start = Math.max(0, Math.min(selectionStart, content.length));
  const end = Math.max(start, Math.min(selectionEnd, content.length));
  return `${content.slice(0, start)}${markdown}${content.slice(end)}`;
}

export function shouldApplySyncedImageUpload({
  markdownIdAtStart,
  currentMarkdownId,
  epochAtStart,
  currentEpoch,
}: {
  markdownIdAtStart: string;
  currentMarkdownId: string;
  epochAtStart: number;
  currentEpoch: number;
}): boolean {
  return (
    markdownIdAtStart === currentMarkdownId && epochAtStart === currentEpoch
  );
}

export function canStartSyncedImageGesture({
  markdownId,
  uploadActive,
  removalActive,
}: {
  markdownId: string;
  uploadActive: boolean;
  removalActive: boolean;
}): boolean {
  return Boolean(markdownId) && !uploadActive && !removalActive;
}

export async function removeSyncedMarkdownWorkspace({
  markdownId,
  activeUpload,
  publishEmpty,
  deleteNamespace,
}: {
  markdownId: string;
  activeUpload: Promise<void> | null;
  publishEmpty: () => void;
  deleteNamespace: (markdownId: string) => Promise<void>;
}): Promise<void> {
  publishEmpty();
  if (activeUpload) await activeUpload;
  if (markdownId) await deleteNamespace(markdownId);
}

export function validateImageFiles<T extends ImageFileLike>(files: readonly T[]): {
  accepted: T[];
  rejected: MarkdownImageError[];
} {
  const accepted: T[] = [];
  const rejected: MarkdownImageError[] = [];
  for (const file of files) {
    if (accepted.length >= MAX_MARKDOWN_IMAGE_COUNT) {
      rejected.push({
        filename: file.name,
        code: "too_many_files",
        message: `Only ${MAX_MARKDOWN_IMAGE_COUNT} images can be uploaded at once`,
      });
      continue;
    }
    if (file.size > MAX_MARKDOWN_IMAGE_BYTES) {
      rejected.push({
        filename: file.name,
        code: "file_too_large",
        message: "Image exceeds 10 MiB",
      });
      continue;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_IMAGE_EXTENSIONS[file.type]?.has(extension)) {
      rejected.push({
        filename: file.name,
        code: "unsupported_image",
        message: "Only PNG, JPEG, WebP, and GIF images are supported",
      });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

export function validateMarkdownAssetFiles<T extends MarkdownAssetFileLike>(
  files: readonly T[],
): {
  accepted: T[];
  rejected: MarkdownImageError[];
} {
  const accepted: T[] = [];
  const rejected: MarkdownImageError[] = [];
  for (const file of files) {
    if (accepted.length >= MAX_MARKDOWN_ASSET_COUNT) {
      rejected.push({
        filename: file.name,
        code: "too_many_files",
        message: `Only ${MAX_MARKDOWN_ASSET_COUNT} attachments can be uploaded at once`,
      });
      continue;
    }
    if (file.size > MAX_MARKDOWN_ASSET_BYTES) {
      rejected.push({
        filename: file.name,
        code: "file_too_large",
        message: "File exceeds 10 MiB",
      });
      continue;
    }
    if (!isSupportedMarkdownAssetFile(file)) {
      rejected.push({
        filename: file.name,
        code: "unsupported_file",
        message: "Only PNG, JPEG, WebP, GIF, and ZIP files are supported",
      });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? null;
}

async function checkedResponse(response: Response, action: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${action} failed (${response.status})`);
  }
  return response;
}

export async function uploadMarkdownImages(
  markdownId: string,
  files: readonly File[],
): Promise<MarkdownImageUploadResponse> {
  return uploadMarkdownAssets(markdownId, files);
}

export async function uploadMarkdownAssets(
  markdownId: string,
  files: readonly File[]
): Promise<MarkdownAssetUploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await checkedResponse(
    await fetch(imageApiPath(markdownId), {
      method: "POST",
      body: formData,
    }),
    "Image upload",
  );
  return response.json() as Promise<MarkdownAssetUploadResponse>;
}

export async function fetchMarkdownImage(
  markdownId: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await checkedResponse(
    await fetch(`${imageApiPath(markdownId)}/${assetId}`, {
      signal,
    }),
    "Image fetch",
  );
  return {
    blob: await response.blob(),
    filename: parseContentDispositionFilename(response.headers.get("Content-Disposition")),
  };
}

export async function downloadMarkdownImage(
  markdownId: string,
  assetId: string,
  fallbackFilename: string,
): Promise<void> {
  return downloadMarkdownAsset(markdownId, assetId, fallbackFilename);
}

export async function downloadMarkdownAsset(
  markdownId: string,
  assetId: string,
  fallbackFilename: string
): Promise<void> {
  const response = await checkedResponse(
    await fetch(`${imageApiPath(markdownId)}/${assetId}/download`),
    "Image download",
  );
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download =
    parseContentDispositionFilename(response.headers.get("Content-Disposition")) ??
    fallbackFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

export async function deleteMarkdownImages(markdownId: string): Promise<void> {
  return deleteMarkdownAssets(markdownId);
}

export async function deleteMarkdownAssets(markdownId: string): Promise<void> {
  await checkedResponse(
    await fetch(imageApiPath(markdownId), {
      method: "DELETE",
    }),
    "Image cleanup",
  );
}
