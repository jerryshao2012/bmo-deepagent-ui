#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourcePath = process.argv[2];

if (!sourcePath) {
  process.stderr.write(
    "Usage: node scripts/sync-backend-contract.mjs <backend-openapi.json>\n",
  );
  process.exitCode = 2;
} else {
  const raw = await readFile(path.resolve(sourcePath), "utf8");
  const schema = JSON.parse(raw);
  if (
    typeof schema.openapi !== "string" ||
    typeof schema.paths !== "object" ||
    schema.paths === null
  ) {
    throw new Error("Source is not an OpenAPI schema");
  }

  const target = path.join(repoRoot, "contracts", "backend-api.openapi.json");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(schema, null, 2)}\n`);
}
