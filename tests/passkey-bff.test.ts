import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POST as authenticationOptions } from "../src/app/api/auth/passkeys/authentication/options/route";
import { POST as authenticationVerify } from "../src/app/api/auth/passkeys/authentication/verify/route";
import { POST as registrationOptions } from "../src/app/api/auth/passkeys/registration/options/route";
import { POST as registrationVerify } from "../src/app/api/auth/passkeys/registration/verify/route";
import {
  DELETE as deletePasskey,
  PATCH as renamePasskey,
} from "../src/app/api/auth/passkeys/[credentialId]/route";

const source = (relativePath: string) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("passkey BFF exposes every backend ceremony and management route", async () => {
  const routes = [
    "src/app/api/auth/passkeys/registration/options/route.ts",
    "src/app/api/auth/passkeys/registration/verify/route.ts",
    "src/app/api/auth/passkeys/authentication/options/route.ts",
    "src/app/api/auth/passkeys/authentication/verify/route.ts",
    "src/app/api/auth/passkeys/route.ts",
    "src/app/api/auth/passkeys/[credentialId]/route.ts",
  ];

  for (const route of routes) {
    assert.equal(
      existsSync(new URL(`../${route}`, import.meta.url)),
      true,
      route
    );
  }

  assert.equal(
    existsSync(new URL("../src/lib/passkey-client.ts", import.meta.url)),
    true,
    "browser passkey ceremony client is missing"
  );
});

test("passkey browser dependency and focused test script are declared", async () => {
  const packageJson = JSON.parse(await source("package.json"));

  assert.equal(
    typeof packageJson.dependencies["@simplewebauthn/browser"],
    "string"
  );
  assert.match(packageJson.scripts["test:passkeys"], /passkey-bff\.test\.ts/);
  assert.match(
    packageJson.scripts["test:passkeys"],
    /passkey-login\.test\.tsx/
  );
});

test("passkey client exposes support detection and authentication ceremony", async () => {
  const client = await import("../src/lib/passkey-client");

  assert.equal(typeof client.supportsPasskeyAuthentication, "function");
  assert.equal(typeof client.authenticateWithPasskey, "function");
  assert.equal(typeof client.isPasskeyCancellation, "function");
});

const envKeys = [
  "PASSKEY_ENABLED",
  "PASSKEY_ORIGIN",
  "PASSKEY_PROXY_ID",
  "PASSKEY_PROXY_SECRET",
  "LANGGRAPH_URL",
] as const;

const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]])
);
const originalFetch = globalThis.fetch;

function configurePasskeyBff() {
  process.env.PASSKEY_ENABLED = "true";
  process.env.PASSKEY_ORIGIN = "https://app.example.com";
  process.env.PASSKEY_PROXY_ID = "web-bff";
  process.env.PASSKEY_PROXY_SECRET = "proxy-secret-with-at-least-32-bytes";
  process.env.LANGGRAPH_URL = "https://backend.example.com/";
}

function authenticationPayload() {
  return {
    ceremony_id: "ceremony-123",
    response: {
      id: "Y3JlZGVudGlhbA",
      rawId: "Y3JlZGVudGlhbA",
      type: "public-key",
      response: {
        clientDataJSON: "Y2xpZW50",
        authenticatorData: "YXV0aGVudGljYXRvcg",
        signature: "c2lnbmF0dXJl",
        userHandle: "dXNlci1oYW5kbGU",
      },
      clientExtensionResults: {},
    },
  };
}

