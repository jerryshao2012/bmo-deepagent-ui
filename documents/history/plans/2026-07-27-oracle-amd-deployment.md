# Oracle AMD VM Deployment Implementation Plan

> Historical record: this plan preserves repository state and deployment decisions
> from July 27, 2026. See [current documentation index](../../README.md) for active
> guidance.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tested `deploy-oracle.sh` that deploys existing AMD64 Docker Hub image to already-provisioned Oracle AMD micro VM.

**Architecture:** Local Bash script validates configuration, securely copies runtime environment through SSH, and executes idempotent Docker replacement flow remotely. Existing `build.sh` remains AMD64 image producer; deployment persists application data in VM home directory and performs bounded public health verification.

**Tech Stack:** Bash, SSH/SCP, Docker, Node.js built-in test runner

---

## File Structure

- Create `deploy-oracle.sh`: local validation, SSH transport, remote Docker
  replacement, and health verification.
- Create `tests/deploy-oracle.test.mjs`: black-box tests using temporary fake
  `ssh`, `scp`, `curl`, and `sleep` commands.
- Preserve `build.sh`: existing `linux/amd64` build already matches Oracle AMD
  micro VM.

### Task 1: Add black-box deployment contract

**Files:**

- Create: `tests/deploy-oracle.test.mjs`
- Test: `tests/deploy-oracle.test.mjs`

- [ ] **Step 1: Write test harness and failing help/config tests**

Create temporary executable stubs and run script with isolated configuration:

```javascript
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = path.join(repoRoot, "deploy-oracle.sh");

const run = (args = [], env = {}) =>
  spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      ...env,
    },
  });

test("--help documents required Oracle configuration", () => {
  const result = run(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: \.\/deploy-oracle\.sh/);
  assert.match(result.stdout, /ORACLE_HOST/);
  assert.match(result.stdout, /ORACLE_SSH_KEY/);
  assert.match(result.stdout, /DOCKER_HUB_USERNAME/);
});

test("missing Oracle configuration fails before any remote action", () => {
  const result = run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /ORACLE_HOST is required/);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
node --test tests/deploy-oracle.test.mjs
```

Expected: FAIL because `deploy-oracle.sh` does not exist.

- [ ] **Step 3: Add failing successful-deployment test**

Append helpers and test:

