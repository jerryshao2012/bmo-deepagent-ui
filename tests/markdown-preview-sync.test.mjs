import assert from "node:assert/strict";
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