function registrationPayload() {
  return {
    ceremony_id: "ceremony-123",
    response: {
      id: "Y3JlZGVudGlhbA",
      rawId: "Y3JlZGVudGlhbA",
      type: "public-key",
      response: {
        clientDataJSON: "Y2xpZW50",
        attestationObject: "YXR0ZXN0YXRpb24",
        transports: ["internal"],
      },
      clientExtensionResults: {},
    },
    label: "Laptop",
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("authentication options use configured origin and trusted proxy credentials", async () => {
  configurePasskeyBff();
  let forwardedUrl = "";
  let forwardedHeaders = new Headers();
  globalThis.fetch = async (input, init) => {
    forwardedUrl = String(input);
    forwardedHeaders = new Headers(init?.headers);
    return Response.json({ challenge: "challenge" });
  };

  const response = await authenticationOptions(
    new Request(
      "https://attacker.example/api/auth/passkeys/authentication/options",
      {
        method: "POST",
        headers: { host: "attacker.example" },
      }
    )
  );

  assert.equal(response.status, 200);
  assert.equal(
    forwardedUrl,
    "https://backend.example.com/auth/passkeys/authentication/options"
  );
  assert.equal(forwardedHeaders.get("x-passkey-proxy-id"), "web-bff");
  assert.equal(
    forwardedHeaders.get("x-passkey-proxy-secret"),
    "proxy-secret-with-at-least-32-bytes"
  );
  assert.equal(
    forwardedHeaders.get("x-passkey-origin"),
    "https://app.example.com"
  );
  assert.doesNotMatch([...forwardedHeaders.values()].join(" "), /attacker/);
});

test("protected options forward current session only from server-side cookie", async () => {
  configurePasskeyBff();
  let forwardedHeaders = new Headers();
  globalThis.fetch = async (_input, init) => {
    forwardedHeaders = new Headers(init?.headers);
    return Response.json({ challenge: "challenge" });
  };

  const response = await registrationOptions(
    new Request(
      "https://app.example.com/api/auth/passkeys/registration/options",
      {
        method: "POST",
        headers: {
          cookie: "other=value; session_token=session-secret",
          origin: "https://app.example.com",
        },
      }
    )
  );

  assert.equal(response.status, 200);
  assert.equal(forwardedHeaders.get("authorization"), "Bearer session-secret");
});

test("protected state changes require exact configured request origin", async () => {
  configurePasskeyBff();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ok: true });
  };

  const attempts = [
    await registrationOptions(
      new Request(
        "https://app.example.com/api/auth/passkeys/registration/options",
        {
          method: "POST",
          headers: { cookie: "session_token=session-secret" },
        }
      )
    ),
    await registrationOptions(
      new Request(
        "https://app.example.com/api/auth/passkeys/registration/options",
        {
          method: "POST",
          headers: {
            cookie: "session_token=session-secret",
            origin: "https://evil.example",
          },
        }
      )
    ),
    await renamePasskey(
      new Request("https://app.example.com/api/auth/passkeys/Y3JlZGVudGlhbA", {
        method: "PATCH",
        headers: {
          cookie: "session_token=session-secret",
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({ label: "Attacker" }),
      }),
      { params: Promise.resolve({ credentialId: "Y3JlZGVudGlhbA" }) }
    ),
    await deletePasskey(
      new Request("https://app.example.com/api/auth/passkeys/Y3JlZGVudGlhbA", {
        method: "DELETE",
        headers: {
          cookie: "session_token=session-secret",
          origin: "null",
        },
      }),
      { params: Promise.resolve({ credentialId: "Y3JlZGVudGlhbA" }) }
    ),
  ];

  for (const response of attempts) {
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: "invalid_request_origin" });
  }
  assert.equal(fetchCount, 0);
});

test("exact Origin is accepted independently of request URL and Host", async () => {
  configurePasskeyBff();
  let forwarded = false;
  globalThis.fetch = async () => {
    forwarded = true;
    return Response.json({ options: {} });
  };

  const response = await registrationOptions(
    new Request(
      "https://attacker.example/api/auth/passkeys/registration/options",
      {
        method: "POST",
        headers: {
          cookie: "session_token=session-secret",
          host: "attacker.example",
          origin: "https://app.example.com",
        },
      }
    )
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded, true);
});

test("protected options reject missing session before contacting backend", async () => {
  configurePasskeyBff();
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({});
  };

  const response = await registrationOptions(
    new Request(
      "https://app.example.com/api/auth/passkeys/registration/options",
      {
        method: "POST",
        headers: { origin: "https://app.example.com" },
      }
    )
  );

  assert.equal(response.status, 401);
  assert.equal(fetchCalled, false);
});

test("authentication verification strips token and sets compatibility cookie", async () => {
  configurePasskeyBff();
  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      session_token: "opaque-session",
      user: {
        name: "Ada Lovelace",
        provider: "google",
        auth_method: "passkey",
      },
      internal: "must-not-leak",
    });

  const response = await authenticationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authenticationPayload()),
      }
    )
  );

  assert.deepEqual(await response.json(), {
    ok: true,
    user: {
      name: "Ada Lovelace",
      provider: "google",
      auth_method: "passkey",
    },
  });
  const cookie = response.headers.get("set-cookie") || "";
  assert.match(cookie, /^session_token=opaque-session/);
  assert.match(cookie, /Path=\//i);
  assert.match(cookie, /Max-Age=86400/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.doesNotMatch(cookie, /HttpOnly/i);
});

