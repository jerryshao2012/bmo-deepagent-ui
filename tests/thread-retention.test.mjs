import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("thread cleanup is never started automatically by mounted UI", async () => {
  const [chatPage, threadList] = await Promise.all([
    source("src/app/chat-page.tsx"),
    source("src/app/components/ThreadList.tsx"),
  ]);

  assert.doesNotMatch(chatPage, /\bcleanupOldThreads\s*\(/);
  assert.doesNotMatch(threadList, /\bcleanupOldThreads\s*\(/);
});
