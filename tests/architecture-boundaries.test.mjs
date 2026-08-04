import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkArchitecture } from "../scripts/check-architecture.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("repository provides an executable architecture boundary checker", async () => {
  await assert.doesNotReject(
    access(`${repoRoot}/scripts/check-architecture.mjs`),
  );
});

test("architecture checks and dependency rules are part of repository workflow", async () => {
  const packageJson = JSON.parse(
    await readFile(`${repoRoot}/package.json`, "utf8"),
  );
  assert.equal(
    packageJson.scripts["test:architecture"],
    "node --test tests/architecture-boundaries.test.mjs tests/auth-slice-boundaries.test.mjs tests/chat-thread-boundaries.test.mjs tests/markdown-sync-architecture.test.mjs tests/platform-boundaries.test.mjs tests/wiki-skills-boundaries.test.mjs && node scripts/check-architecture.mjs",
  );
  await assert.doesNotReject(
    access(`${repoRoot}/documents/architecture/clean-architecture.md`),
  );
  const workflow = await readFile(
    `${repoRoot}/.github/workflows/architecture.yml`,
    "utf8",
  );
  assert.match(workflow, /yarn test:architecture/);
  assert.match(workflow, /yarn contract:check/);
});

const withFixture = async (files, callback) => {
  const root = await mkdtemp(path.join(tmpdir(), "ui-architecture-"));
  try {
    await Promise.all(
      Object.entries(files).map(async ([relativePath, contents]) => {
        const target = path.join(root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, contents);
      }),
    );
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("domain and application layers reject outward framework dependencies", async () => {
  await withFixture(
    {
      "src/features/chat/domain/message.ts": 'import React from "react";\n',
      "src/features/chat/application/send.ts":
        'import { client } from "../infrastructure/client";\n',
      "src/features/chat/infrastructure/client.ts": "export const client = {};\n",
    },
    async (root) => {
      const violations = await checkArchitecture({ rootDir: root });
      assert.deepEqual(
        violations.map(({ rule }) => rule).sort(),
        ["application-outward-import", "domain-framework-import"],
      );
    },
  );
});

test("features may consume another feature only through its public entrypoint", async () => {
  await withFixture(
    {
      "src/features/chat/application/send.ts":
        'import { loadThread } from "@/features/threads/infrastructure/client";\n',
      "src/features/threads/infrastructure/client.ts":
        "export const loadThread = () => null;\n",
    },
    async (root) => {
      const violations = await checkArchitecture({ rootDir: root });
      assert.equal(violations[0]?.rule, "cross-feature-internal-import");
    },
  );
});

test("local source dependency cycles are reported", async () => {
  await withFixture(
    {
      "src/features/chat/application/a.ts": 'import "./b";\n',
      "src/features/chat/application/b.ts": 'import "./a";\n',
    },
    async (root) => {
      const violations = await checkArchitecture({ rootDir: root });
      assert.equal(violations[0]?.rule, "dependency-cycle");
    },
  );
});
