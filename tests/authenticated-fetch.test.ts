import assert from "node:assert/strict";
import test from "node:test";

import type { SessionProvider } from "../src/features/auth/application/session-provider";
import { createAuthenticatedFetch } from "../src/platform/http/authenticated-fetch";

function sessionProvider(refreshResult: boolean) {
  let refreshCalls = 0;
  let invalidCalls = 0;
  const provider: SessionProvider = {
    getToken: () => "token",
    refresh: async () => {
      refreshCalls += 1;
      return refreshResult;
    },
    handleInvalidSession: () => {
      invalidCalls += 1;
    },
  };
  return {
    provider,
    refreshCalls: () => refreshCalls,
    invalidCalls: () => invalidCalls,
  };
}

test("returns successful responses without refreshing", async () => {
  const session = sessionProvider(true);
  let requests = 0;
  const scopedFetch = createAuthenticatedFetch({
    sessionProvider: session.provider,
    fetchImplementation: async () => {
      requests += 1;
      return new Response(null, { status: 204 });
    },
  });

  const response = await scopedFetch("https://backend.example/health");

  assert.equal(response.status, 204);
  assert.equal(requests, 1);
  assert.equal(session.refreshCalls(), 0);
});

test("refreshes once and retries a request after a 401", async () => {
  const session = sessionProvider(true);
  let requests = 0;
  const scopedFetch = createAuthenticatedFetch({
    sessionProvider: session.provider,
    fetchImplementation: async () => {
      requests += 1;
      return new Response(null, { status: requests === 1 ? 401 : 200 });
    },
  });

  const response = await scopedFetch("https://backend.example/threads");

  assert.equal(response.status, 200);
  assert.equal(requests, 2);
  assert.equal(session.refreshCalls(), 1);
  assert.equal(session.invalidCalls(), 0);
});

test("does not refresh authentication endpoints", async () => {
  const session = sessionProvider(true);
  const scopedFetch = createAuthenticatedFetch({
    sessionProvider: session.provider,
    fetchImplementation: async () => new Response(null, { status: 401 }),
  });

  const response = await scopedFetch(
    "https://backend.example/auth/session/refresh",
  );

  assert.equal(response.status, 401);
  assert.equal(session.refreshCalls(), 0);
  assert.equal(session.invalidCalls(), 0);
});

test("marks session invalid when refresh fails", async () => {
  const session = sessionProvider(false);
  const scopedFetch = createAuthenticatedFetch({
    sessionProvider: session.provider,
    fetchImplementation: async () => new Response(null, { status: 401 }),
  });

  const response = await scopedFetch("https://backend.example/threads");

  assert.equal(response.status, 401);
  assert.equal(session.refreshCalls(), 1);
  assert.equal(session.invalidCalls(), 1);
});
