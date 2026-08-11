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
  containerStartStatus = 0,
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
case "\${0##*/}:$1:$2" in
  "container:system:status") exit "$CONTAINER_STATUS" ;;
  "container:system:start") exit "$CONTAINER_START_STATUS" ;;
  "podman:info:"*) exit "$PODMAN_INFO_STATUS" ;;
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
      await chmod(runtimePath, 0o755);
    }

    const env = {
      HELPER_PATH: helperPath,
      PATH: binDir,
      RUNTIME_LOG: logPath,
      RUNTIME_ARGUMENT_LOG: argumentLogPath,
      RUNTIME_STDIN_LOG: stdinLogPath,
      CONTAINER_STATUS: String(containerStatus),
      PODMAN_INFO_STATUS: String(podmanInfoStatus),
      DOCKER_INFO_STATUS: String(dockerInfoStatus),
      CONTAINER_START_STATUS: String(containerStartStatus),
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
  assert.match(buildScript, /ensure_container_cli_ready/);
  assert.match(buildScript, /container_cli_build[\s\S]*"\$BUILD_CONTEXT_DIR"/);
  assert.match(buildScript, /container_cli_push "\$FULL_IMAGE_NAME"/);

  const selectRuntime = buildScript.indexOf("select_container_cli");
  const resourceGroupMutation = buildScript.indexOf("az group show");
  assert.ok(
    selectRuntime >= 0 && selectRuntime < resourceGroupMutation,
    "runtime selection must happen before Azure resource-group mutation"
  );

  const guard = buildScript.indexOf(
    'if [ "$CONTAINER_CLI" = "container" ]; then'
  );
  const builderStatus = buildScript.indexOf(
    "command container builder status --format json"
  );
  const guardEnd = buildScript.indexOf("\nfi", guard);
  assert.ok(guard >= 0 && builderStatus > guard && builderStatus < guardEnd);
});
