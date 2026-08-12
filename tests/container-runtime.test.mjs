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
  nonExecutableRuntimes = [],
  override = overrideUnset,
  body = "",
  containerStatus = 0,
  podmanInfoStatus = 0,
  podmanInfoStatusAfterStart = 0,
  podmanMachineStartStatus = 0,
  dockerInfoStatus = 0,
  containerStartStatus = 0,
  builderStatus = 0,
  builderJson = JSON.stringify([
    {
      configuration: { resources: { memoryInBytes: 8589934592 } },
      status: { state: "running" },
    },
  ]),
  builderStopStatus = 0,
  builderDeleteStatus = 0,
  builderStartStatus = 0,
  deferNodeStdout = false,
  buildStatus = 0,
  loginStatus = 0,
  pushStatus = 0,
}) => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "container-runtime-test-")
  );

  try {
    const binDir = path.join(tempRoot, "bin");
    const logPath = path.join(tempRoot, "runtime.log");
    const argumentLogPath = path.join(tempRoot, "runtime-arguments.log");
    const stdinLogPath = path.join(tempRoot, "runtime-stdin.log");
    const nonExecutableRuntimeSet = new Set(nonExecutableRuntimes);
    await mkdir(binDir);

    const nodePath = path.join(binDir, "node");
    await writeFile(
      nodePath,
      `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`
    );
    await chmod(nodePath, 0o755);

    const nodePreludePath = path.join(tempRoot, "defer-node-stdout.cjs");
    await writeFile(
      nodePreludePath,
      `const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (...args) => {
  setImmediate(() => write(...args));
  return true;
};
`
    );

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
case "\${0##*/}:$1:$2" in
  "container:system:status") exit "$CONTAINER_STATUS" ;;
  "container:system:start") exit "$CONTAINER_START_STATUS" ;;
  "container:builder:status")
    printf '%s' "$BUILDER_JSON"
    exit "$BUILDER_STATUS"
    ;;
  "container:builder:stop") exit "$BUILDER_STOP_STATUS" ;;
  "container:builder:delete") exit "$BUILDER_DELETE_STATUS" ;;
  "container:builder:start") exit "$BUILDER_START_STATUS" ;;
  "podman:info:"*)
    if [ -e "$PODMAN_STARTED_MARKER" ]; then
      exit "$PODMAN_INFO_STATUS_AFTER_START"
    fi
    exit "$PODMAN_INFO_STATUS"
    ;;
  "podman:machine:start")
    : > "$PODMAN_STARTED_MARKER"
    exit "$PODMAN_MACHINE_START_STATUS"
    ;;
  "docker:info:"*) exit "$DOCKER_INFO_STATUS" ;;
  container:build:*|podman:build:*|docker:build:*) exit "$BUILD_STATUS" ;;
  "container:registry:login"|podman:login:*|docker:login:*)
    login_stdin=
    IFS= read -r login_stdin || :
    printf '%s' "$login_stdin" >> "$RUNTIME_STDIN_LOG"
    exit "$LOGIN_STATUS"
    ;;
  "container:image:push"|podman:push:*|docker:push:*) exit "$PUSH_STATUS" ;;
