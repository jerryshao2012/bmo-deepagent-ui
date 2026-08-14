import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const sourceSection = (text, startAnchor, endAnchor) => {
  const startIndex = text.indexOf(startAnchor);
  const endIndex = text.indexOf(endAnchor);
  assert.notEqual(
    startIndex,
    -1,
    `Missing source section start anchor: ${startAnchor}`
  );
  assert.notEqual(
    endIndex,
    -1,
    `Missing source section end anchor: ${endAnchor}`
  );
  assert.ok(
    endIndex > startIndex,
    "Source section end anchor must follow start anchor"
  );
  return text.slice(startIndex, endIndex);
};

test("source sections reject missing or reversed anchors", () => {
  assert.throws(
    () => sourceSection("start then end", "missing", "end"),
    /Missing source section start anchor/
  );
  assert.throws(
    () => sourceSection("start then end", "start", "missing"),
    /Missing source section end anchor/
  );
  assert.throws(
    () => sourceSection("end before start", "start", "end"),
    /Source section end anchor must follow start anchor/
  );
});

test("HTTP fallback never publishes untouched browser state during polling", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.doesNotMatch(introPage, /[?&]push=\$\{encoded\}/);
  assert.doesNotMatch(introPage, /\/api\/stream/);
  assert.match(
    introPage,
    /\/api\/ws-fallback\?threadId=\$\{encodeURIComponent\(threadId\)\}&poll=1/
  );
});

test("HTTP fallback distinguishes initial empty state from an explicit delete", async () => {
  const [introPage, fallbackRoute] = await Promise.all([
    source("src/app/intro/page.tsx"),
    source("src/app/api/ws-fallback/route.ts"),
  ]);

  assert.match(
    fallbackRoute,
    /type:\s*"sync",\s*content:\s*initialState\.content,\s*initial:\s*true,\s*authoritative:\s*initialState\.exists/
  );
  assert.match(
    introPage,
    /data\.initial\s*&&\s*!data\.authoritative\s*&&\s*!data\.content\s*&&\s*sharedTextRef\.current/
  );
});

test("HTTP fallback reads persisted custom-server state before reporting initial content", async () => {
  const [server, fallbackRoute] = await Promise.all([
    source("server.cjs"),
    source("src/app/api/ws-fallback/route.ts"),
  ]);

  assert.match(server, /globalThis\.__sseLoad\s*=\s*\(threadId\)\s*=>/);
  assert.match(fallbackRoute, /globalThis\.__sseLoad\?\.\(threadId\)/);
  assert.match(server, /pendingSaves\.has\(threadId\)/);
  assert.match(server, /if \(!state\.readable\) return state/);
  assert.match(server, /if \(!serverState\.readable\)/);
  assert.match(fallbackRoute, /if \(!state\.readable\)/);
});

