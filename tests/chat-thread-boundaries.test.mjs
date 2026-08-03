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

test("thread hook delegates LangGraph SDK operations", async () => {
  const source = await readFile("src/app/hooks/useThreads.ts", "utf8");

  assert.doesNotMatch(source, /new Client\s*\(/);
  assert.doesNotMatch(source, /client\.threads\./);
});
