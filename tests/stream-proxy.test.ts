import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as streamProxyPost } from "../src/app/api/stream/route";

const VALID_THREAD_ID = "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271";

test("stream proxy rejects unauthenticated requests with 401", async () => {
  const req = new NextRequest("http://localhost:3000/api/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: VALID_THREAD_ID,
      input: { messages: [{ role: "user", content: "hi" }] },
    }),
  });

  const res = await streamProxyPost(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, "Authentication required");
});

test("stream proxy rejects invalid thread ID format with 400", async () => {
  const req = new NextRequest("http://localhost:3000/api/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "session_token=test-session-token",
    },
    body: JSON.stringify({
      threadId: "not-a-valid-uuid",
      input: { messages: [{ role: "user", content: "hi" }] },
    }),
  });

  const res = await streamProxyPost(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "Invalid thread ID format");
});

test("stream proxy rejects request when session validation fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth/session/validate")) {
      return Response.json({ valid: false }, { status: 200 });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  try {
    const req = new NextRequest("http://localhost:3000/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "session_token=expired-session-token",
      },
      body: JSON.stringify({
        threadId: VALID_THREAD_ID,
        input: { messages: [{ role: "user", content: "hi" }] },
      }),
    });

    const res = await streamProxyPost(req);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, "Invalid or expired session");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stream proxy returns 404 when thread is not found or inaccessible on backend", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const apiKey = new Headers(init?.headers).get("X-API-Key");
    assert.equal(apiKey, "valid-session-token");

    if (url.includes("/auth/session/validate")) {
      return Response.json(
        { valid: true, user: { name: "User" } },
        { status: 200 }
      );
    }
    if (url.includes(`/threads/${VALID_THREAD_ID}`)) {
      return new Response("Not Found", { status: 404 });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  try {
    const req = new NextRequest("http://localhost:3000/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid-session-token",
      },
      body: JSON.stringify({
        threadId: VALID_THREAD_ID,
        input: { messages: [{ role: "user", content: "hi" }] },
      }),
    });

    const res = await streamProxyPost(req);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, "Thread not found or access denied");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stream proxy returns 403 when backend rejects thread access with forbidden", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth/session/validate")) {
      return Response.json(
        { valid: true, user: { name: "User" } },
        { status: 200 }
      );
    }
    if (url.includes(`/threads/${VALID_THREAD_ID}`)) {
      return new Response("Forbidden", { status: 403 });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  try {
    const req = new NextRequest("http://localhost:3000/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "valid-session-token",
      },
      body: JSON.stringify({
        threadId: VALID_THREAD_ID,
        input: { messages: [{ role: "user", content: "hi" }] },
      }),
    });

    const res = await streamProxyPost(req);
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, "Access denied to thread");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stream proxy successfully validates session and thread access then streams run", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; headers: Headers; body?: any }[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers, body: init?.body });

    if (url.includes("/auth/session/validate")) {
      return Response.json(
        { valid: true, user: { name: "Test User" } },
        { status: 200 }
      );
    }
    if (url.endsWith(`/threads/${VALID_THREAD_ID}`)) {
      return Response.json({ thread_id: VALID_THREAD_ID }, { status: 200 });
    }
    if (url.includes(`/threads/${VALID_THREAD_ID}/runs/stream`)) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('event: values\ndata: {"ok":true}\n\n')
          );
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  };

  try {
    const req = new NextRequest("http://localhost:3000/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "session_token=user-session-token-123",
      },
      body: JSON.stringify({
        threadId: VALID_THREAD_ID,
        input: { messages: [{ role: "user", content: "hello agent" }] },
      }),
    });

    const res = await streamProxyPost(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream");

    const text = await res.text();
    assert.equal(text, 'event: values\ndata: {"ok":true}\n\n');

    // Verify calls order and headers
    assert.equal(calls.length, 3);
    assert.match(calls[0].url, /\/auth\/session\/validate$/);
    assert.equal(calls[0].headers.get("x-api-key"), "user-session-token-123");

    assert.match(calls[1].url, new RegExp(`/threads/${VALID_THREAD_ID}$`));
    assert.equal(calls[1].headers.get("x-api-key"), "user-session-token-123");

    assert.match(
      calls[2].url,
      new RegExp(`/threads/${VALID_THREAD_ID}/runs/stream$`)
    );
    assert.equal(calls[2].headers.get("content-type"), "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
