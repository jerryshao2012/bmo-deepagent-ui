import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("scoped HTTP and browser session adapters replace global fetch mutation", async () => {
  await assert.doesNotReject(
    access(`${repoRoot}/src/platform/http/authenticated-fetch.ts`),
  );
  await assert.doesNotReject(
    access(`${repoRoot}/src/platform/http/api-transport.ts`),
  );
  await assert.doesNotReject(
    access(`${repoRoot}/src/features/auth/application/session-provider.ts`),
  );
  await assert.doesNotReject(
    access(`${repoRoot}/src/features/auth/infrastructure/browser-session-provider.ts`),
  );

  const clientSource = await readFile(
    `${repoRoot}/src/lib/langgraph-client.ts`,
    "utf8",
  );
  assert.doesNotMatch(clientSource, /window\.fetch\s*=/);
  assert.doesNotMatch(clientSource, /installGlobalAuthInterceptor/);
});

test("configuration persistence is isolated behind a browser adapter", async () => {
  await assert.doesNotReject(
    access(`${repoRoot}/src/platform/config/config-store.ts`),
  );
  await assert.doesNotReject(
    access(`${repoRoot}/src/platform/config/browser-config-store.ts`),
  );

  const compatibilitySource = await readFile(
    `${repoRoot}/src/lib/config.ts`,
    "utf8",
  );
  assert.doesNotMatch(compatibilitySource, /localStorage\./);
});

test("custom backend contracts are snapshotted and generated", async () => {
  await assert.doesNotReject(
    access(`${repoRoot}/contracts/backend-api.openapi.json`),
  );
  await assert.doesNotReject(
    access(`${repoRoot}/src/generated/backend-api.ts`),
  );
  await assert.doesNotReject(
    access(`${repoRoot}/scripts/sync-backend-contract.mjs`),
  );

  const packageJson = JSON.parse(
    await readFile(`${repoRoot}/package.json`, "utf8"),
  );
  assert.equal(
    packageJson.scripts["test:platform"],
    "node --test tests/platform-boundaries.test.mjs && node --import tsx --test --test-isolation=none tests/api-transport.test.ts tests/authenticated-fetch.test.ts",
  );
  assert.equal(
    packageJson.scripts["contract:generate"],
    "openapi-typescript contracts/backend-api.openapi.json -o src/generated/backend-api.ts",
  );
  assert.equal(
    packageJson.scripts["contract:check"],
    "openapi-typescript contracts/backend-api.openapi.json -o src/generated/backend-api.ts --check",
  );
});
