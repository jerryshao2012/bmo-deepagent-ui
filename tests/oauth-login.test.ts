import assert from "node:assert/strict";
import test from "node:test";

import { buildOAuthLoginUrl } from "../src/lib/oauth-login";

test("builds login URLs only for supported providers", () => {
  assert.equal(
    buildOAuthLoginUrl("https://backend.example.com/", "google"),
    "https://backend.example.com/auth/login/google",
  );
  assert.equal(
    buildOAuthLoginUrl("https://backend.example.com", "github"),
    "https://backend.example.com/auth/login/github",
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
      /Unsupported login provider/,
    );
  }
});
