export const MAX_MARKDOWN_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_MARKDOWN_IMAGE_COUNT = 5;

const SYNCED_IMAGE_RE =
  /^\/__markdown-image\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const ALLOWED_IMAGE_EXTENSIONS: Record<string, ReadonlySet<string>> = {
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/webp": new Set(["webp"]),
  "image/gif": new Set(["gif"]),
};

export interface MarkdownImageAsset {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

export interface MarkdownImageError {
  filename: string;
  code: string;
  message: string;
}

export interface MarkdownImageUploadResponse {
  assets: MarkdownImageAsset[];
  errors: MarkdownImageError[];
}

interface ImageFileLike {
  name: string;
  type: string;
  size: number;
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

export function escapeMarkdownAlt(filename: string): string {
  return filename
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/[\r\n]+/g, " ");
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
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  const response = await checkedResponse(
    await fetch(imageApiPath(markdownId), {
      method: "POST",
      body: formData,
    }),
    "Image upload",
  );
  return response.json() as Promise<MarkdownImageUploadResponse>;
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
  await checkedResponse(
    await fetch(imageApiPath(markdownId), {
      method: "DELETE",
    }),
    "Image cleanup",
  );
}
