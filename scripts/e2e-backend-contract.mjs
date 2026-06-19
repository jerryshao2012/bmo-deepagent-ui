import { Client } from "@langchain/langgraph-sdk";

const apiUrl = process.env.API_URL || "http://127.0.0.1:2024";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { res, data, text };
}

async function main() {
  console.log("[E2E] API URL:", apiUrl);

  const ok = await fetchJson(`${apiUrl}/ok`);
  assert(ok.res.ok && ok.data?.ok === true, "/ok contract failed");

  const health = await fetchJson(`${apiUrl}/health`);
  assert(health.res.ok && typeof health.data?.status === "string", "/health contract failed");

  const create = await fetchJson(`${apiUrl}/threads`, {
    method: "POST",
    body: JSON.stringify({ metadata: { source: "frontend-e2e" } }),
  });
  assert(create.res.ok, "POST /threads failed");
  const threadId = create.data?.thread_id;
  assert(threadId, "thread_id missing from create thread");
  console.log("[E2E] thread_id:", threadId);

  const client = new Client({ apiUrl, defaultHeaders: { "x-auth-scheme": "langsmith" } });

  const threads = await client.threads.search({
    limit: 10,
    offset: 0,
    sortBy: "updated_at",
    sortOrder: "desc",
  });
  assert(Array.isArray(threads), "threads.search must return an array");
  assert(threads.some((t) => t.thread_id === threadId), "created thread not found in search");

  const got = await client.threads.get(threadId);
  assert(got.thread_id === threadId, "threads.get returned wrong thread");

  const updated = await client.threads.update(threadId, {
    metadata: { custom_title: "E2E", title_source: "user" },
  });
  assert(updated.metadata?.custom_title === "E2E", "threads.update metadata patch failed");

  const state = await client.threads.updateState(threadId, {
    values: { files: { "x.md": "hello" } },
  });
  assert(state?.checkpoint, "threads.updateState must return checkpoint");

  const streamRes = await fetch(`${apiUrl}/threads/${threadId}/runs/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assistant_id: "researcher",
      input: { messages: [{ role: "user", content: "Say hi" }] },
    }),
  });

  assert(streamRes.ok, "POST /runs/stream failed");
  const streamText = await streamRes.text();
  assert(streamText.includes("event: metadata"), "stream missing metadata event");
  assert(streamText.includes("event: updates"), "stream missing updates event");
  assert(streamText.includes("event: values"), "stream missing values event");
  assert(streamText.includes("event: end"), "stream missing end event");

  const runListRes = await fetchJson(`${apiUrl}/threads/${threadId}/runs`);
  assert(runListRes.res.ok && Array.isArray(runListRes.data), "GET /threads/{id}/runs failed");
  assert(runListRes.data.length > 0, "expected at least one run");
  const runId = runListRes.data[0].run_id;

  const runOne = await fetchJson(`${apiUrl}/threads/${threadId}/runs/${runId}`);
  assert(runOne.res.ok && runOne.data?.run_id === runId, "GET /runs/{run_id} failed");

  const cancel = await fetchJson(`${apiUrl}/threads/${threadId}/runs/${runId}/cancel`, {
    method: "POST",
  });
  assert(cancel.res.ok, "POST cancel failed");
  assert(cancel.data?.status === "interrupted", "cancel response status must be interrupted");

  await client.threads.delete(threadId);

  const gone = await fetchJson(`${apiUrl}/threads/${threadId}`);
  assert(gone.res.status === 404, "deleted thread should return 404");

  console.log("[E2E] Frontend-style backend contract verification passed.");
}

main().catch((err) => {
  console.error("[E2E] FAILED:", err);
  process.exit(1);
});