import assert from "node:assert/strict";
import test from "node:test";

import type { SessionProvider } from "../src/features/auth/application/session-provider";
import {
  ApiError,
  createApiTransport,
} from "../src/platform/http/api-transport";

const sessionProvider: SessionProvider = {
  getToken: () => "session-token",
  refresh: async () => false,
  handleInvalidSession: () => undefined,
};

test("resolves paths, adds session header, and parses JSON", async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const transport = createApiTransport({
    baseUrl: "https://backend.example/",
    sessionProvider,
    fetchImplementation: async (input, init) => {
      request = { input, init };
      return Response.json({ value: 42 });
    },
  });

  const result = await transport.request<{ value: number }>("/storage/info", {
    headers: { "X-Request-ID": "request-1" },
  });

  assert.deepEqual(result, { value: 42 });
  assert.equal(request?.input, "https://backend.example/storage/info");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("X-API-Key"), "session-token");
  assert.equal(headers.get("X-Request-ID"), "request-1");
});

test("maps non-success responses to typed API errors", async () => {
  const transport = createApiTransport({
    baseUrl: "https://backend.example",
    sessionProvider: { ...sessionProvider, getToken: () => "" },
    fetchImplementation: async () =>
      Response.json({ detail: "missing" }, { status: 404 }),
  });

  await assert.rejects(
    transport.request("/missing"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 404 &&
      error.body === '{"detail":"missing"}',
  );
});

test("returns undefined for successful empty responses", async () => {
  const transport = createApiTransport({
    baseUrl: "https://backend.example",
    sessionProvider,
    fetchImplementation: async () => new Response(null, { status: 204 }),
  });

  const result = await transport.request<void>("/auth/logout", {
    method: "POST",
  });

  assert.equal(result, undefined);
});
