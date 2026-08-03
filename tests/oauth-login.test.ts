import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLoginSuccessRedirect,
  buildOAuthLoginUrl,
  PASSKEY_MANAGEMENT_RETURN_PATH,
  resolveLoginSuccessRequest,
  sanitizeOAuthReturnPath,
} from "../src/lib/oauth-login";

test("builds login URLs only for supported providers", () => {
  assert.equal(
    buildOAuthLoginUrl("https://backend.example.com/", "google"),
    "https://backend.example.com/auth/login/google"
  );
  assert.equal(
    buildOAuthLoginUrl("https://backend.example.com", "github"),
    "https://backend.example.com/auth/login/github"
  );
});

test("rejects forged provider values at runtime", () => {
  for (const provider of [
    "microsoft",
    "google/../admin",
    "google?redirect=https://evil.example",
    null,
  ]) {
    assert.throws(
      () => buildOAuthLoginUrl("https://backend.example.com", provider),
      /Unsupported login provider/
    );
  }
});

test("allows only exact passkey management OAuth return path", () => {
  assert.equal(
    buildOAuthLoginUrl(
      "https://backend.example.com/",
      "google",
      PASSKEY_MANAGEMENT_RETURN_PATH
    ),
    "https://backend.example.com/auth/login/google?return_path=%2Fchat%3Fmanage%3Dpasskeys"
  );

  for (const candidate of [
    "/chat",
    "//evil.example/chat?manage=passkeys",
    "https://evil.example/chat?manage=passkeys",
    "/chat?manage=passkeys&next=evil",
    [PASSKEY_MANAGEMENT_RETURN_PATH],
    null,
  ]) {
    assert.equal(sanitizeOAuthReturnPath(candidate), null);
  }
});

test("login success redirects to management only for exact allowlisted return", () => {
  assert.equal(
    buildLoginSuccessRedirect(PASSKEY_MANAGEMENT_RETURN_PATH),
    PASSKEY_MANAGEMENT_RETURN_PATH
  );
  assert.equal(buildLoginSuccessRedirect("https://evil.example"), "/chat");
  assert.equal(buildLoginSuccessRedirect(undefined), "/chat");
});

test("OAuth success request resolves token and only exact management return", () => {
  assert.deepEqual(
    resolveLoginSuccessRequest(
      new URL(
        "https://app.example.com/login/success?token=opaque&return_path=%2Fchat%3Fmanage%3Dpasskeys"
      )
    ),
    { token: "opaque", destination: PASSKEY_MANAGEMENT_RETURN_PATH }
  );
  assert.deepEqual(
    resolveLoginSuccessRequest(
      new URL(
        "https://app.example.com/login/success?token=opaque&return_path=https%3A%2F%2Fevil.example"
      )
    ),
    { token: "opaque", destination: "/chat" }
  );
  assert.deepEqual(
    resolveLoginSuccessRequest(
      new URL("https://app.example.com/login/success")
    ),
    { token: null, destination: "/chat" }
  );
});
