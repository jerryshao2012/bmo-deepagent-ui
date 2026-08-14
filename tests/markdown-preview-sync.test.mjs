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
    /data\.initial\s*&&\s*!data\.authoritative\s*&&\s*!data\.content\s*&&\s*pendingEdit === null\s*&&\s*sharedTextRef\.current/
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
    /globalThis\.__sseNotify\(\s*threadId,\s*data\.content\s*\|\|\s*"",\s*data\.immediate\s*===\s*true,\s*operationMetadata\s*\)/
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
    /const pendingEdit =\s*pendingEditCoordinatorRef\.current\.pendingForThread\(threadId\)/
  );
  assert.match(
    introPage,
    /pendingEditCoordinatorRef\.current\.pendingForThread\(threadId\) !==\s*null\s*\|\|\s*requestVersion !== contentVersionRef\.current/
  );
  const cacheLoadStart = introPage.indexOf(
    "// Load initial content from localStorage once threadId resolves",
  );
  const cacheLoadEnd = introPage.indexOf(
    "// ── Cross-deployment sync",
    cacheLoadStart,
  );
  const cacheLoadBlock = introPage.slice(cacheLoadStart, cacheLoadEnd);
  assert.match(
    cacheLoadBlock,
    /pendingEditCoordinatorRef\.current\s*\.readCurrent\([\s\S]*browserMarkdownStore\.load\(threadId\)/,
  );
  assert.match(cacheLoadBlock, /cachedRead\.current/);

  const backendPollStart = introPage.indexOf("const pollBackendOnce");
  const backendPollEnd = introPage.indexOf(
    "const startCrossDeployPolling",
    backendPollStart,
  );
  const backendPollBlock = introPage.slice(backendPollStart, backendPollEnd);
  assert.match(
    backendPollBlock,
    /pendingEditCoordinatorRef\.current\.readCurrent\([\s\S]*backendStore\.load\(threadId\)/,
  );
  assert.match(backendPollBlock, /if \(!backendRead\.current\) return/);
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

test("local markdown queues for WebSocket wake unless fallback is active", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(
    introPage,
    /applyContent\(value\);[\s\S]{0,220}pendingEditCoordinatorRef\.current\.publish\([\s\S]{0,100}threadId,[\s\S]{0,80}value,[\s\S]{0,80}immediate[\s\S]{0,500}else if \(wsStatusRef\.current === "fallback"\) \{\s*pendingEditCoordinatorRef\.current\.flushActiveFallback/
  );
});

test("WebSocket initial sync resends a newer pending edit before becoming ready", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  const resendStart = introPage.indexOf('resolution.action === "resend"');
  const resendEnd = introPage.indexOf(
    'if (resolution.action !== "apply")',
    resendStart,
  );
  assert.notEqual(resendStart, -1);
  assert.notEqual(resendEnd, -1);
  const resendBlock = introPage.slice(resendStart, resendEnd);
  assert.match(resendBlock, /pendingEdit !== null/);
  assert.match(resendBlock, /data\.initial === true/);
  assert.match(
    resendBlock,
    /type: "update",\s*content: pendingEdit\.content/,
  );
  assert.match(resendBlock, /lifecycleRef\.current\?\.initialSyncReady\(\)/);
  assert.match(introPage, /if \(resolution\.action !== "apply"\) return/);
  const resolverStart = introPage.indexOf(
    "const resolution = resolveMarkdownWebSocketSync",
  );
  const resolverEnd = introPage.indexOf(
    "applyContent(incomingContent)",
    resolverStart,
  );
  assert.notEqual(resolverStart, -1);
  assert.notEqual(resolverEnd, -1);
  const resolverBlock = introPage.slice(resolverStart, resolverEnd);
  assert.match(resolverBlock, /acknowledgeOperationId/);
  assert.match(resolverBlock, /acknowledgeWebSocket/);
  assert.match(
    introPage,
    /clientId:\s*markdownClientIdRef\.current,\s*operationId:\s*pendingEdit\.operationId/
  );
});

test("WebSocket operation metadata is validated and echoed as scalar fields", async () => {
  const [introPage, server] = await Promise.all([
    source("src/app/intro/page.tsx"),
    source("server.cjs"),
  ]);

  assert.match(introPage, /const markdownClientIdRef = useRef/);
  assert.match(server, /\^\[A-Za-z0-9_-\]\{1,64\}\$/);
  assert.match(server, /Number\.isSafeInteger\(metadata\.operationId\)/);
  assert.match(server, /metadata\.operationId <= 0/);
  assert.match(
    server,
    /clientId:\s*metadata\.clientId,\s*operationId:\s*metadata\.operationId/
  );
  assert.match(
    server,
    /__sseNotify\([\s\S]{0,180}operationMetadata/
  );
});

test("fallback initial sync preserves and accepts pending WebSocket content before readiness", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(
    introPage,
    /const fallbackGeneration =\s*pendingEditCoordinatorRef\.current\.startFallback\([\s\S]{0,500}signal[\s\S]{0,500}fallbackReady\(\)/
  );
  assert.match(
    introPage,
    /pendingEditCoordinatorRef\.current\.pendingForThread\(threadId\)[\s\S]{0,1000}markFallbackInitialSeen\([\s\S]{0,80}fallbackGeneration/
  );
  assert.match(
    introPage,
    /pendingEditCoordinatorRef\.current\.stopFallback\(\)/
  );
});

test("fallback nonauthoritative initial state cannot acknowledge a pending empty delete", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(
    introPage,
    /data\.initial\s*&&\s*pendingEdit !== null[\s\S]{0,250}markFallbackInitialSeen\([\s\S]{0,80}fallbackGeneration[\s\S]{0,100}return;/
  );
});

test("fallback callbacks and async polls reject stale EventSource generations", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(
    introPage,
    /addEventListener\("sync", \(event\) => \{\s*if \(eventSourceRef\.current !== eventSource\) return;/
  );
  assert.match(
    introPage,
    /await fetch\([\s\S]{0,300}eventSourceRef\.current !== eventSource[\s\S]{0,300}await res\.json\(\)[\s\S]{0,300}eventSourceRef\.current !== eventSource/
  );
  assert.match(
    introPage,
    /activeThreadIdRef\.current !== threadId/
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

test("markdown preview state and helpers synchronously guard close and rapid reopen", async () => {
  const introPage = await source("src/app/intro/page.tsx");
  const stateSection = sourceSection(
    introPage,
    "const [isDialogOpen, setIsDialogOpen]",
    "const updateWsStatus"
  );
  const helperSection = sourceSection(
    introPage,
    "const openMarkdownPreview",
    "// Prevent background body scroll"
  );
  const closeHelper = sourceSection(
    helperSection,
    "const closeMarkdownPreview",
    "useEffect(() =>"
  );

  assert.match(stateSection, /useState<number \| null>\(null\)/);
  assert.match(
    stateSection,
    /markdownPreviewTriggerRef = useRef<HTMLButtonElement>\(null\)/
  );
  assert.match(
    stateSection,
    /focusRestorationRef = useRef<PreviewFocusRestoration \| null>/
  );
  assert.match(stateSection, /restorePreviewFocusPendingRef = useRef\(false\)/);
  assert.match(
    helperSection,
    /openMarkdownPreview[\s\S]*focusRestorationRef\.current\?\.cancel\(\)[\s\S]*restorePreviewFocusPendingRef\.current = false[\s\S]*isDialogOpenRef\.current = true[\s\S]*setIsDialogOpen\(true\)/
  );
  assert.match(
    closeHelper,
    /if \(sourceLifecycle && lifecycle !== sourceLifecycle\) return;/
  );
  const refClose = closeHelper.indexOf("isDialogOpenRef.current = false");
  const lifecycleClose = closeHelper.indexOf("lifecycle?.setDialogOpen(false)");
  const reactClose = closeHelper.indexOf("setIsDialogOpen(false)");
  assert.ok(refClose !== -1 && refClose < lifecycleClose);
  assert.ok(lifecycleClose < reactClose);
  assert.match(closeHelper, /setAutoCloseSeconds\(null\)/);
  assert.match(closeHelper, /restorePreviewFocusPendingRef\.current = true/);
  assert.doesNotMatch(closeHelper, /\.schedule\(/);
});

test("markdown preview restores opener focus only from a closed post-commit effect", async () => {
  const introPage = await source("src/app/intro/page.tsx");
  const postCommitEffect = sourceSection(
    introPage,
    "useEffect(() => {\n    if (isDialogOpen || !restorePreviewFocusPendingRef.current) return;",
    "// Load initial content from localStorage"
  );

  assert.match(
    postCommitEffect,
    /restorePreviewFocusPendingRef\.current = false/
  );
  assert.match(postCommitEffect, /focusRestorationRef\.current\?\.schedule\(/);
  assert.match(
    postCommitEffect,
    /markdownPreviewTriggerRef\.current\?\.focus\(\)/
  );
  assert.match(postCommitEffect, /\(\) => !isDialogOpenRef\.current/);
  assert.match(postCommitEffect, /\}, \[isDialogOpen\]\);/);
  assert.match(
    postCommitEffect,
    /return \(\) => \{[\s\S]*focusRestorationRef\.current\?\.cancel\(\)[\s\S]*restorePreviewFocusPendingRef\.current = false/
  );
});

test("markdown lifecycle effects reject stale controllers and clean up owned countdown", async () => {
  const introPage = await source("src/app/intro/page.tsx");
  const lifecycleSection = sourceSection(
    introPage,
    "// One controller owns retries",
    "const publishContent"
  );

  assert.match(lifecycleSection, /let lifecycle: MarkdownConnectionLifecycle;/);
  assert.match(
    lifecycleSection,
    /setAutoCloseCountdown:\s*\(seconds\) => \{\s*if \(lifecycleRef\.current !== lifecycle\) return;\s*setAutoCloseSeconds\(seconds\);\s*\}/
  );
  assert.match(
    lifecycleSection,
    /requestAutoClose:\s*\(\) => \{?\s*(?:return )?closeMarkdownPreview\(lifecycle\)/
  );
  const cleanup = sourceSection(
    lifecycleSection,
    "return () => {",
    "  }, ["
  );
  const dispose = cleanup.indexOf("lifecycle.dispose()");
  const clearRef = cleanup.indexOf("lifecycleRef.current = null");
  assert.ok(dispose !== -1 && dispose < clearRef);
  assert.match(
    cleanup,
    /if \(lifecycleRef\.current === lifecycle\) \{[\s\S]*setAutoCloseSeconds\(null\)[\s\S]*lifecycleRef\.current = null/
  );
  assert.match(lifecycleSection, /closeMarkdownPreview,/);
  assert.match(
    lifecycleSection,
    /lifecycleRef\.current\?\.setDialogOpen\(isDialogOpen\)/
  );
});

test("markdown preview warning and controls are accessible and use local activity", async () => {
  const introPage = await source("src/app/intro/page.tsx");
  const opener = sourceSection(
    introPage,
    '<div className="hidden select-none items-center gap-1',
    '<a\n            href="/chat"'
  );
  const modalHeader = sourceSection(
    introPage,
    "{/* Modal Header */}",
    "{/* Custom Text Area Container"
  );

  assert.match(
    opener,
    /<button\s+type="button"\s+ref=\{markdownPreviewTriggerRef\}\s+onClick=\{openMarkdownPreview\}/
  );
  assert.match(opener, /Collab Thread/);
  assert.match(
    modalHeader,
    /data-markdown-preview-close[\s\S]{0,160}type="button"[\s\S]{0,160}onClick=\{\(\) => closeMarkdownPreview\(\)\}/
  );
  assert.match(modalHeader, /autoCloseSeconds !== null/);
  assert.match(modalHeader, /role="status"/);
  assert.match(modalHeader, /aria-live="polite"/);
  assert.match(modalHeader, /aria-atomic="true"/);
  assert.match(
    modalHeader,
    /Closing in \{autoCloseSeconds\}\{" "\}\s*\{autoCloseSeconds === 1 \? "second" : "seconds"\} due to\s*inactivity\./
  );
  assert.match(
    modalHeader,
    /<button[\s\S]{0,120}type="button"[\s\S]{0,160}onClick=\{\(\) => noteMarkdownActivity\(\)\}[\s\S]{0,400}Keep open/
  );
});

test("remote markdown paths never record local preview activity", async () => {
  const introPage = await source("src/app/intro/page.tsx");
  const remoteSections = [
    sourceSection(
      introPage,
      "const applyContent",
      "// Prevent background body scroll"
    ),
    sourceSection(
      introPage,
      "const pollBackendOnce",
      "const startCrossDeployPolling"
    ),
    sourceSection(introPage, "const startFallbackSSE", "const connectWS"),
    sourceSection(
      introPage,
      "const connectWS",
      "// One controller owns retries"
    ),
  ];

  for (const section of remoteSections) {
    assert.doesNotMatch(section, /noteMarkdownActivity\(/);
  }
});

test("markdown preview panel records local activity without backdrop or mousemove wakeups", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(
    introPage,
    /const noteMarkdownActivity = useCallback\([\s\S]{0,220}shouldRecordMarkdownActivity\(event\?\.target \?\? null\)[\s\S]{0,120}lifecycleRef\.current\?\.recordActivity\(\)/,
  );
  const backdropStart = introPage.indexOf(
    'className={cn(\n            "fixed inset-0',
  );
  const panelStart = introPage.indexOf(
    'className={cn(\n              "markdown-preview-dialog-selection',
    backdropStart,
  );
  const headerStart = introPage.indexOf("{/* Modal Header */}", panelStart);
  assert.notEqual(backdropStart, -1);
  assert.notEqual(panelStart, -1);
  assert.notEqual(headerStart, -1);

  const backdropTagStart = introPage.lastIndexOf("<div", backdropStart);
  const panelTagStart = introPage.lastIndexOf("<div", panelStart);
  const backdropOpening = introPage.slice(backdropTagStart, panelTagStart);
  const panelOpening = introPage.slice(panelTagStart, headerStart);
  assert.doesNotMatch(backdropOpening, /noteMarkdownActivity|onMouseMove/);
  assert.match(panelOpening, /onPointerDownCapture=\{noteMarkdownActivity\}/);
  assert.match(panelOpening, /onKeyDownCapture=\{noteMarkdownActivity\}/);
  assert.match(panelOpening, /onScrollCapture=\{noteMarkdownActivity\}/);
  assert.match(panelOpening, /onWheelCapture=\{noteMarkdownActivity\}/);
  assert.match(panelOpening, /onTouchStartCapture=\{noteMarkdownActivity\}/);
  assert.doesNotMatch(panelOpening, /onMouseMove/);
  assert.match(
    introPage,
    /<button\s+data-markdown-preview-close[\s\S]{0,160}onClick=\{\(\) => closeMarkdownPreview\(\)\}/,
  );
});

test("markdown mutation handlers wake transport before changing content", async () => {
  const introPage = await source("src/app/intro/page.tsx");
  const handlerBlock = (name, nextName) => {
    const start = introPage.indexOf(`const ${name}`);
    const end = introPage.indexOf(`const ${nextName}`, start);
    assert.notEqual(start, -1, `${name} exists`);
    assert.notEqual(end, -1, `${nextName} follows ${name}`);
    return introPage.slice(start, end);
  };

  for (const [name, nextName] of [
    ["handleTextChange", "handleRemove"],
    ["handleRemove", "handlePaste"],
    ["handlePaste", "processMarkdownAssetFiles"],
    ["handleMarkdownAssetPaste", "handleMarkdownAssetDragOver"],
    ["handleMarkdownAssetDrop", "handleCopy"],
  ]) {
    const block = handlerBlock(name, nextName);
    assert.match(
      block,
      /(?:=>\s*\{|async\s*\(\)\s*=>\s*\{)\s*noteMarkdownActivity\(\)/,
      `${name} records activity first`,
    );
  }
});

test("markdown transport badge uses presentation actions for wake and reconnect", async () => {
  const introPage = await source("src/app/intro/page.tsx");

  assert.match(introPage, /markdownConnectionPresentation\(wsStatus\)/);
  assert.match(
    introPage,
    /connectionPresentation\.action === "wake"[\s\S]{0,120}noteMarkdownActivity\(\)/,
  );
  assert.match(
    introPage,
    /connectionPresentation\.action === "reconnect"[\s\S]{0,300}lifecycleRef\.current\?\.reconnectNow\(\)/,
  );
  assert.match(introPage, /connectionPresentation\.label/);
  assert.match(introPage, /title=\{connectionPresentation\.title\}/);
  assert.match(
    introPage,
    /disabled=\{connectionPresentation\.action === "none"\}/,
  );
  const badgeStart = introPage.indexOf(
    "if (connectionPresentation.action === \"wake\")",
  );
  const liveStatusStart = introPage.indexOf('role="status"', badgeStart);
  const badgeEnd = introPage.lastIndexOf("</button>", liveStatusStart);
  assert.notEqual(badgeStart, -1);
  assert.notEqual(liveStatusStart, -1);
  assert.notEqual(badgeEnd, -1);
  assert.ok(badgeEnd < liveStatusStart, "live status is outside action button");
  const liveStatus = introPage.slice(liveStatusStart, liveStatusStart + 300);
  assert.match(liveStatus, /aria-live="polite"/);
  assert.match(liveStatus, /aria-atomic="true"/);
  assert.match(liveStatus, /connectionPresentation\.title/);
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
    /await pendingEditCoordinatorRef\.current\.readCurrent\([\s\S]{0,180}backendStore\.load\(threadId\)[\s\S]{0,300}generation !== crossDeployPollGenerationRef\.current[\s\S]{0,200}activeThreadIdRef\.current !== threadId[\s\S]{0,200}backendRead\.current[\s\S]{0,200}resetBackendMirrorBackoff\(\)/
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
    /pendingEditCoordinatorRef\.current\.publish\(\s*threadId,\s*remoteContent,\s*false/
  );
  assert.match(
    introPage,
    /ws\.onopen = async \(\) => \{[\s\S]{0,700}await browserMarkdownStore\.load\(threadId\)[\s\S]{0,350}ws\.send\(JSON\.stringify\(\{ type: "init", content: localContent \}\)\)/
  );
  assert.match(
    introPage,
    /const startCrossDeployPolling[\s\S]{0,350}void pollBackendOnce\(generation\);[\s\S]{0,200}window\.setInterval/
  );

  const remotePollStart = introPage.indexOf("const pollBackendOnce");
  const remotePollEnd = introPage.indexOf(
    "const startCrossDeployPolling",
    remotePollStart,
  );
  assert.notEqual(remotePollStart, -1);
  assert.notEqual(remotePollEnd, -1);
  const remotePollBlock = introPage.slice(remotePollStart, remotePollEnd);
  assert.doesNotMatch(remotePollBlock, /lifecycleRef\.current/);
  assert.match(
    remotePollBlock,
    /const remoteContent = backendRead\.value;[\s\S]*shouldApplyRemoteMarkdown\(\s*remoteContent,\s*localContent,\s*lastBackendSyncRef\.current\s*\)/,
  );
  assert.doesNotMatch(remotePollBlock, /backendRead\.value\s*\?\?/);
  const backendRelayStart = remotePollBlock.indexOf(
    "if (activeSocket?.readyState === WebSocket.OPEN)",
  );
  const backendRelayEnd = remotePollBlock.indexOf(
    "applyContent(remoteContent)",
    backendRelayStart,
  );
  assert.notEqual(backendRelayStart, -1);
  assert.notEqual(backendRelayEnd, -1);
  const backendRelayBlock = remotePollBlock.slice(
    backendRelayStart,
    backendRelayEnd,
  );
  assert.doesNotMatch(backendRelayBlock, /clientId|operationId/);
  assert.doesNotMatch(introPage, /pendingWebSocketContentRef/);
  assert.doesNotMatch(introPage, /pendingFallbackUpdateRef/);
  assert.doesNotMatch(introPage, /fallbackWriteInFlightRef/);
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
