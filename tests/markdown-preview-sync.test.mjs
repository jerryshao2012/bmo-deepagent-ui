import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

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

test("intro transport lifecycle delegates WebSocket attempt outcomes to the controller", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(
    introPage,
    /import\s*\{[\s\S]*MarkdownConnectionLifecycle[\s\S]*type MarkdownConnectionStatus[\s\S]*\}\s*from\s*["']@\/features\/markdown-sync\/application\/connection-lifecycle["']/
  );
  assert.match(introPage, /new MarkdownConnectionLifecycle\s*\(/);
  assert.match(introPage, /connectWebSocket:\s*connectWS/);
  assert.match(introPage, /abortWebSocketAttempt/);
  assert.match(introPage, /connectionFailed\(attemptId\)/);
  assert.match(introPage, /socketOpened\(attemptId\)/);
  assert.match(introPage, /initialSyncReady\(\)/);
  assert.match(introPage, /fallbackReady\(\)/);
  assert.doesNotMatch(introPage, /hasFallenBackRef/);
  assert.doesNotMatch(introPage, /reconnectTimeoutRef/);
});

test("WebSocket broadcasts start backend polling only after authoritative initial sync", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(
    introPage,
    /applyContent\(incomingContent\);\s*if\s*\(data\.initial\s*===\s*true\)\s*\{\s*lifecycleRef\.current\?\.initialSyncReady\(\);\s*\}/
  );
  assert.doesNotMatch(
    introPage,
    /applyContent\(incomingContent\);\s*lifecycleRef\.current\?\.initialSyncReady\(\)/
  );
});

test("intro transport lifecycle hibernates and resumes with page eligibility", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /document\.visibilityState\s*===\s*["']visible["']/);
  assert.match(introPage, /addEventListener\(["']visibilitychange["']/);
  assert.match(introPage, /addEventListener\(["']pagehide["']/);
  assert.match(introPage, /addEventListener\(["']pageshow["']/);
  assert.match(introPage, /removeEventListener\(["']visibilitychange["']/);
  assert.match(introPage, /removeEventListener\(["']pagehide["']/);
  assert.match(introPage, /removeEventListener\(["']pageshow["']/);
  assert.match(introPage, /lifecycle\.dispose\(\)/);
  assert.match(introPage, /lifecycleRef\.current\?\.setDialogOpen\(isDialogOpen\)/);
  assert.match(introPage, /lifecycleRef\.current\?\.reconnectNow\(\)/);
});

test("intro transport stop helpers own all timers and use safe intentional close metadata", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /const closeWebSocket = useCallback/);
  assert.match(introPage, /const stopFallback = useCallback/);
  assert.match(introPage, /const stopCrossDeployPolling = useCallback/);
  assert.match(introPage, /const stopAllTransports = useCallback/);
  assert.match(introPage, /closeWebSocket\(1000,\s*["']hibernate["']/);
  assert.match(introPage, /closeWebSocket\(4000,\s*["']attempt timeout["'],\s*attemptId\)/);
  assert.match(introPage, /intentional:\s*true/);
  assert.match(introPage, /stopFallback\(\);[\s\S]*stopCrossDeployPolling\(\)/);
});

test("cross-deployment polls discard stopped generations and serialize each active generation", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /const crossDeployPollGenerationRef = useRef\(0\)/);
  assert.match(
    introPage,
    /const crossDeployPollInFlightGenerationRef = useRef<number \| null>\(null\)/
  );
  assert.match(
    introPage,
    /stopCrossDeployPolling[\s\S]*crossDeployPollGenerationRef\.current \+= 1/
  );
  assert.match(introPage, /pollBackendOnce = useCallback\(async \(generation: number\)/);
  assert.match(
    introPage,
    /crossDeployPollInFlightGenerationRef\.current === generation\) return/
  );
  assert.match(
    introPage,
    /await backendStore\.load\(threadId\)[\s\S]{0,300}generation !== crossDeployPollGenerationRef\.current[\s\S]{0,200}activeThreadIdRef\.current !== threadId[\s\S]{0,200}resetBackendMirrorBackoff\(\)/
  );
  assert.match(
    introPage,
    /finally\s*\{\s*if \(crossDeployPollInFlightGenerationRef\.current === generation\)[\s\S]{0,120}= null/
  );
  assert.match(introPage, /void pollBackendOnce\(generation\)/);
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

  assert.match(markdownContent, /parseSyncedAttachmentHref\(href\)/);
  assert.match(markdownContent, /parseSyncedAttachmentSize\(title\)/);
  assert.match(markdownContent, /<SyncedMarkdownAttachment/);
  assert.match(markdownContent, /filename=\{[^}]+\}/);
  assert.doesNotMatch(markdownContent, /__markdown-zip/);
});

test("intro asset gestures accept mixed images and attachments", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /onPaste=\{handleMarkdownAssetPaste\}/);
  assert.match(introPage, /onDrop=\{handleMarkdownAssetDrop\}/);
  assert.match(introPage, /isSupportedMarkdownAssetFile/);
  assert.match(introPage, /validateMarkdownAssetFiles/);
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
