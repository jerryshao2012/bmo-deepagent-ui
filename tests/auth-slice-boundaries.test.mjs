import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedSliceFiles = [
  "src/features/auth/application/passkey-authentication.ts",
  "src/features/auth/application/passkey-management.ts",
  "src/features/auth/infrastructure/passkey-bff-gateway.ts",
  "src/features/auth/infrastructure/passkey-management-bff-gateway.ts",
  "src/features/auth/infrastructure/webauthn-authenticator.ts",
  "src/features/auth/infrastructure/webauthn-registration-authenticator.ts",
];

test("passkey authentication has application and adapter boundaries", async () => {
  await Promise.all(
    expectedSliceFiles.map((file) =>
      assert.doesNotReject(readFile(file, "utf8"), `${file} must exist`)
    )
  );
});

test("passkey management UI delegates ceremonies and requests to adapters", async () => {
  const source = await readFile(
    "src/app/components/PasskeyManagementDialog.tsx",
    "utf8"
  );

  assert.doesNotMatch(source, /@simplewebauthn\/browser/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /requestJson/);
});

test("legacy passkey facade composes adapters without owning browser I/O", async () => {
  const source = await readFile("src/lib/passkey-client.ts", "utf8");

  assert.doesNotMatch(source, /@simplewebauthn\/browser/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});
