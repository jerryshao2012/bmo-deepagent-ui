import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("HTTP fallback never publishes untouched browser state during polling", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.doesNotMatch(introPage, /[?&]push=\$\{encoded\}/);
  assert.match(
    introPage,
    /\/api\/ws-fallback\?threadId=\$\{encodeURIComponent\(threadId\)\}&poll=1/,
  );
});

test("HTTP fallback distinguishes initial empty state from an explicit delete", async () => {
  const [introPage, fallbackRoute] = await Promise.all([
    source("src/app/intro/page.tsx"),
    source("src/app/api/ws-fallback/route.ts"),
  ]);

  assert.match(fallbackRoute, /type:\s*"sync",\s*content,\s*initial:\s*true/);
  assert.match(
    introPage,
    /data\.initial\s*&&\s*!data\.content\s*&&\s*sharedTextRef\.current/,
  );
});

test("WebSocket and HTTP fallback maintain one local markdown state", async () => {
  const server = await source("server.cjs");

  assert.match(
    server,
    /globalThis\.__sseThreadStore\.(?:set|delete)\(threadId/,
  );
  assert.match(server, /roomContent\.(?:set|delete)\(threadId/);
  assert.match(
    server,
    /globalThis\.__sseNotify\(\s*threadId,\s*data\.content\s*\|\|\s*"",\s*data\.immediate\s*===\s*true\s*\)/,
  );
});

test("new local markdown wins over stale asynchronous sync responses", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /const contentVersionRef = useRef\(0\)/);
  assert.match(
    introPage,
    /requestVersion !== contentVersionRef\.current\s*\|\|\s*pendingBackendContentRef\.current !== null/,
  );
  assert.match(
    introPage,
    /pendingWebSocketContentRef\.current !== null\s*&&\s*incomingContent !== pendingWebSocketContentRef\.current/,
  );
  assert.match(
    introPage,
    /pendingFallbackUpdateRef\.current !== null\s*\|\|\s*requestVersion !== contentVersionRef\.current/,
  );
});

test("cross-machine markdown updates converge every local transport", async () => {
  const [introPage, server] = await Promise.all([
    source("src/app/intro/page.tsx"),
    source("server.cjs"),
  ]);

  assert.match(
    server,
    /type:\s*"sync",\s*content:\s*currentContent,\s*initial:\s*true/,
  );
  assert.match(
    introPage,
    /pendingWebSocketContentRef\.current = remoteContent/,
  );
  assert.match(
    introPage,
    /pendingFallbackUpdateRef\.current = \{\s*content:\s*remoteContent/,
  );
});

test("synced images are opt-in and ordinary markdown images keep existing rendering", async () => {
  const markdownContent = await source("src/app/components/MarkdownContent.tsx");

  assert.match(markdownContent, /syncedImageContext\?:\s*\{/);
  assert.match(markdownContent, /parseSyncedImageSource\(src\)/);
  assert.match(markdownContent, /<SyncedMarkdownImage/);
  assert.match(markdownContent, /if\s*\(assetId\s*&&\s*syncedImageContext\)/);
  assert.match(markdownContent, /<img\s+[\s\S]*src=\{src\}/);
});

test("synced image renderer cleans object URLs and exposes download", async () => {
  const renderer = await source("src/app/components/SyncedMarkdownImage.tsx");

  assert.match(renderer, /fetchMarkdownImage/);
  assert.match(renderer, /downloadMarkdownImage/);
  assert.match(renderer, /URL\.createObjectURL/);
  assert.match(renderer, /URL\.revokeObjectURL/);
  assert.match(renderer, /new AbortController\(\)/);
  assert.match(renderer, /controller\.abort\(\)/);
  assert.match(renderer, /Image unavailable/);
});

test("synced image requests use same-origin server-authenticated proxy", async () => {
  const helper = await source("src/lib/markdown-images.ts");

  assert.match(helper, /`\/api\/markdown-images\/\$\{markdownId\}`/);
  assert.doesNotMatch(helper, /getBrowserSessionToken/);
  assert.doesNotMatch(helper, /NEXT_PUBLIC.*API_KEY/);
});

test("synced image proxy keeps backend credentials server-side", async () => {
  const routeUrl = new URL(
    "../src/app/api/markdown-images/[markdownId]/[[...assetPath]]/route.ts",
    import.meta.url,
  );

  assert.equal(existsSync(routeUrl), true, "Markdown image proxy route is missing");
});

test("intro image gestures publish references and removal invalidates pending uploads", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /onPaste=\{handleMarkdownImagePaste\}/);
  assert.match(introPage, /onDrop=\{handleMarkdownImageDrop\}/);
  assert.match(introPage, /imageOperationEpochRef\.current \+= 1/);
  assert.match(introPage, /activeImageUploadPromiseRef\.current/);
  assert.match(introPage, /removeSyncedMarkdownWorkspace\(\{/);
  assert.match(introPage, /markdownId:\s*markdownIdToRemove/);
  assert.match(introPage, /deleteNamespace:\s*deleteMarkdownImages/);
  assert.match(
    introPage,
    /syncedImageContext=\{\{\s*markdownId:\s*threadId,\s*allowDownload:\s*true,?\s*\}\}/,
  );
});