test("WebSocket and HTTP fallback maintain one local markdown state", async () => {
  const server = await source("server.cjs");

  assert.match(
    server,
    /globalThis\.__sseThreadStore\.(?:set|delete)\(threadId/
  );
  assert.match(server, /roomContent\.(?:set|delete)\(threadId/);
  assert.match(
    server,
    /globalThis\.__sseNotify\(\s*threadId,\s*data\.content\s*\|\|\s*"",\s*data\.immediate\s*===\s*true\s*\)/
  );
});

test("WebSocket and HTTP fallback reject invalid markdown IDs", async () => {
  const [server, fallbackRoute] = await Promise.all([
    source("server.cjs"),
    source("src/app/api/ws-fallback/route.ts"),
  ]);

  assert.match(server, /ws\.close\(1008,\s*"Invalid threadId"\)/);
  assert.match(fallbackRoute, /\^\\d\{6\}\$/);
  assert.match(fallbackRoute, /Invalid threadId/);
  assert.match(fallbackRoute, /typeof content !== "string"/);
  assert.match(
    fallbackRoute,
    /!parsedBody \|\|\s*typeof parsedBody !== "object" \|\|\s*Array\.isArray\(parsedBody\)/
  );
  assert.match(fallbackRoute, /catch \{\s*return invalidRequestResponse\(\)/);
});

test("backend mirror failures use bounded backoff without replacing local transport status", async () => {
  const [introPage, backendStore] = await Promise.all([
    source("src/app/intro/page.tsx"),
    source(
      "src/features/markdown-sync/infrastructure/backend-markdown-sync-store.ts"
    ),
  ]);

  assert.match(introPage, /backendMirrorRetryDelay/);
  assert.match(introPage, /backendNextRetryAtRef/);
  assert.match(introPage, /pendingBackendContentRef\.current !== null/);
  assert.match(
    backendStore,
    /if\s*\(!response\.ok\)\s*throw new Error\(`Markdown sync load failed/
  );
  assert.doesNotMatch(
    introPage,
    /catch\s*\{[\s\S]{0,200}setWsStatus\((?:"|')disconnected(?:"|')\)/
  );
});

test("new local markdown wins over stale asynchronous sync responses", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /const contentVersionRef = useRef\(0\)/);
  assert.match(
    introPage,
    /requestVersion !== contentVersionRef\.current\s*\|\|\s*pendingBackendContentRef\.current !== null/
  );
  assert.match(
    introPage,
    /pendingWebSocketContentRef\.current !== null\s*&&\s*incomingContent !== pendingWebSocketContentRef\.current/
  );
  assert.match(
    introPage,
    /pendingFallbackUpdateRef\.current !== null\s*\|\|\s*requestVersion !== contentVersionRef\.current/
  );
});

test("cross-machine markdown updates converge every local transport", async () => {
  const [introPage, server] = await Promise.all([
    source("src/app/intro/page.tsx"),
    source("server.cjs"),
  ]);

  assert.match(
    server,
    /type:\s*"sync",\s*content:\s*currentContent,\s*initial:\s*true/
  );
  assert.match(
    introPage,
    /pendingWebSocketContentRef\.current = remoteContent/
  );
  assert.match(
    introPage,
    /pendingFallbackUpdateRef\.current = \{\s*content:\s*remoteContent/
  );
});

test("synced assets are opt-in and ordinary markdown images keep existing rendering", async () => {
  const markdownContent = await source(
    "src/app/components/MarkdownContent.tsx"
  );

  assert.match(markdownContent, /syncedAssetContext\?:\s*\{/);
  assert.match(markdownContent, /parseSyncedImageSource\(src\)/);
  assert.match(markdownContent, /<SyncedMarkdownImage/);
  assert.match(markdownContent, /if\s*\(assetId\s*&&\s*syncedAssetContext\)/);
  assert.match(markdownContent, /<img\s+[\s\S]*src=\{src\}/);
});

test("synced attachments use canonical type-neutral links and a dedicated card", async () => {
  const markdownContent = await source(
    "src/app/components/MarkdownContent.tsx"
  );
  const attachmentRenderer = sourceSection(
    markdownContent,
    "const attachmentId = parseSyncedAttachmentHref",
    "// Document links"
  );

  assert.match(attachmentRenderer, /parseSyncedAttachmentHref\(href\)/);
  assert.match(attachmentRenderer, /parseSyncedAttachmentSize\(title\)/);
  assert.match(attachmentRenderer, /<SyncedMarkdownAttachment/);
  assert.match(attachmentRenderer, /filename=\{[^}]+\}/);
  assert.doesNotMatch(markdownContent, /__markdown-(?:zip|7z|tar|tgz|office)/);
  assert.doesNotMatch(
    attachmentRenderer,
    /__markdown-attachment\/(?:zip|7z|tar|tgz|office)/
  );
});

test("intro asset gestures validate every non-null pasted and dropped file", async () => {
  const [introPage, assetHelpers] = await Promise.all([
    source("src/app/intro/page.tsx"),
    source("src/lib/markdown-images.ts"),
  ]);
  const assetPipeline = sourceSection(
    introPage,
    "const processMarkdownAssetFiles",
    "const handleMarkdownAssetPaste"
  );
  const pasteHandler = sourceSection(
    introPage,
    "const handleMarkdownAssetPaste",
    "const handleMarkdownAssetDragOver"
  );
  const dropHandler = sourceSection(
    introPage,
    "const handleMarkdownAssetDrop",
    "const handleCopy"
  );

  assert.match(introPage, /onPaste=\{handleMarkdownAssetPaste\}/);
  assert.match(introPage, /onDrop=\{handleMarkdownAssetDrop\}/);
  assert.doesNotMatch(
    introPage,
    /\.filter\(\s*isSupportedMarkdownAssetFile\s*\)/
  );
  assert.match(
    pasteHandler,
    /Array\.from\(event\.clipboardData\.items\)[\s\S]*?\.filter\(\(item\) => item\.kind === "file"\)[\s\S]*?\.map\(\(item\) => item\.getAsFile\(\)\)[\s\S]*?\.filter\(\(file\): file is File => file !== null\);/
  );
  assert.match(
    dropHandler,
    /const files = Array\.from\(event\.dataTransfer\.files\);/
  );
  for (const handler of [pasteHandler, dropHandler]) {
    assert.match(handler, /if \(files\.length === 0\) return;/);
    assert.match(handler, /event\.preventDefault\(\);/);
    assert.match(handler, /processMarkdownAssetFiles\(\s*files,/);
  }
  assert.equal(
    assetPipeline.match(/validateMarkdownAssetFiles\(files\)/g)?.length,
    1
  );
  assert.equal(assetPipeline.match(/uploadMarkdownAssets\(/g)?.length, 1);
  assert.equal(assetPipeline.match(/buildSyncedAssetMarkdown\(/g)?.length, 1);
  assert.doesNotMatch(
    introPage,
    /(?:zip|7z|tar|tgz|office)(?:Files?|Handlers?|Uploads?)/i
  );
  const sharedValidator = sourceSection(
    assetHelpers,
    "export function validateMarkdownAssetFiles",
    "export function parseContentDispositionFilename"
  );
  assert.match(sharedValidator, /isSupportedMarkdownAssetFile\(file\)/);
  assert.match(
    introPage,
    /const failureCount = rejected\.length \+ response\.errors\.length;/
  );
  assert.match(introPage, /buildSyncedAssetMarkdown/);
  assert.match(introPage, /uploadMarkdownAssets/);
  assert.match(introPage, /UPLOADING ATTACHMENTS/);
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
    import.meta.url
  );

  assert.equal(
    existsSync(routeUrl),
    true,
    "Markdown image proxy route is missing"
  );
});

test("intro asset gestures publish references and removal invalidates pending uploads", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /onPaste=\{handleMarkdownAssetPaste\}/);
  assert.match(introPage, /onDrop=\{handleMarkdownAssetDrop\}/);
  assert.match(introPage, /assetOperationEpochRef\.current \+= 1/);
  assert.match(introPage, /activeAssetUploadPromiseRef\.current/);
  assert.match(introPage, /removeSyncedMarkdownWorkspace\(\{/);
  assert.match(introPage, /markdownId:\s*markdownIdToRemove/);
  assert.match(introPage, /deleteNamespace:\s*deleteMarkdownAssets/);
  assert.match(
    introPage,
    /syncedAssetContext=\{\{\s*markdownId:\s*threadId,\s*allowDownload:\s*true,?\s*\}\}/
  );
});
