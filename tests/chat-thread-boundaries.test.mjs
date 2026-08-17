import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedFiles = [
  "src/features/chat/application/ports.ts",
  "src/features/chat/infrastructure/langgraph-chat-gateway.ts",
  "src/features/chat/infrastructure/langgraph-run-executor.ts",
  "src/features/threads/application/thread-repository.ts",
  "src/features/threads/infrastructure/langgraph-thread-repository.ts",
];

test("chat and thread features expose inward ports with LangGraph adapters", async () => {
  await Promise.all(
    expectedFiles.map((file) =>
      assert.doesNotReject(readFile(file, "utf8"), `${file} must exist`)
    )
  );
});

test("chat hook delegates persistence and run execution", async () => {
  const source = await readFile("src/app/hooks/useChat.ts", "utf8");

  assert.doesNotMatch(source, /client\.threads\./);
  assert.doesNotMatch(source, /stream\.submit\s*\(/);
  assert.doesNotMatch(source, /stream\.stop\s*\(/);
});

test("chat hook uses cancellable snapshot polling", async () => {
  const source = await readFile("src/app/hooks/useChat.ts", "utf8");

  assert.match(source, /ThreadSnapshotPoller/);
  assert.doesNotMatch(source, /setInterval\(syncFromServer,\s*2500\)/);
});

test("thread hook delegates LangGraph SDK operations", async () => {
  const source = await readFile("src/app/hooks/useThreads.ts", "utf8");

  assert.doesNotMatch(source, /new Client\s*\(/);
  assert.doesNotMatch(source, /client\.threads\./);
});

test("intro collaboration IDs are never forwarded as chat thread UUIDs", async () => {
  const source = await readFile("src/app/intro/page.tsx", "utf8");

  assert.doesNotMatch(source, /\/chat\?threadId=\$\{threadId\}/);
  assert.equal(
    source.match(/href="\/chat"/g)?.length,
    3,
    "all three workspace links must start a fresh chat"
  );
});
