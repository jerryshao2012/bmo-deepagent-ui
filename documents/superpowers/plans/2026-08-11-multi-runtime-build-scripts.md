# Multi-Runtime Build Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `../../../build.sh` and `../../../build-aws.sh` automatically use Apple `container`, daemonless Podman, or Docker in that priority order, with an explicit runtime override.

**Architecture:** Add one sourced Bash adapter that owns runtime selection, readiness checks, and command-shape differences. Keep provider-specific image arguments and Apple builder-memory policy in existing build scripts. Verify adapter behavior through real Bash execution against temporary fake CLI executables, then retain existing static deployment checks for script integration.

**Tech Stack:** Bash 3.2-compatible shell, Node.js test runner, Apple `container`, Podman, Docker CLI, AWS CLI, Prettier, ESLint, Next.js

---

## File map

- Create `../../../scripts/container-runtime.sh`: runtime selection and common build/login/push/readiness interface.
- Create `../../../tests/container-runtime.test.mjs`: behavioral tests that source helper in Bash and integration checks for both build scripts.
- Modify `../../../build.sh`: use adapter while retaining clean context and Apple-only 8 GiB builder setup.
- Modify `../../../build-aws.sh`: use adapter and omit unsupported `--progress plain` only for Podman.
- Modify `../../../tests/deployment-security.test.mjs`: update existing clean-context assertion to runtime-neutral build wrapper.
- Modify `../../deployment/aws-ecs-fargate.md`: document runtime priority, overrides, readiness, and troubleshooting.

### Task 1: Runtime selection

**Files:**

- Create: `../../../tests/container-runtime.test.mjs`
- Create: `../../../scripts/container-runtime.sh`

- [ ] **Step 1: Write failing runtime-selection tests**

Create test harness that puts only requested fake executables on `PATH`, sources real
helper, and executes its functions through `/bin/bash`:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const helperPath = path.join(repoRoot, "scripts/container-runtime.sh");
const overrideUnset = Symbol("override-unset");

async function runHelper({
  runtimes,
  override = overrideUnset,
  body,
  extraEnv = {},
}) {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "container-runtime-test-")
  );
  const binDir = path.join(tempRoot, "bin");
  const logPath = path.join(tempRoot, "runtime.log");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(binDir));

  const fakeRuntime = `#!/bin/sh
printf '%s %s\\n' "\${0##*/}" "$*" >> "$RUNTIME_LOG"
case "\${0##*/}:$*" in
  "container:system status") exit "\${CONTAINER_STATUS:-0}" ;;
  "podman:info") exit "\${PODMAN_INFO_STATUS:-0}" ;;
  "docker:info") exit "\${DOCKER_INFO_STATUS:-0}" ;;
esac
exit 0
`;

  for (const runtime of runtimes) {
    const runtimePath = path.join(binDir, runtime);
    await writeFile(runtimePath, fakeRuntime);
    await chmod(runtimePath, 0o755);
  }

  const env = {
    ...process.env,
    ...extraEnv,
    PATH: binDir,
    RUNTIME_LOG: logPath,
  };
  if (override === overrideUnset) delete env.CONTAINER_CLI;
  else env.CONTAINER_CLI = override;

  const result = spawnSync(
    "/bin/bash",
    ["-c", `source ${JSON.stringify(helperPath)}; ${body}`],
    { cwd: repoRoot, encoding: "utf8", env }
  );
  const log = await readFile(logPath, "utf8").catch(() => "");
  await rm(tempRoot, { recursive: true, force: true });
  return { result, log };
}

