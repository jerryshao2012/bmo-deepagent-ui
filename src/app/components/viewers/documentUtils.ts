import { getConfig } from "@/lib/config";
import { getBrowserSessionToken } from "@/lib/langgraph-client";

/**
 * Resolve a document citation path (as produced by the LLM) into a canonical
 * filename and the server folder where the file lives.
 *
 * Citation paths observed in the wild:
 *   /bmo_ar2025.pdf            → threads/<threadId>/bmo_ar2025.pdf
 *   /raw/deck.pptx.md          → threads-wiki/<threadId>/raw/deck.pptx.md  (wiki raw)
 *   /raw/deck.pptx             → threads-wiki/<threadId>/raw/deck.pptx     (wiki raw)
 *
 * Returns the { folder, filename } used by the /documents/* endpoints.
 */
export function resolveDocumentLocation(
  filePath: string,
  threadId: string
): { folder: string; filename: string } {
  // Strip a leading slash so the path is relative.
  const normalized = filePath.replace(/^\/+/, "");

  const isWikiRaw = normalized.startsWith("raw/");
  if (isWikiRaw) {
    // Wiki raw files live under threads-wiki/<threadId>/raw/
    const filename = normalized.replace(/^raw\//, "");
    return {
      folder: `threads-wiki/${threadId}/raw`,
      filename,
    };
  }

  // Regular uploaded documents live under threads/<threadId>/
  return {
    folder: `threads/${threadId}`,
    filename: normalized,
  };
}

/**
 * Build the absolute URL for the /documents/view/{filename} endpoint.
 */
export function buildDocumentViewUrl(
  filePath: string,
  threadId: string
): string {
  const appConfig = getConfig();
  const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
  const token = getBrowserSessionToken();
  const { folder, filename } = resolveDocumentLocation(filePath, threadId);
  const params = new URLSearchParams({ folder });
  if (token) params.set("X-API-Key", token);
  return `${deploymentUrl}/documents/view/${encodeURIComponent(
    filename
  )}?${params.toString()}`;
}

/**
 * Fetch the binary content of a document as an ArrayBuffer.
 */
export async function fetchDocumentArrayBuffer(
  filePath: string,
  threadId: string
): Promise<ArrayBuffer> {
  const appConfig = getConfig();
  const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
  const token = getBrowserSessionToken();
  const { folder, filename } = resolveDocumentLocation(filePath, threadId);
  const params = new URLSearchParams({ folder });
  const url = `${deploymentUrl}/documents/view/${encodeURIComponent(
    filename
  )}?${params.toString()}`;
  const res = await fetch(url, {
    headers: token ? { "X-API-Key": token } : {},
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch document (${res.status})`);
  }
  return res.arrayBuffer();
}

/**
 * Fetch the extracted markdown text of a document via the
 * /documents/extract/{filename} endpoint.
 */
export async function fetchDocumentExtract(
  filePath: string,
  threadId: string
): Promise<string> {
  const appConfig = getConfig();
  const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
  const token = getBrowserSessionToken();
  const { folder, filename } = resolveDocumentLocation(filePath, threadId);
  const params = new URLSearchParams({ folder });
  const url = `${deploymentUrl}/documents/extract/${encodeURIComponent(
    filename
  )}?${params.toString()}`;
  const res = await fetch(url, {
    headers: token ? { "X-API-Key": token } : {},
  });
  if (!res.ok) {
    throw new Error(`Failed to extract document (${res.status})`);
  }
  const data = await res.json();
  return data.content as string;
}

/**
 * Build the download URL for a document.
 */
export function buildDocumentDownloadUrl(
  filePath: string,
  threadId: string
): string {
  const appConfig = getConfig();
  const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
  const token = getBrowserSessionToken();
  const { folder, filename } = resolveDocumentLocation(filePath, threadId);
  const params = new URLSearchParams({ folder });
  if (token) params.set("X-API-Key", token);
  return `${deploymentUrl}/documents/download/${encodeURIComponent(
    filename
  )}?${params.toString()}`;
}

/**
 * Asynchronously fetches a document blob with auth headers and triggers a browser download.
 */
export async function downloadDocument(
  filePath: string,
  threadId: string
): Promise<void> {
  const appConfig = getConfig();
  const deploymentUrl = (appConfig?.deploymentUrl || "").replace(/\/+$/, "");
  const token = getBrowserSessionToken();
  const { folder, filename } = resolveDocumentLocation(filePath, threadId);
  const params = new URLSearchParams({ folder });
  const url = `${deploymentUrl}/documents/download/${encodeURIComponent(
    filename
  )}?${params.toString()}`;

  const res = await fetch(url, {
    headers: token ? { "X-API-Key": token } : {},
  });
  if (!res.ok) {
    throw new Error(`Failed to download document (${res.status})`);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filePath.replace(/^\/+/, "");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