test("verification rejects invalid media types and oversized payloads", async () => {
  configurePasskeyBff();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({});
  };

  const wrongType = await authenticationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        body: "{}",
      }
    )
  );
  const oversized = await authenticationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "65537",
        },
        body: "{}",
      }
    )
  );

  assert.equal(wrongType.status, 415);
  assert.equal(oversized.status, 413);
  assert.equal(fetchCount, 0);
});

test("missing trusted configuration fails closed without using request host", async () => {
  process.env.PASSKEY_ENABLED = "true";
  delete process.env.PASSKEY_ORIGIN;
  process.env.PASSKEY_PROXY_ID = "web-bff";
  process.env.PASSKEY_PROXY_SECRET = "proxy-secret-with-at-least-32-bytes";
  process.env.LANGGRAPH_URL = "https://backend.example.com";
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({});
  };

  const response = await authenticationOptions(
    new Request(
      "https://attacker.example/api/auth/passkeys/authentication/options",
      {
        method: "POST",
      }
    )
  );

  assert.equal(response.status, 503);
  assert.equal(fetchCalled, false);
});

test("BFF stays disabled unless PASSKEY_ENABLED is explicitly true", async () => {
  configurePasskeyBff();
  delete process.env.PASSKEY_ENABLED;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({});
  };

  const response = await authenticationOptions(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/options",
      { method: "POST" }
    )
  );

  assert.equal(response.status, 503);
  assert.equal(fetchCalled, false);
});

test("BFF rejects proxy settings that backend startup would reject", async () => {
  const invalidConfigurations = [
    { PASSKEY_PROXY_ID: "x".repeat(256) },
    { PASSKEY_PROXY_ID: "代理-bff" },
    { PASSKEY_PROXY_SECRET: "too-short" },
    { PASSKEY_PROXY_SECRET: "é".repeat(32) },
    { PASSKEY_PROXY_SECRET: `${"x".repeat(31)}\n` },
    { PASSKEY_PROXY_SECRET: "🙂".repeat(1025) },
    { PASSKEY_ORIGIN: "https://app.example.com/path" },
  ];

  for (const override of invalidConfigurations) {
    configurePasskeyBff();
    Object.assign(process.env, override);
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return Response.json({});
    };

    let response: Response | undefined;
    await assert.doesNotReject(async () => {
      response = await authenticationOptions(
        new Request(
          "https://app.example.com/api/auth/passkeys/authentication/options",
          { method: "POST" }
        )
      );
    });
    assert.equal(response?.status, 503);
    assert.equal(fetchCalled, false);
  }
});

test("HTTP origins allow numeric IPv4 loopback but reject lookalike hostnames", async () => {
  configurePasskeyBff();
  process.env.PASSKEY_ORIGIN = "http://127.0.0.2:3000";
  let forwardedOrigin = "";
  globalThis.fetch = async (_input, init) => {
    forwardedOrigin = new Headers(init?.headers).get("x-passkey-origin") || "";
    return Response.json({});
  };

  const loopbackResponse = await authenticationOptions(
    new Request(
      "http://127.0.0.2:3000/api/auth/passkeys/authentication/options",
      { method: "POST" }
    )
  );
  process.env.PASSKEY_ORIGIN = "http://127.attacker.example";
  const lookalikeResponse = await authenticationOptions(
    new Request(
      "http://127.attacker.example/api/auth/passkeys/authentication/options",
      { method: "POST" }
    )
  );

  assert.equal(loopbackResponse.status, 200);
  assert.equal(forwardedOrigin, "http://127.0.0.2:3000");
  assert.equal(lookalikeResponse.status, 503);
});

test("BFF rejects insecure non-local passkey origins", async () => {
  configurePasskeyBff();
  process.env.PASSKEY_ORIGIN = "http://app.example.com";
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return Response.json({});
  };

  const response = await authenticationOptions(
    new Request(
      "http://app.example.com/api/auth/passkeys/authentication/options",
      {
        method: "POST",
      }
    )
  );

  assert.equal(response.status, 503);
  assert.equal(fetchCalled, false);
});