test("automatic selection prefers Apple container", async () => {
  const { result } = await runHelper({
    runtimes: ["container", "podman", "docker"],
    body: 'select_container_cli; printf "%s" "$CONTAINER_CLI"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "container");
});

test("automatic selection prefers Podman over Docker", async () => {
  const { result } = await runHelper({
    runtimes: ["podman", "docker"],
    body: 'select_container_cli; printf "%s" "$CONTAINER_CLI"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "podman");
});

test("automatic selection uses Docker when it is the only runtime", async () => {
  const { result } = await runHelper({
    runtimes: ["docker"],
    body: 'select_container_cli; printf "%s" "$CONTAINER_CLI"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "docker");
});

test("explicit runtime override wins over automatic priority", async () => {
  const { result } = await runHelper({
    runtimes: ["container", "podman", "docker"],
    override: "docker",
    body: 'select_container_cli; printf "%s" "$CONTAINER_CLI"',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "docker");
});

for (const override of ["", "nerdctl"]) {
  test(`explicit override ${JSON.stringify(
    override
  )} fails clearly`, async () => {
    const { result } = await runHelper({
      runtimes: ["container", "podman", "docker"],
      override,
      body: "select_container_cli",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CONTAINER_CLI.*container.*podman.*docker/i);
  });
}

test("missing explicit runtime fails clearly", async () => {
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
```

- [ ] **Step 2: Run selection tests and verify RED**

Run:

```bash
node --test tests/container-runtime.test.mjs
```

Expected: tests fail because `../../../scripts/container-runtime.sh` does not exist and
`select_container_cli` is unavailable.

- [ ] **Step 3: Implement minimal Bash 3.2-compatible selection**

Create helper without `[[ -v ... ]]`, which macOS Bash 3.2 does not support:

```bash
#!/bin/bash

select_container_cli() {
  if [ "${CONTAINER_CLI+x}" = "x" ]; then
    case "$CONTAINER_CLI" in
      container|podman|docker) ;;
      *)
        echo "Error: CONTAINER_CLI must be one of: container, podman, docker." >&2
        return 1
        ;;
    esac

    if ! command -v "$CONTAINER_CLI" >/dev/null 2>&1; then
      echo "Error: requested container runtime '$CONTAINER_CLI' is not on PATH." >&2
      return 1
    fi
    return 0
  fi

  for candidate in container podman docker; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CONTAINER_CLI="$candidate"
      return 0
    fi
  done

  echo "Error: no supported container runtime found; install container, podman, or docker, or set CONTAINER_CLI." >&2
  return 1
}
```

- [ ] **Step 4: Run selection tests and verify GREEN**

Run: `node --test tests/container-runtime.test.mjs`

Expected: all selection tests pass.

- [ ] **Step 5: Commit selection behavior**

```bash
git add scripts/container-runtime.sh tests/container-runtime.test.mjs
git commit -m "feat: select available container runtime"
```

### Task 2: Readiness and command adapters

**Files:**

- Modify: `../../../tests/container-runtime.test.mjs`
- Modify: `../../../scripts/container-runtime.sh`

- [ ] **Step 1: Append failing readiness tests**

Add tests proving Apple auto-start behavior, daemonless Podman behavior, and Docker
daemon validation:

```js
test("Apple container starts its system when stopped", async () => {
  const { result, log } = await runHelper({
    runtimes: ["container"],
    extraEnv: { CONTAINER_STATUS: "1" },
    body: "select_container_cli; ensure_container_cli_ready",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /^container system status$/m);
  assert.match(log, /^container system start --disable-kernel-install$/m);
});

test("Podman readiness is daemonless", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    body: "select_container_cli; ensure_container_cli_ready",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(log, "podman info\n");
  assert.doesNotMatch(log, /system start|machine start/);
});

test("unavailable Podman fails without starting anything", async () => {
  const { result, log } = await runHelper({
    runtimes: ["podman"],
    extraEnv: { PODMAN_INFO_STATUS: "1" },
    body: "select_container_cli; ensure_container_cli_ready",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Podman.*unavailable/i);
  assert.equal(log, "podman info\n");
});

test("Docker readiness requires a running daemon", async () => {
  const { result, log } = await runHelper({
    runtimes: ["docker"],
    extraEnv: { DOCKER_INFO_STATUS: "1" },
    body: "select_container_cli; ensure_container_cli_ready",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker daemon/i);
  assert.equal(log, "docker info\n");
});
```

- [ ] **Step 2: Append failing command-mapping tests**

```js
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
  test(`${runtime} receives mapped build, login, and push commands`, async () => {
    const { result, log } = await runHelper({
      runtimes: [runtime],
      override: runtime,
      body:
        "select_container_cli; " +
        "container_cli_build --progress plain --platform linux/amd64 -t app:latest .; " +
        "printf secret | container_cli_login --username AWS --password-stdin registry.example; " +
        "container_cli_push registry.example/app:latest",
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = log.trimEnd().split("\n");
    assert.ok(commands.includes(build));
    assert.ok(commands.includes(login));
    assert.ok(commands.includes(push));
  });
}
```

- [ ] **Step 3: Run adapter tests and verify RED**

Run: `node --test tests/container-runtime.test.mjs`

Expected: new tests fail because readiness/build/login/push functions are undefined.

- [ ] **Step 4: Implement minimal adapters**

Append to `../../../scripts/container-runtime.sh`:

```bash
ensure_container_cli_ready() {
  case "$CONTAINER_CLI" in
    container)
      if ! container system status >/dev/null 2>&1; then
        echo "Container system is not running. Starting it..."
        container system start --disable-kernel-install
      fi
      ;;
    podman)
      if ! podman info >/dev/null 2>&1; then
        echo "Error: Podman is installed but unavailable; this script will not start a Podman service or machine." >&2
        return 1
      fi
      ;;
    docker)
      if ! docker info >/dev/null 2>&1; then
        echo "Error: Docker daemon is unavailable; start it and retry." >&2
        return 1
      fi
      ;;
    *)
      echo "Error: select_container_cli must run before readiness checks." >&2
      return 1
      ;;
  esac
}

container_cli_build() {
  if [ "$CONTAINER_CLI" != "podman" ]; then
    "$CONTAINER_CLI" build "$@"
    return
  fi

  local podman_args=()
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "--progress" ] && [ "${2-}" = "plain" ]; then
      shift 2
    else
      podman_args[${#podman_args[@]}]="$1"
      shift
    fi
  done
  podman build "${podman_args[@]}"
}

container_cli_login() {
  case "$CONTAINER_CLI" in
    container) container registry login "$@" ;;
    podman|docker) "$CONTAINER_CLI" login "$@" ;;
    *) return 1 ;;
  esac
}

container_cli_push() {
  case "$CONTAINER_CLI" in
    container) container image push "$@" ;;
    podman|docker) "$CONTAINER_CLI" push "$@" ;;
    *) return 1 ;;
  esac
}
```

- [ ] **Step 5: Run adapter tests and verify GREEN**

Run: `node --test tests/container-runtime.test.mjs`

Expected: all selection, readiness, and mapping tests pass with no warnings.

- [ ] **Step 6: Commit adapter behavior**

```bash
git add scripts/container-runtime.sh tests/container-runtime.test.mjs
git commit -m "feat: adapt container runtime commands"
```

### Task 3: Integrate local Docker Hub build

**Files:**

- Modify: `../../../tests/container-runtime.test.mjs`
- Modify: `tests/deployment-security.test.mjs:95-118`
- Modify: `build.sh:1-92`

- [ ] **Step 1: Write failing integration assertions**

Append a test that reads `../../../build.sh` and verifies shared adapter use plus Apple-only
builder configuration:

```js
test("local build uses shared runtime and gates Apple builder setup", async () => {
  const buildScript = await readFile(path.join(repoRoot, "build.sh"), "utf8");
  assert.match(buildScript, /source .*scripts\/container-runtime\.sh/);
  assert.match(buildScript, /select_container_cli/);
  assert.match(buildScript, /ensure_container_cli_ready/);
  assert.match(buildScript, /container_cli_build[\s\S]*"\$BUILD_CONTEXT_DIR"/);
  assert.match(buildScript, /container_cli_push "\$FULL_IMAGE_NAME"/);

  const guard = buildScript.indexOf(
    'if [ "$CONTAINER_CLI" = "container" ]; then'
  );
  const builderStatus = buildScript.indexOf(
    "container builder status --format json"
  );
  const guardEnd = buildScript.indexOf("\nfi", guard);
  assert.ok(guard >= 0 && builderStatus > guard && builderStatus < guardEnd);
});
```

Update existing clean-context assertion from literal `container build` to
`container_cli_build` so it continues checking staged context rather than one runtime.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test tests/container-runtime.test.mjs
node --test --test-name-pattern='^local container build' tests/deployment-security.test.mjs
```

Expected: integration test fails because `../../../build.sh` does not source or call adapter;
updated security test fails because script still calls literal `container build`.

- [ ] **Step 3: Integrate adapter in `../../../build.sh`**

After `source ./env.sh`, source helper, select runtime, and report it:

```bash
source ./scripts/container-runtime.sh
select_container_cli
echo "📦 Using container runtime: $CONTAINER_CLI"
```

Replace Apple service startup block with:

```bash
ensure_container_cli_ready
```

Wrap existing builder status/memory block in:

```bash
if [ "$CONTAINER_CLI" = "container" ]; then
  # existing MIN_CONTAINER_BUILDER_MEMORY_BYTES through builder start logic
fi
```

Replace literal build and push calls only:

```bash
if ! container_cli_build \
    --platform linux/amd64 \
    --build-arg NEXT_PUBLIC_LANGGRAPH_URL="$NEXT_PUBLIC_LANGGRAPH_URL" \
    --build-arg NEXT_PUBLIC_ASSISTANT_ID="${NEXT_PUBLIC_ASSISTANT_ID:-research}" \
    -t "$FULL_IMAGE_NAME" \
    "$BUILD_CONTEXT_DIR"; then
```

```bash
if ! container_cli_push "$FULL_IMAGE_NAME"; then
```

- [ ] **Step 4: Verify local build integration GREEN**

Run:

```bash
bash -n build.sh scripts/container-runtime.sh
node --test tests/container-runtime.test.mjs
node --test --test-name-pattern='^local container build' tests/deployment-security.test.mjs
```

Expected: Bash syntax and focused tests pass.

- [ ] **Step 5: Commit local build integration**

```bash
git add build.sh scripts/container-runtime.sh tests/container-runtime.test.mjs tests/deployment-security.test.mjs
git commit -m "feat: support multiple runtimes in local image build"
```

### Task 4: Integrate AWS ECR build

**Files:**

- Modify: `../../../tests/container-runtime.test.mjs`
- Modify: `build-aws.sh:1-88`

- [ ] **Step 1: Write failing AWS integration test**

```js
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
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/container-runtime.test.mjs`

Expected: AWS integration test fails because script still calls Apple `container`
directly.

- [ ] **Step 3: Integrate adapter in `../../../build-aws.sh`**

After environment loading, source helper, select runtime, and report it:

```bash
source ./scripts/container-runtime.sh
select_container_cli
echo "📦 Using container runtime: $CONTAINER_CLI"
```

Replace Apple service block with `ensure_container_cli_ready`. Pass existing progress
option through tested adapter, which retains it for Apple/Docker and removes it for
Podman:

```bash
container_cli_build --progress plain --platform linux/amd64 -f Dockerfile-aws -t "$IMAGE_TAG" .
```

Map ECR login and push through helper:

```bash
aws ecr get-login-password --region "$AWS_REGION" | container_cli_login --username AWS --password-stdin "$ECR_URL"
container_cli_push "$IMAGE_TAG"
```

- [ ] **Step 4: Verify AWS integration GREEN**

Run:

```bash
bash -n build-aws.sh scripts/container-runtime.sh
node --test tests/container-runtime.test.mjs
```

Expected: syntax and all runtime tests pass.

- [ ] **Step 5: Commit AWS integration**

```bash
git add build-aws.sh tests/container-runtime.test.mjs
git commit -m "feat: support multiple runtimes in AWS image build"
```

### Task 5: Document supported runtimes

**Files:**

- Modify: `documents/deployment/aws-ecs-fargate.md:16-52`
- Modify: `documents/deployment/aws-ecs-fargate.md:120-137`
- Modify: `documents/deployment/aws-ecs-fargate.md:229-239`

- [ ] **Step 1: Update architecture and prerequisites**

Replace Apple-only build host wording with:

```text
local build host
  └─ build-aws.sh (Apple container → Podman → Docker) ──> Amazon ECR :latest
```

Document supported runtime requirements:

- automatic priority is Apple `container`, Podman, then Docker;
- `CONTAINER_CLI=container|podman|docker` forces deterministic selection;
- Apple path starts its container system and retains 8 GiB local builder policy where
  used by `../../../build.sh`;
- Podman path runs `podman info` and does not start/manage daemon or machine;
- Docker path requires a running daemon and never starts Docker automatically.

- [ ] **Step 2: Update build flow and troubleshooting**

Change build-flow steps to selected-runtime terminology. Add examples:

```bash
./build-aws.sh
CONTAINER_CLI=podman ./build-aws.sh
CONTAINER_CLI=docker ./build-aws.sh
```

Explain `--progress plain` is retained for Apple/Docker and omitted for Podman. Update
`latest missing` troubleshooting to check selected runtime, its auth store, and
readiness instead of Apple `container` only.

- [ ] **Step 3: Format and verify documentation**

Run:

```bash
yarn prettier --write documents/deployment/aws-ecs-fargate.md
yarn prettier --check documents/deployment/aws-ecs-fargate.md
rg -n 'container.*Podman.*Docker|CONTAINER_CLI|podman info|Docker daemon' documents/deployment/aws-ecs-fargate.md
```

Expected: Prettier passes; matches cover priority, override, and readiness behavior.

- [ ] **Step 4: Commit documentation**

```bash
git add documents/deployment/aws-ecs-fargate.md
git commit -m "docs: describe image build runtime selection"
```

### Task 6: Full verification

**Files:**

- Verify: `../../../scripts/container-runtime.sh`
- Verify: `../../../build.sh`
- Verify: `../../../build-aws.sh`
- Verify: `../../../tests/container-runtime.test.mjs`
- Verify: `../../../tests/deployment-security.test.mjs`
- Verify: `../../deployment/aws-ecs-fargate.md`

- [ ] **Step 1: Run Bash and focused runtime verification**

```bash
bash -n scripts/container-runtime.sh build.sh build-aws.sh
node --test tests/container-runtime.test.mjs
node --test --test-name-pattern='^local container build' tests/deployment-security.test.mjs
```

Expected: syntax checks pass; all runtime and local-build tests pass.

- [ ] **Step 2: Run complete deployment security tests**

```bash
node --test tests/deployment-security.test.mjs
```

Expected: all deployment-security tests pass.

- [ ] **Step 3: Run repository verification**

```bash
yarn prettier --check scripts/container-runtime.sh build.sh build-aws.sh tests/container-runtime.test.mjs tests/deployment-security.test.mjs documents/deployment/aws-ecs-fargate.md
yarn lint
yarn build
git diff --check
```

Expected: formatting, lint, production build, and whitespace checks exit zero.

- [ ] **Step 4: Inspect optimizer evidence and final scope**

```bash
threadroot score latest --json
git status --short
git log --oneline -6
```

Expected: Threadroot score is recorded or exact missing-score reason is reported;
worktree contains only intended plan state, and commits match five planned
implementation commits.
