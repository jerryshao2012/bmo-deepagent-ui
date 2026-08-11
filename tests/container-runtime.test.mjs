import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const helperPath = path.join(repoRoot, "scripts/container-runtime.sh");
const overrideUnset = Symbol("override-unset");

const runHelper = async ({ runtimes, override = overrideUnset, body = "" }) => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "container-runtime-test-")
  );

  try {
    const binDir = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "runtime.log");
    await mkdir(binDir);

    for (const runtime of runtimes) {
      const runtimePath = path.join(binDir, runtime);
      await writeFile(
        runtimePath,
        `#!/bin/sh
printf '%s %s\\n' "\${0##*/}" "$*" >> "$RUNTIME_LOG"
exit 0
`
      );
      await chmod(runtimePath, 0o755);
    }

    const env = {
      HELPER_PATH: helperPath,
      PATH: binDir,
      RUNTIME_LOG: logPath,
    };
    if (override !== overrideUnset) env.CONTAINER_CLI = override;

    const command = body
      ? `source "$HELPER_PATH"; ${body}`
      : 'source "$HELPER_PATH"';
    const result = spawnSync(
      "/bin/bash",
      ["--noprofile", "--norc", "-c", command],
      { cwd: repoRoot, encoding: "utf8", env }
    );
    const log = await readFile(logPath, "utf8").catch(() => "");

    return { result, log };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

test("automatic selection prefers Apple container", async () => {
  const { result } = await runHelper({
    runtimes: ["container", "podman", "docker"],
    body: 'select_container_cli && printf "%s" "$CONTAINER_CLI"',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "container");
});

test("automatic selection prefers Podman over Docker", async () => {
  const { result } = await runHelper({
    runtimes: ["podman", "docker"],
    body: 'select_container_cli && printf "%s" "$CONTAINER_CLI"',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "podman");
});

test("automatic selection uses Docker when it is the only runtime", async () => {
  const { result } = await runHelper({
    runtimes: ["docker"],
    body: 'select_container_cli && printf "%s" "$CONTAINER_CLI"',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "docker");
});

test("explicit runtime override wins over automatic priority", async () => {
  const { result } = await runHelper({
    runtimes: ["container", "podman", "docker"],
    override: "docker",
    body: 'select_container_cli && printf "%s" "$CONTAINER_CLI"',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "docker");
});

test("present but empty runtime override fails clearly", async () => {
  const { result } = await runHelper({
    runtimes: ["container", "podman", "docker"],
    override: "",
    body: "select_container_cli",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONTAINER_CLI.*container.*podman.*docker/i);
});

test("unsupported runtime override fails clearly", async () => {
  const { result } = await runHelper({
    runtimes: ["container", "podman", "docker"],
    override: "nerdctl",
    body: "select_container_cli",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONTAINER_CLI.*container.*podman.*docker/i);
});

test("requested but missing runtime fails clearly", async () => {
  const { result } = await runHelper({
    runtimes: ["docker"],
    override: "podman",
    body: "select_container_cli",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /podman.*PATH/i);
});

test("automatic selection fails when no supported runtime exists", async () => {
  const { result } = await runHelper({
    runtimes: [],
    body: "select_container_cli",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /container.*podman.*docker/i);
});

test("automatic selection ignores shell functions", async () => {
  const { result } = await runHelper({
    runtimes: ["podman"],
    body: 'container() { :; }; select_container_cli && printf "%s" "$CONTAINER_CLI"',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "podman");
});

test("sourcing helper has no observable side effects", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(log, "");
});
