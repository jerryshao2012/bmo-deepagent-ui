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

const runHelper = async ({
  runtimes,
  override = overrideUnset,
  body = "",
  containerStatus = 0,
  podmanInfoStatus = 0,
  dockerInfoStatus = 0,
}) => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "container-runtime-test-")
  );

  try {
    const binDir = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "runtime.log");
    const argumentLogPath = path.join(tempRoot, "runtime-arguments.log");
    await mkdir(binDir);

    for (const runtime of runtimes) {
      const runtimePath = path.join(binDir, runtime);
      await writeFile(
        runtimePath,
        `#!/bin/sh
printf '%s %s\\n' "\${0##*/}" "$*" >> "$RUNTIME_LOG"
printf '%s\\n' "\${0##*/}" >> "$RUNTIME_ARGUMENT_LOG"
for argument in "$@"; do
  printf '<%s>\\n' "$argument" >> "$RUNTIME_ARGUMENT_LOG"
done
printf '%s\\n' '--' >> "$RUNTIME_ARGUMENT_LOG"
case "\${0##*/}:$*" in
  "container:system status") exit "$CONTAINER_STATUS" ;;
  "podman:info") exit "$PODMAN_INFO_STATUS" ;;
  "docker:info") exit "$DOCKER_INFO_STATUS" ;;
esac
exit 0
`
      );
      await chmod(runtimePath, 0o755);
    }

    const env = {
      HELPER_PATH: helperPath,
      PATH: binDir,
      RUNTIME_LOG: logPath,
      RUNTIME_ARGUMENT_LOG: argumentLogPath,
      CONTAINER_STATUS: String(containerStatus),
      PODMAN_INFO_STATUS: String(podmanInfoStatus),
      DOCKER_INFO_STATUS: String(dockerInfoStatus),
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
    const argumentLog = await readFile(argumentLogPath, "utf8").catch(() => "");

    return { result, log, argumentLog };
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

test("Apple container starts its system when stopped", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    containerStatus: 1,
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "container system status\ncontainer system start --disable-kernel-install\n"
  );
});

test("Apple container does not start its system when already ready", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(log, "container system status\n");
});

test("Podman readiness is daemonless", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(log, "podman info\n");
  assert.doesNotMatch(log, /system start|machine start/);
});

test("unavailable Podman fails without starting anything", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    podmanInfoStatus: 1,
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Podman.*unavailable.*will not start/i);
  assert.equal(log, "podman info\n");
});

test("Docker readiness succeeds with a running daemon", async () => {
  const { result, log } = await runHelper({
    runtimes: ["docker"],
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(log, "docker info\n");
});

test("Docker readiness requires starting its daemon before retrying", async () => {
  const { result, log } = await runHelper({
    runtimes: ["docker"],
    dockerInfoStatus: 1,
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker daemon.*start.*retry/i);
  assert.equal(log, "docker info\n");
});

for (const override of [overrideUnset, "nerdctl"]) {
  const state = override === overrideUnset ? "unselected" : "invalid";

  test(`readiness rejects an ${state} runtime`, async () => {
    const { result, log } = await runHelper({
      runtimes: ["container", "podman", "docker"],
      override,
      body: "ensure_container_cli_ready",
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /select_container_cli.*container.*podman.*docker/i
    );
    assert.equal(log, "");
  });
}

const commandMappings = [
  {
    runtime: "container",
    build:
      "container build --progress plain --platform linux/amd64 -t app:latest .",
    login:
      "container registry login --username AWS --password-stdin registry.example",
    push: "container image push registry.example/app:latest",
  },
  {
    runtime: "podman",
    build: "podman build --platform linux/amd64 -t app:latest .",
    login: "podman login --username AWS --password-stdin registry.example",
    push: "podman push registry.example/app:latest",
  },
  {
    runtime: "docker",
    build:
      "docker build --progress plain --platform linux/amd64 -t app:latest .",
    login: "docker login --username AWS --password-stdin registry.example",
    push: "docker push registry.example/app:latest",
  },
];

for (const { runtime, build, login, push } of commandMappings) {
  test(`${runtime} receives exact mapped build, login, and push commands`, async () => {
    const { result, log } = await runHelper({
      runtimes: [runtime],
      override: runtime,
      body:
        `${runtime}() { return 99; }; ` +
        "select_container_cli && " +
        "container_cli_build --progress plain --platform linux/amd64 -t app:latest . && " +
        "printf secret | container_cli_login --username AWS --password-stdin registry.example && " +
        "container_cli_push registry.example/app:latest",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(log, `${build}\n${login}\n${push}\n`);
  });
}

test("Podman build removes only the exact progress pair and preserves other arguments", async () => {
  const { result, log, argumentLog } = await runHelper({
    runtimes: ["podman"],
    override: "podman",
    body:
      "select_container_cli && " +
      'container_cli_build --label "name=two words" --progress plain --progress=plain --progress fancy .',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "podman build --label name=two words --progress=plain --progress fancy .\n"
  );
  assert.equal(
    argumentLog,
    "podman\n<build>\n<--label>\n<name=two words>\n<--progress=plain>\n<--progress>\n<fancy>\n<.>\n--\n"
  );
});

for (const helper of [
  "container_cli_build",
  "container_cli_login",
  "container_cli_push",
]) {
  for (const override of [overrideUnset, "nerdctl"]) {
    const state = override === overrideUnset ? "unselected" : "invalid";

    test(`${helper} rejects an ${state} runtime without executing a command`, async () => {
      const { result, log } = await runHelper({
        runtimes: ["container", "podman", "docker"],
        override,
        body: `${helper} ignored`,
      });

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /select_container_cli.*container.*podman.*docker/i
      );
      assert.equal(log, "");
    });
  }
}