esac
exit 0
`
      );
      await chmod(
        runtimePath,
        nonExecutableRuntimeSet.has(runtime) ? 0o644 : 0o755
      );
    }

    const env = {
      HELPER_PATH: helperPath,
      PATH: binDir,
      RUNTIME_LOG: logPath,
      RUNTIME_ARGUMENT_LOG: argumentLogPath,
      RUNTIME_STDIN_LOG: stdinLogPath,
      CONTAINER_STATUS: String(containerStatus),
      PODMAN_INFO_STATUS: String(podmanInfoStatus),
      PODMAN_INFO_STATUS_AFTER_START: String(podmanInfoStatusAfterStart),
      PODMAN_MACHINE_START_STATUS: String(podmanMachineStartStatus),
      PODMAN_STARTED_MARKER: path.join(tempRoot, "podman-started"),
      DOCKER_INFO_STATUS: String(dockerInfoStatus),
      CONTAINER_START_STATUS: String(containerStartStatus),
      BUILDER_STATUS: String(builderStatus),
      BUILDER_JSON: builderJson,
      BUILDER_STOP_STATUS: String(builderStopStatus),
      BUILDER_DELETE_STATUS: String(builderDeleteStatus),
      BUILDER_START_STATUS: String(builderStartStatus),
      NODE_OPTIONS: deferNodeStdout ? `--require=${nodePreludePath}` : "",
      BUILD_STATUS: String(buildStatus),
      LOGIN_STATUS: String(loginStatus),
      PUSH_STATUS: String(pushStatus),
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
    const stdinLog = await readFile(stdinLogPath, "utf8").catch(() => "");

    return { result, log, argumentLog, stdinLog };
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

test("automatic selection skips non-executable runtimes", async () => {
  const { result } = await runHelper({
    runtimes: ["container", "podman"],
    nonExecutableRuntimes: ["container"],
    body: 'select_container_cli && printf "%s" "$CONTAINER_CLI"',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "podman");
});

test("explicit non-executable runtime override fails clearly", async () => {
  const { result } = await runHelper({
    runtimes: ["container"],
    nonExecutableRuntimes: ["container"],
    override: "container",
    body: "select_container_cli",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /container.*(?:executable|PATH)/i);
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

test("Podman readiness does not start an already-ready machine", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(log, "podman info\n");
  assert.doesNotMatch(log, /system start|machine start/);
});

test("unavailable Podman starts its default machine and retries readiness", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    podmanInfoStatus: 1,
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Starting.*Podman/i);
  assert.equal(log, "podman info\npodman machine start\npodman info\n");
});

test("Podman readiness preserves machine start failure status", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    podmanInfoStatus: 1,
    podmanMachineStartStatus: 47,
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.equal(result.status, 47);
  assert.match(result.stderr, /Podman machine.*failed to start/i);
  assert.equal(log, "podman info\npodman machine start\n");
});

test("Podman readiness fails when machine starts without becoming ready", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    podmanInfoStatus: 1,
    podmanInfoStatusAfterStart: 48,
    body: "select_container_cli && ensure_container_cli_ready",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /started.*unavailable/i);
  assert.equal(log, "podman info\npodman machine start\npodman info\n");
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

test("Apple build readiness creates an 8 GiB builder when missing", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderStatus: 17,
    body: "select_container_cli && ensure_container_cli_build_ready && printf ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "🧠 Configuring Apple Container builder with 8 GiB of memory...\nready"
  );
  assert.equal(
    log,
    "container system status\n" +
      "container builder status --format json\n" +
      "container builder start --memory 8g\n"
  );
});

test("Apple build readiness treats an empty builder list as missing", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderJson: "[]",
    deferNodeStdout: true,
    body: "select_container_cli && ensure_container_cli_build_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "container system status\n" +
      "container builder status --format json\n" +
      "container builder start --memory 8g\n"
  );
  assert.doesNotMatch(
    log,
    /container builder (?:stop|delete)\n|container builder start\n/
  );
});

test("Apple build readiness rejects nonnumeric builder memory without mutation", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderJson: JSON.stringify([
      {
        configuration: { resources: { memoryInBytes: "plenty" } },
        status: { state: "running" },
      },
    ]),
    body: "select_container_cli && ensure_container_cli_build_ready",
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /(?=.*Apple Container builder status)(?=.*(?:parse|invalid))/is
  );
  assert.equal(
    log,
    "container system status\ncontainer builder status --format json\n"
  );
  assert.doesNotMatch(log, /container builder (?:stop|delete|start)/);
});

test("Apple build readiness rejects invalid builder JSON without mutation", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderJson: "{not-json",
    body: "select_container_cli && ensure_container_cli_build_ready",
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /(?=.*Apple Container builder status)(?=.*(?:parse|invalid))/is
  );
  assert.equal(
    log,
    "container system status\ncontainer builder status --format json\n"
  );
  assert.doesNotMatch(log, /container builder (?:stop|delete|start)/);
});

test("Apple build readiness replaces an undersized running builder", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderJson: JSON.stringify([
      {
        configuration: { resources: { memoryInBytes: 2147483648 } },
        status: { state: "running" },
      },
    ]),
    body: "select_container_cli && ensure_container_cli_build_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "container system status\n" +
      "container builder status --format json\n" +
      "container builder stop\n" +
      "container builder delete\n" +
      "container builder start --memory 8g\n"
  );
});

test("Apple build readiness replaces an undersized stopped builder without stopping it", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderJson: JSON.stringify([
      {
        configuration: { resources: { memoryInBytes: 2147483648 } },
        status: { state: "stopped" },
      },
    ]),
    body: "select_container_cli && ensure_container_cli_build_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "container system status\n" +
      "container builder status --format json\n" +
      "container builder delete\n" +
      "container builder start --memory 8g\n"
  );
  assert.doesNotMatch(log, /container builder stop/);
});

test("Apple build readiness leaves a sufficient running builder unchanged", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    body: "select_container_cli && ensure_container_cli_build_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "container system status\ncontainer builder status --format json\n"
  );
});

test("Apple build readiness starts a sufficient stopped builder without changing memory", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderJson: JSON.stringify([
      {
        configuration: { resources: { memoryInBytes: 8589934592 } },
        status: { state: "stopped" },
      },
    ]),
    body: "select_container_cli && ensure_container_cli_build_ready",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    log,
    "container system status\n" +
      "container builder status --format json\n" +
      "container builder start\n"
  );
});

for (const { runtime, readinessLog } of [
  { runtime: "podman", readinessLog: "podman info\n" },
  { runtime: "docker", readinessLog: "docker info\n" },
]) {
  test(`${runtime} build readiness uses normal readiness without Apple builder commands`, async () => {
    const { result, log } = await runHelper({
      runtimes: [runtime],
      body: "select_container_cli && ensure_container_cli_build_ready",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(log, readinessLog);
    assert.doesNotMatch(log, /container builder/);
  });
}

test("Apple build readiness propagates its normal readiness failure", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    containerStatus: 1,
    containerStartStatus: 37,
    body: "select_container_cli && ensure_container_cli_build_ready && printf unexpected",
  });

  assert.equal(result.status, 37, result.stderr);
  assert.equal(
    log,
    "container system status\ncontainer system start --disable-kernel-install\n"
  );
  assert.doesNotMatch(log, /container builder/);
});

for (const { operation, statusOption, status } of [
  { operation: "stop", statusOption: "builderStopStatus", status: 61 },
  { operation: "delete", statusOption: "builderDeleteStatus", status: 62 },
]) {
  test(`Apple build readiness propagates exact builder ${operation} failure`, async () => {
    const { result, log } = await runHelper({
      runtimes: ["container"],
      builderJson: JSON.stringify([
        {
          configuration: { resources: { memoryInBytes: 2147483648 } },
          status: { state: "running" },
        },
      ]),
      [statusOption]: status,
      body: "select_container_cli && ensure_container_cli_build_ready && printf unexpected",
    });

    assert.equal(result.status, status, result.stderr);
    assert.match(log, new RegExp(`container builder ${operation}\\n`));
    assert.doesNotMatch(log, /container builder start/);
  });
}

test("Apple build readiness propagates exact builder start failure", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    builderStatus: 19,
    builderStartStatus: 63,
    body: "select_container_cli && ensure_container_cli_build_ready && printf unexpected",
  });

  assert.equal(result.status, 63, result.stderr);
  assert.equal(
    log,
    "container system status\n" +
      "container builder status --format json\n" +
      "container builder start --memory 8g\n"
  );
});

for (const override of [overrideUnset, "nerdctl"]) {
  const state = override === overrideUnset ? "unselected" : "invalid";

  test(`build readiness rejects an ${state} runtime`, async () => {
    const { result, log } = await runHelper({
      runtimes: ["container", "podman", "docker"],
      override,
      body: "ensure_container_cli_build_ready",
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
    arguments: [
      [
        "build",
        "--progress",
        "plain",
        "--platform",
        "linux/amd64",
        "-t",
        "app:latest",
        ".",
      ],
      [
        "registry",
        "login",
        "--username",
        "AWS",
        "--password-stdin",
        "registry.example",
      ],
      ["image", "push", "registry.example/app:latest"],
    ],
  },
  {
    runtime: "podman",
    build: "podman build --platform linux/amd64 -t app:latest .",
    login: "podman login --username AWS --password-stdin registry.example",
    push: "podman push registry.example/app:latest",
    arguments: [
      ["build", "--platform", "linux/amd64", "-t", "app:latest", "."],
      ["login", "--username", "AWS", "--password-stdin", "registry.example"],
      ["push", "registry.example/app:latest"],
    ],
  },
  {
    runtime: "docker",
    build:
      "docker build --progress plain --platform linux/amd64 -t app:latest .",
    login: "docker login --username AWS --password-stdin registry.example",
    push: "docker push registry.example/app:latest",
    arguments: [
      [
        "build",
        "--progress",
        "plain",
        "--platform",
        "linux/amd64",
        "-t",
        "app:latest",
        ".",
      ],
      ["login", "--username", "AWS", "--password-stdin", "registry.example"],
      ["push", "registry.example/app:latest"],
    ],
  },
];

const formatArgumentLog = (runtime, invocations) =>
  invocations
    .map(
      (arguments_) =>
        `${runtime}\n${arguments_
          .map((argument) => `<${argument}>\n`)
          .join("")}--\n`
    )
    .join("");

for (const {
  runtime,
  build,
  login,
  push,
  arguments: arguments_,
} of commandMappings) {
  test(`${runtime} receives exact mapped build, login, and push commands`, async () => {
    const { result, log, argumentLog, stdinLog } = await runHelper({
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
    assert.equal(argumentLog, formatArgumentLog(runtime, arguments_));
    assert.equal(stdinLog, "secret");
  });
}

for (const { runtime } of commandMappings) {
  test(`${runtime} build preserves spaced and empty argument boundaries`, async () => {
    const { result, argumentLog } = await runHelper({
      runtimes: [runtime],
      override: runtime,
      body:
        "select_container_cli && " +
        'container_cli_build --progress plain --label "name=two words" "" .',
    });
    const expectedArguments = [
      "build",
      ...(runtime === "podman" ? [] : ["--progress", "plain"]),
      "--label",
      "name=two words",
      "",
      ".",
    ];

    assert.equal(result.status, 0, result.stderr);
    assert.equal(argumentLog, formatArgumentLog(runtime, [expectedArguments]));
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

test("Apple container start returns its exact failure status", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    override: "container",
    containerStatus: 1,
    containerStartStatus: 37,
    body: "select_container_cli && ensure_container_cli_ready && printf unexpected",
  });

  assert.equal(result.status, 37, result.stderr);
  assert.equal(
    result.stdout,
    "Container system is not running. Starting it...\n"
  );
  assert.equal(
    log,
    "container system status\ncontainer system start --disable-kernel-install\n"
  );
});

const failingAdapterCalls = [
  {
    name: "build",
    statusOption: "buildStatus",
    status: 41,
    call: "container_cli_build .",
  },
  {
    name: "login",
    statusOption: "loginStatus",
    status: 42,
    call: "printf secret | container_cli_login registry.example",
  },
  {
    name: "push",
    statusOption: "pushStatus",
    status: 43,
    call: "container_cli_push registry.example/app:latest",
  },
];

for (const { runtime } of commandMappings) {
  for (const { name, statusOption, status, call } of failingAdapterCalls) {
    test(`${runtime} ${name} returns its exact failure status`, async () => {
      const { result } = await runHelper({
        runtimes: [runtime],
        override: runtime,
        [statusOption]: status,
        body: `select_container_cli && ${call} && printf unexpected`,
      });

      assert.equal(result.status, status, result.stderr);
      assert.equal(result.stdout, "");
    });
  }
}

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

test("local build uses shared runtime and gates Apple builder setup", async () => {
  const buildScript = await readFile(path.join(repoRoot, "build.sh"), "utf8");

  assert.match(buildScript, /source .*scripts\/container-runtime\.sh/);
  assert.match(buildScript, /select_container_cli/);
  assert.match(buildScript, /ensure_container_cli_build_ready/);
  assert.doesNotMatch(buildScript, /\bensure_container_cli_ready\b/);
  assert.match(buildScript, /container_cli_build[\s\S]*"\$BUILD_CONTEXT_DIR"/);
  assert.match(buildScript, /container_cli_push "\$IMAGE_NAME"/);
  assert.doesNotMatch(
    buildScript,
    /container builder (?:status|stop|delete|start)/
  );
  assert.doesNotMatch(buildScript, /MIN_CONTAINER_BUILDER_MEMORY_BYTES/);
  assert.doesNotMatch(buildScript, /\baz\b/);

  const selectRuntime = buildScript.indexOf("select_container_cli");
  const buildImage = buildScript.indexOf("container_cli_build");
  assert.ok(
    selectRuntime >= 0 && selectRuntime < buildImage,
    "runtime selection must happen before the image build"
  );
});

test("AWS build sends its progress option through tested runtime adapter", async () => {
  const buildScript = await readFile(
    path.join(repoRoot, "build-aws.sh"),
    "utf8"
  );

  assert.match(buildScript, /source .*scripts\/container-runtime\.sh/);
  assert.match(buildScript, /select_container_cli/);
  assert.match(buildScript, /ensure_container_cli_ready/);
  assert.match(buildScript, /container_cli_build --progress plain/);
  assert.match(
    buildScript,
    /container_cli_login --username AWS --password-stdin/
  );
  assert.match(buildScript, /container_cli_push "\$IMAGE_TAG"/);

  const selectRuntime = buildScript.indexOf("select_container_cli");
  const createRepository = buildScript.indexOf("aws ecr create-repository");
  assert.ok(
    selectRuntime >= 0 && selectRuntime < createRepository,
    "runtime selection must happen before ECR repository creation"
  );
});

test("AWS build propagates ECR password failures before push", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aws-build-test-"));

  try {
    const scriptsDir = path.join(tempRoot, "scripts");
    const binDir = path.join(tempRoot, "bin");
    const dockerLogPath = path.join(tempRoot, "docker.log");
    await mkdir(scriptsDir);
    await mkdir(binDir);

    const [buildScript, runtimeHelper] = await Promise.all([
      readFile(path.join(repoRoot, "build-aws.sh"), "utf8"),
      readFile(helperPath, "utf8"),
    ]);
    await writeFile(path.join(tempRoot, "build-aws.sh"), buildScript);
    await writeFile(
      path.join(scriptsDir, "container-runtime.sh"),
      runtimeHelper
    );
    await writeFile(
      path.join(tempRoot, "env-aws.sh"),
      'export AWS_REGION="ca-central-1"\nexport ECR_REPO_NAME="test-repo"\n'
    );

    const executables = {
      aws: `#!/bin/sh
case "$1:$2" in
  "sts:get-caller-identity") printf '%s\\n' '123456789012'; exit 0 ;;
  "ecr:describe-repositories") exit 0 ;;
  "ecr:get-login-password") exit 47 ;;
esac
exit 99
`,
      docker: `#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [ "$1" = "login" ]; then
  IFS= read -r login_stdin || :
fi
exit 0
`,
      date: `#!/bin/sh
exec /bin/date "$@"
`,
      dirname: `#!/bin/sh
exec /usr/bin/dirname "$@"
`,
    };

    for (const [name, contents] of Object.entries(executables)) {
      const executablePath = path.join(binDir, name);
      await writeFile(executablePath, contents);
      await chmod(executablePath, 0o755);
    }

    const result = spawnSync("/bin/bash", ["./build-aws.sh"], {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        PATH: binDir,
        CONTAINER_CLI: "docker",
        DOCKER_LOG: dockerLogPath,
      },
    });
    const dockerLog = await readFile(dockerLogPath, "utf8");

    assert.deepEqual(
      {
        status: result.status,
        pushReached: /^push /m.test(dockerLog),
      },
      { status: 47, pushReached: false },
      result.stderr
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
