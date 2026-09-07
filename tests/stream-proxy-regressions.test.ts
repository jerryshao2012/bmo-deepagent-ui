import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/stream/route";

function mockBackend(t: TestContext, run: typeof fetch) {
  return t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/session/validate"))
      return Response.json({ valid: true });
    if (!url.endsWith("/runs/stream"))
      return Response.json({ thread_id: threadId });
    return run(input, init);
  });
}

const threadId = "1b14e924-5f0e-4fdb-b85d-4dddf8bc4271";
function request(
  body: unknown = { threadId, input: { messages: [] } },
  token = "session-test"
) {
  return new NextRequest("https://ui.test/api/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `session_token=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("rejects missing session without contacting backend even with service key configured", async (t) => {
  const previous = process.env.UPLOAD_API_KEY;
  process.env.UPLOAD_API_KEY = "service-test";
  t.after(() => {
    if (previous === undefined) delete process.env.UPLOAD_API_KEY;
    else process.env.UPLOAD_API_KEY = previous;
  });
  const fetchMock = mockBackend(t, async () => new Response("data: {}\n\n"));
  assert.equal((await POST(request(undefined, ""))).status, 401);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("forwards caller session and request signal, not server credentials", async (t) => {
  const previous = process.env.UPLOAD_API_KEY;
  process.env.UPLOAD_API_KEY = "service-test";
  t.after(() => {
    if (previous === undefined) delete process.env.UPLOAD_API_KEY;
    else process.env.UPLOAD_API_KEY = previous;
  });
  const req = request();
  mockBackend(t, async (_url: unknown, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "session-test");
    assert.equal(init?.signal, req.signal);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      input: { messages: [] },
    });
    return new Response('data: {"ok":true}\n\n');
  });
  const result = await POST(req);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(await result.text(), 'data: {"ok":true}\n\n');
});

for (const status of [401, 403, 404]) {
  test(`preserves backend authorization failure ${status}`, async (t) => {
    mockBackend(t, async () => new Response("denied", { status }));
    assert.equal((await POST(request())).status, status);
  });
}

for (const body of [
  null,
  [],
  {},
  { threadId: "../other" },
  { threadId: "a?x=b" },
  { threadId: 123 },
]) {
  test(`rejects invalid stream body ${JSON.stringify(
    body
  )} before fetch`, async (t) => {
    const fetchMock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response()
    );
    assert.equal((await POST(request(body))).status, 400);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

test("returns 400 for malformed JSON", async () => {
  const req = new NextRequest("https://ui.test/api/stream", {
    method: "POST",
    headers: { Cookie: "session_token=test" },
    body: "{",
  });
  assert.equal((await POST(req)).status, 400);
});

test("returns 502 without exposing network error details", async (t) => {
  mockBackend(t, async () => {
    throw new Error("private network details");
  });
  const response = await POST(request());
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private network details/);
});

test("request headers cannot replace caller cookie with a privileged key", async (t) => {
  const req = request();
  req.headers.set("X-API-Key", "untrusted-key");
  req.headers.set("Authorization", "Bearer untrusted-key");
  mockBackend(t, async (_url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-API-Key"), "session-test");
    assert.equal(headers.get("Authorization"), null);
    return new Response("ok");
  });
  assert.equal((await POST(req)).status, 200);
});

for (const phase of ["session-denied", "thread-denied", "thread-allowed"]) {
  test(`disposes unused precheck body for ${phase}`, async (t) => {
    let cancelled = false;
    const unused = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      {
        status:
          phase === "session-denied"
            ? 401
            : phase === "thread-denied"
            ? 403
            : 200,
      }
    );
    t.mock.method(globalThis, "fetch", async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/session/validate")) {
        return phase === "session-denied"
          ? unused
          : Response.json({ valid: true });
      }
      if (url.endsWith("/runs/stream")) return new Response("ok");
      return unused;
    });
    const result = await POST(request());
    assert.equal(
      result.status,
      phase === "session-denied" ? 401 : phase === "thread-denied" ? 403 : 200
    );
    assert.equal(cancelled, true);
  });
}

test("accepts modern UUID thread IDs", async (t) => {
  mockBackend(t, async () => new Response("ok"));
  const result = await POST(
    request({ threadId: "019a6ea1-4321-7abc-8def-123456789abc" })
  );
  assert.equal(result.status, 200);
});