test("registration verification and management calls require session and bounded JSON", async () => {
  configurePasskeyBff();
  const forwarded: Array<{ url: string; headers: Headers; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    forwarded.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body || ""),
    });
    return Response.json({ ok: true });
  };

  const registrationResponse = await registrationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/registration/verify",
      {
        method: "POST",
        headers: {
          cookie: "session_token=session-secret",
          "content-type": "application/json",
          origin: "https://app.example.com",
        },
        body: JSON.stringify(registrationPayload()),
      }
    )
  );
  const renameResponse = await renamePasskey(
    new Request("https://app.example.com/api/auth/passkeys/Y3JlZGVudGlhbA", {
      method: "PATCH",
      headers: {
        cookie: "session_token=session-secret",
        "content-type": "application/json",
        origin: "https://app.example.com",
      },
      body: JSON.stringify({ label: "Laptop" }),
    }),
    { params: Promise.resolve({ credentialId: "Y3JlZGVudGlhbA" }) }
  );

  assert.equal(registrationResponse.status, 200);
  assert.equal(renameResponse.status, 200);
  assert.equal(
    forwarded[0].url,
    "https://backend.example.com/auth/passkeys/registration/verify"
  );
  assert.equal(
    forwarded[1].url,
    "https://backend.example.com/auth/passkeys/Y3JlZGVudGlhbA"
  );
  assert.equal(
    forwarded[1].headers.get("authorization"),
    "Bearer session-secret"
  );
  assert.deepEqual(JSON.parse(forwarded[1].body), { label: "Laptop" });
});

test("registration labels are trimmed, code-point bounded, and blank labels are omitted", async () => {
  configurePasskeyBff();
  const forwardedBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    forwardedBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  };
  const headers = {
    cookie: "session_token=session-secret",
    "content-type": "application/json",
    origin: "https://app.example.com",
  };
  const validAstralLabel = "🔑".repeat(100);

  const padded = await registrationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/registration/verify",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...registrationPayload(),
          label: `  ${validAstralLabel}  `,
        }),
      }
    )
  );
  const blank = await registrationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/registration/verify",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ...registrationPayload(), label: "   " }),
      }
    )
  );
  const tooLong = await registrationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/registration/verify",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...registrationPayload(),
          label: ` ${"x".repeat(101)} `,
        }),
      }
    )
  );

  assert.equal(padded.status, 200);
  assert.equal(blank.status, 200);
  assert.equal(tooLong.status, 400);
  assert.equal(forwardedBodies.length, 2);
  assert.equal(forwardedBodies[0].label, validAstralLabel);
  assert.equal("label" in forwardedBodies[1], false);
});

test("rename labels require a trimmed nonempty value of at most 100 code points", async () => {
  configurePasskeyBff();
  const forwardedBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    forwardedBodies.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  };
  const request = (label: unknown) =>
    renamePasskey(
      new Request("https://app.example.com/api/auth/passkeys/Y3JlZGVudGlhbA", {
        method: "PATCH",
        headers: {
          cookie: "session_token=session-secret",
          "content-type": "application/json",
          origin: "https://app.example.com",
        },
        body: JSON.stringify({ label }),
      }),
      { params: Promise.resolve({ credentialId: "Y3JlZGVudGlhbA" }) }
    );
  const validAstralLabel = "💻".repeat(100);

  const valid = await request(`  ${validAstralLabel}  `);
  const blank = await request("   ");
  const tooLong = await request("💻".repeat(101));
  const nonString = await request(42);

  assert.equal(valid.status, 200);
  assert.equal(blank.status, 400);
  assert.equal(tooLong.status, 400);
  assert.equal(nonString.status, 400);
  assert.deepEqual(forwardedBodies, [{ label: validAstralLabel }]);
});

test("registration and rename reject ill-formed Unicode labels", async () => {
  configurePasskeyBff();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({ ok: true });
  };
  const headers = {
    cookie: "session_token=session-secret",
    "content-type": "application/json",
    origin: "https://app.example.com",
  };

  for (const label of ["\ud800", "\udc00"]) {
    const registration = await registrationVerify(
      new Request(
        "https://app.example.com/api/auth/passkeys/registration/verify",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ ...registrationPayload(), label }),
        }
      )
    );
    const rename = await renamePasskey(
      new Request("https://app.example.com/api/auth/passkeys/Y3JlZGVudGlhbA", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ label }),
      }),
      { params: Promise.resolve({ credentialId: "Y3JlZGVudGlhbA" }) }
    );

    assert.equal(registration.status, 400);
    assert.equal(rename.status, 400);
  }
  assert.equal(fetchCount, 0);
});