```javascript
const writeExecutable = async (filePath, contents) => {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
};

const withFakeCommands = async (curlStatus, callback) => {
  const directory = await mkdtemp(path.join(tmpdir(), "deploy-oracle-test-"));
  const logPath = path.join(directory, "commands.log");
  const keyPath = path.join(directory, "oracle.key");
  const envPath = path.join(directory, ".env.docker");

  await writeFile(keyPath, "test-key");
  await writeFile(envPath, "UPLOAD_API_KEY=test-secret\n");
  await writeExecutable(
    path.join(directory, "ssh"),
    `#!/bin/bash
{
  printf 'ssh'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
for remote_command in "$@"; do :; done
HOME="$FAKE_REMOTE_HOME" bash -c "$remote_command"
`
  );
  await writeExecutable(
    path.join(directory, "scp"),
    `#!/bin/bash
{
  printf 'scp'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
`
  );
  await writeExecutable(
    path.join(directory, "curl"),
    `#!/bin/bash
{
  printf 'curl'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
printf '${curlStatus}'
`
  );
  await writeExecutable(
    path.join(directory, "docker"),
    `#!/bin/bash
{
  printf 'docker'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
case "$1 $2" in
  "info ") exit 0 ;;
  "container inspect") exit 1 ;;
  "run -d") printf 'test-container-id\\n' ;;
esac
exit 0
`
  );
  for (const command of ["chmod", "mkdir"]) {
    await writeExecutable(
      path.join(directory, command),
      `#!/bin/bash
{
  printf '${command}'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
exit 0
`
    );
  }
  await writeExecutable(path.join(directory, "sleep"), "#!/bin/bash\nexit 0\n");

  try {
    await callback({
      commandPath: `${directory}:${process.env.PATH}`,
      envPath,
      keyPath,
      logPath,
      remoteHome: directory,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("deploys existing AMD64 image with secure runtime and persistent data", async () => {
  await withFakeCommands(
    "200",
    async ({ commandPath, envPath, keyPath, logPath, remoteHome }) => {
      const result = run([], {
        PATH: commandPath,
        FAKE_COMMAND_LOG: logPath,
        FAKE_REMOTE_HOME: remoteHome,
        ORACLE_HOST: "203.0.113.10",
        ORACLE_SSH_KEY: keyPath,
        ORACLE_ENV_FILE: envPath,
        DOCKER_HUB_USERNAME: "example",
        ORACLE_PUBLIC_URL: "https://ui.example.test/app?x=one&y=two",
      });
      const log = await readFile(logPath, "utf8");

      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(log, /docker\.io\/example\/deepagent-ui:latest/);
      assert.match(log, /chmod <0700>/);
      assert.match(log, /chmod <0600>/);
      assert.match(
        log,
        /docker <pull> <docker\.io\/example\/deepagent-ui:latest>/
      );
      assert.match(log, /<--restart> <unless-stopped>/);
      assert.match(log, /<-p> <80:3000>/);
      assert.match(
        log,
        /<AUTH_URL=https:\/\/ui\.example\.test\/app\?x=one&y=two>/
      );
      assert.match(
        log,
        /<NEXTAUTH_URL=https:\/\/ui\.example\.test\/app\?x=one&y=two>/
      );
      assert.match(log, /<AUTH_TRUST_HOST=true>/);
      assert.match(log, /\/app\/data\/markdown_threads/);
      assert.match(log, /scp[\s\S]*\.env\.docker/);
      assert.match(log, /curl[\s\S]*https:\/\/ui\.example\.test/);
    }
  );
});
```

- [ ] **Step 4: Add failing health-check/log test**

Append:

```javascript
test("failed health verification requests logs and exits nonzero", async () => {
  await withFakeCommands(
    "500",
    async ({ commandPath, envPath, keyPath, logPath, remoteHome }) => {
      const result = run([], {
        PATH: commandPath,
        FAKE_COMMAND_LOG: logPath,
        FAKE_REMOTE_HOME: remoteHome,
        ORACLE_HOST: "203.0.113.10",
        ORACLE_SSH_KEY: keyPath,
        ORACLE_ENV_FILE: envPath,
        DOCKER_HUB_USERNAME: "example",
      });
      const log = await readFile(logPath, "utf8");

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr + result.stdout,
        /health verification failed/i
      );
      assert.match(log, /docker <logs> <--tail> <100>/);
    }
  );
});
```

- [ ] **Step 5: Run tests and confirm RED**

Run:

```bash
node --test tests/deploy-oracle.test.mjs
```

Expected: help/config and deployment tests FAIL because script is missing.

- [ ] **Step 6: Commit failing tests**

```bash
git add tests/deploy-oracle.test.mjs
git commit -m "test: define Oracle VM deployment contract"
```

### Task 2: Implement Oracle AMD deployment

**Files:**

- Create: `deploy-oracle.sh`
- Test: `tests/deploy-oracle.test.mjs`

- [ ] **Step 1: Add script interface, defaults, and validation**

Create `deploy-oracle.sh` with:

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: ./deploy-oracle.sh [--help]

Deploy the existing linux/amd64 Deep Agent UI image to an Oracle AMD VM.

Required:
  ORACLE_HOST             VM public IP or DNS name
  ORACLE_SSH_KEY          Readable SSH private-key path
  DOCKER_HUB_USERNAME     Docker Hub image owner

Optional:
  ORACLE_USER             SSH user (default: opc)
  ORACLE_SSH_PORT         SSH port (default: 22)
  ORACLE_HTTP_PORT        Public HTTP port (default: 80)
  ORACLE_CONTAINER_NAME   Container name (default: deepagent-ui)
  ORACLE_IMAGE            Full image reference
  ORACLE_PUBLIC_URL       Public health/auth URL
  ORACLE_ENV_FILE         Runtime env file (default: .env.docker)
EOF
}

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    echo "❌ Unknown option: $1" >&2
    usage >&2
    exit 1
    ;;
esac

if [ -f "$SCRIPT_DIR/env-oracle.sh" ]; then
  source "$SCRIPT_DIR/env-oracle.sh"
fi

for required_command in ssh scp curl; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "❌ Required command not found: $required_command" >&2
    exit 1
  fi
done

for required_variable in ORACLE_HOST ORACLE_SSH_KEY DOCKER_HUB_USERNAME; do
  if [ -z "${!required_variable:-}" ]; then
    echo "❌ $required_variable is required." >&2
    exit 1
  fi
done

if [ ! -r "$ORACLE_SSH_KEY" ]; then
  echo "❌ ORACLE_SSH_KEY is not readable: $ORACLE_SSH_KEY" >&2
  exit 1
fi

ORACLE_USER="${ORACLE_USER:-opc}"
ORACLE_SSH_PORT="${ORACLE_SSH_PORT:-22}"
ORACLE_HTTP_PORT="${ORACLE_HTTP_PORT:-80}"
ORACLE_CONTAINER_NAME="${ORACLE_CONTAINER_NAME:-deepagent-ui}"
ORACLE_IMAGE="${ORACLE_IMAGE:-docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest}"
ORACLE_ENV_FILE="${ORACLE_ENV_FILE:-$SCRIPT_DIR/.env.docker}"

if [ ! -r "$ORACLE_ENV_FILE" ]; then
  echo "❌ Oracle runtime environment file is not readable: $ORACLE_ENV_FILE" >&2
  exit 1
fi

if ! [[ "$ORACLE_SSH_PORT" =~ ^[0-9]+$ ]] ||
   [ "$ORACLE_SSH_PORT" -lt 1 ] || [ "$ORACLE_SSH_PORT" -gt 65535 ]; then
  echo "❌ ORACLE_SSH_PORT must be between 1 and 65535." >&2
  exit 1
fi

if ! [[ "$ORACLE_HTTP_PORT" =~ ^[0-9]+$ ]] ||
   [ "$ORACLE_HTTP_PORT" -lt 1 ] || [ "$ORACLE_HTTP_PORT" -gt 65535 ]; then
  echo "❌ ORACLE_HTTP_PORT must be between 1 and 65535." >&2
  exit 1
fi

if ! [[ "$ORACLE_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  echo "❌ ORACLE_USER contains unsupported characters." >&2
  exit 1
fi

if ! [[ "$ORACLE_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "❌ ORACLE_HOST contains unsupported characters." >&2
  exit 1
fi

if ! [[ "$ORACLE_CONTAINER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "❌ ORACLE_CONTAINER_NAME contains unsupported characters." >&2
  exit 1
fi

if ! [[ "$ORACLE_IMAGE" =~ ^[A-Za-z0-9._/@:-]+$ ]]; then
  echo "❌ ORACLE_IMAGE is not a valid container image reference." >&2
  exit 1
fi

if [ -z "${ORACLE_PUBLIC_URL:-}" ]; then
  if [ "$ORACLE_HTTP_PORT" = "80" ]; then
    ORACLE_PUBLIC_URL="http://$ORACLE_HOST"
  else
    ORACLE_PUBLIC_URL="http://$ORACLE_HOST:$ORACLE_HTTP_PORT"
  fi
fi

REMOTE="$ORACLE_USER@$ORACLE_HOST"
SSH_ARGS=(-i "$ORACLE_SSH_KEY" -p "$ORACLE_SSH_PORT" -o BatchMode=yes)
SCP_ARGS=(-i "$ORACLE_SSH_KEY" -P "$ORACLE_SSH_PORT" -o BatchMode=yes)

remote_bash() {
  local remote_command="bash -s --"
  local argument quoted_argument
  for argument in "$@"; do
    printf -v quoted_argument '%q' "$argument"
    remote_command+=" $quoted_argument"
  done
  ssh "${SSH_ARGS[@]}" "$REMOTE" "$remote_command"
}
```

- [ ] **Step 2: Add remote Docker detection and secure directory setup**

Append:

```bash
echo "🔐 Checking Oracle VM access and Docker..."
if ! DOCKER_MODE=$(ssh "${SSH_ARGS[@]}" "$REMOTE" \
  'if docker info >/dev/null 2>&1; then printf "direct\n"; elif sudo -n docker info >/dev/null 2>&1; then printf "sudo\n"; else exit 1; fi'); then
  echo "❌ Docker is unavailable for $REMOTE. Install Docker and grant access first." >&2
  exit 1
fi

case "$DOCKER_MODE" in
  direct|sudo)
    ;;
  *)
    echo "❌ Oracle VM returned an invalid Docker access mode." >&2
    exit 1
    ;;
esac

remote_bash <<'REMOTE_SETUP'
set -euo pipefail
remote_dir="$HOME/deepagent-ui"
mkdir -p "$remote_dir/data"
chmod 0700 "$remote_dir"
REMOTE_SETUP

scp "${SCP_ARGS[@]}" "$ORACLE_ENV_FILE" \
  "$REMOTE:deepagent-ui/.env.docker"

remote_bash <<'REMOTE_ENV'
set -euo pipefail
remote_dir="$HOME/deepagent-ui"
chmod 0600 "$remote_dir/.env.docker"
REMOTE_ENV
```

- [ ] **Step 3: Add idempotent remote container replacement**

Append:

```bash
echo "🚀 Deploying $ORACLE_IMAGE to $REMOTE..."
remote_bash \
  "$DOCKER_MODE" \
  "$ORACLE_CONTAINER_NAME" \
  "$ORACLE_IMAGE" \
  "$ORACLE_HTTP_PORT" \
  "$ORACLE_PUBLIC_URL" <<'REMOTE_DEPLOY'
set -euo pipefail
docker_mode=$1
container_name=$2
image=$3
http_port=$4
public_url=$5
remote_dir="$HOME/deepagent-ui"

if [ "$docker_mode" = "sudo" ]; then
  docker=(sudo docker)
else
  docker=(docker)
fi

"${docker[@]}" pull "$image"
if "${docker[@]}" container inspect "$container_name" >/dev/null 2>&1; then
  "${docker[@]}" rm -f "$container_name"
fi

"${docker[@]}" run -d \
  --name "$container_name" \
  --restart unless-stopped \
  -p "$http_port:3000" \
  --env-file "$remote_dir/.env.docker" \
  -e "AUTH_URL=$public_url" \
  -e "NEXTAUTH_URL=$public_url" \
  -e "AUTH_TRUST_HOST=true" \
  -v "$remote_dir/data:/app/data/markdown_threads" \
  "$image"
REMOTE_DEPLOY
```

- [ ] **Step 4: Add bounded health check and diagnostic logs**

Append:

```bash
echo "🩺 Verifying $ORACLE_PUBLIC_URL..."
HTTP_STATUS=""
for attempt in {1..12}; do
  HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" \
    --connect-timeout 10 \
    --max-time 30 \
    "$ORACLE_PUBLIC_URL" || true)
  case "$HTTP_STATUS" in
    200|301|302|303|307|308)
      echo "✅ Oracle deployment completed (HTTP $HTTP_STATUS)."
      echo "🔗 Public URL: $ORACLE_PUBLIC_URL"
      exit 0
      ;;
  esac
  echo "   Site returned HTTP ${HTTP_STATUS:-000}; retrying ($attempt/12)..."
  sleep 5
done

echo "❌ Oracle deployment health verification failed with HTTP ${HTTP_STATUS:-000}." >&2
remote_bash \
  "$DOCKER_MODE" "$ORACLE_CONTAINER_NAME" <<'REMOTE_LOGS'
set -euo pipefail
docker_mode=$1
container_name=$2
if [ "$docker_mode" = "sudo" ]; then
  sudo docker logs --tail 100 "$container_name"
else
  docker logs --tail 100 "$container_name"
fi
REMOTE_LOGS
exit 1
```

- [ ] **Step 5: Make script executable**

Run:

```bash
chmod +x deploy-oracle.sh
```

- [ ] **Step 6: Run black-box tests and confirm GREEN**

Run:

```bash
node --test tests/deploy-oracle.test.mjs
```

Expected: four tests PASS.

- [ ] **Step 7: Run shell syntax check**

Run:

```bash
bash -n deploy-oracle.sh
```

Expected: exit 0, no output.

- [ ] **Step 8: Commit implementation**

```bash
git add deploy-oracle.sh
git commit -m "feat: deploy UI to Oracle AMD VM"
```

### Task 3: Verify deployment integration

**Files:**

- Verify: `deploy-oracle.sh`
- Verify: `tests/deploy-oracle.test.mjs`
- Verify: `tests/deployment-security.test.mjs`

- [ ] **Step 1: Run Oracle deployment tests**

Run:

```bash
node --test tests/deploy-oracle.test.mjs
```

Expected: four tests PASS.

- [ ] **Step 2: Run deployment security regression tests**

Run:

```bash
node --test tests/deployment-security.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 3: Run repository lint**

Run:

```bash
yarn lint
```

Expected: exit 0.

- [ ] **Step 4: Inspect focused diff and working tree**

Run:

```bash
git diff --check HEAD^ -- deploy-oracle.sh tests/deploy-oracle.test.mjs
git status --short
```

Expected: no whitespace errors; unrelated pre-existing changes remain untouched.

- [ ] **Step 5: Record Code Context Engine memory when available**

Record `deploy-oracle.sh` as Oracle AMD VM deployment entry point. If CCE tools
remain unavailable, note that limitation without creating alternate memory
files.