test("route-specific schemas reject malformed ceremonies, labels, and credential IDs", async () => {
  configurePasskeyBff();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({});
  };

  const invalidAuthentication = await authenticationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ceremony_id: "bad ceremony", response: {} }),
      }
    )
  );
  const invalidRegistration = await registrationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/registration/verify",
      {
        method: "POST",
        headers: {
          cookie: "session_token=session-secret",
          "content-type": "application/json",
          origin: "https://app.example.com",
        },
        body: JSON.stringify({
          ...registrationPayload(),
          label: "x".repeat(101),
        }),
      }
    )
  );
  const invalidRename = await renamePasskey(
    new Request("https://app.example.com/api/auth/passkeys/invalid", {
      method: "PATCH",
      headers: {
        cookie: "session_token=session-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({ label: 42 }),
    }),
    { params: Promise.resolve({ credentialId: "not/base64url" }) }
  );

  assert.equal(invalidAuthentication.status, 400);
  assert.equal(invalidRegistration.status, 400);
  assert.equal(invalidRename.status, 400);
  assert.equal(fetchCount, 0);
});

test("JSON validation measures actual bytes and rejects malformed objects", async () => {
  configurePasskeyBff();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({});
  };

  for (const body of [
    "not-json",
    "[]",
    JSON.stringify({ value: "x".repeat(65_537) }),
  ]) {
    const response = await authenticationVerify(
      new Request(
        "https://app.example.com/api/auth/passkeys/authentication/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }
      )
    );
    assert.equal(response.status, body.length > 65_536 ? 413 : 400);
  }
  assert.equal(fetchCount, 0);
});

test("JSON parser rejects lookalike media types and stops reading at hard cap", async () => {
  configurePasskeyBff();
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return Response.json({});
  };

  const lookalike = await authenticationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json-patch+json" },
        body: JSON.stringify(authenticationPayload()),
      }
    )
  );

  let pullCount = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pullCount += 1;
        if (pullCount <= 2) {
          controller.enqueue(new Uint8Array(40_000));
        } else {
          controller.error(new Error("body read continued past hard cap"));
        }
      },
    },
    { highWaterMark: 0 }
  );
  const streamed = await authenticationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit & { duplex: "half" }
    )
  );

  assert.equal(lookalike.status, 415);
  assert.equal(streamed.status, 413);
  assert.equal(pullCount, 2);
  assert.equal(fetchCount, 0);
});

test("authentication verification never exposes backend session tokens", async () => {
  configurePasskeyBff();
  globalThis.fetch = async () =>
    Response.json(
      {
        code: "invalid_credential",
        session_token: "must-not-leak",
        token: "also-must-not-leak",
      },
      { status: 401 }
    );

  const response = await authenticationVerify(
    new Request(
      "https://app.example.com/api/auth/passkeys/authentication/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(authenticationPayload()),
      }
    )
  );
  const body = await response.text();

  assert.equal(response.status, 401);
  assert.equal(body.includes("must-not-leak"), false);
  assert.equal(response.headers.has("set-cookie"), false);
});

test("authenticated user keeps optional passkey auth method outside remembered schema", async () => {
  const [chatPage, rememberedLogin] = await Promise.all([
    source("src/app/chat/page.tsx"),
    source("src/lib/remembered-login.ts"),
  ]);

  assert.match(chatPage, /auth_method:\s*data\.user\.auth_method/);
  assert.match(rememberedLogin, /auth_method\?:\s*"oauth"\s*\|\s*"passkey"/);
  assert.doesNotMatch(
    rememberedLogin,
    /interface RememberedLogin \{[^}]*auth_method/
  );
});

test("login page keeps passkeys hidden until trusted BFF configuration is complete", async () => {
  const loginPage = await source("src/app/login/page.tsx");

  assert.match(loginPage, /passkeysEnabled=\{isPasskeyBffConfigured\(\)\}/);
  assert.match(loginPage, /isPasskeyBffConfigured/);
});
