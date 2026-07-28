import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = path.join(repoRoot, "deploy-oracle.sh");

const run = (args = [], env = {}) =>
  spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env },
    timeout: 10_000,
  });

const assertCompleted = (result) =>
  assert.equal(result.error, undefined, result.error?.message);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertSshTransport = (log, keyPath, remote) =>
  assert.match(
    log,
    new RegExp(
      `ssh(?=[^\\n]*<-i> <${escapeRegex(keyPath)}>)(?=[^\\n]*<-p> <22>)(?=[^\\n]*<-o> <BatchMode=yes>)(?=[^\\n]*<${escapeRegex(remote)}>)[^\\n]*`,
    ),
  );

const writeExecutable = async (filePath, contents) => {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
};

const withFakeCommands = async (curlStatus, callback) => {
  const directory = await mkdtemp(path.join(tmpdir(), "deploy-oracle-test-"));

  try {
    const logPath = path.join(directory, "commands.log");
    const keyPath = path.join(directory, "oracle.key");
    const envPath = path.join(directory, ".env.docker");
    const remoteHome = path.join(directory, "remote-home");
    const remoteBin = path.join(directory, "remote-bin");
    const remote = "opc@203.0.113.10";

    await Promise.all([
      mkdir(remoteBin, { recursive: true }),
      mkdir(remoteHome, { recursive: true }),
    ]);
    await writeFile(logPath, "");
    await writeFile(keyPath, "test-key");
    await writeFile(envPath, "UPLOAD_API_KEY=test-secret\n");
    await writeExecutable(
      path.join(directory, "ssh"),
      `#!/bin/bash
set -eu
{
  printf 'ssh'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
identity=""
port=""
batch_mode=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -i) [ "$#" -ge 2 ] || exit 64; identity="$2"; shift 2 ;;
    -p) [ "$#" -ge 2 ] || exit 64; port="$2"; shift 2 ;;
    -o) [ "$#" -ge 2 ] || exit 64; batch_mode="$2"; shift 2 ;;
    -*) exit 64 ;;
    *) destination="$1"; shift; break ;;
  esac
done
[ "$identity" = "$FAKE_EXPECTED_KEY" ] || exit 64
[ "$port" = "22" ] || exit 64
[ "$batch_mode" = "BatchMode=yes" ] || exit 64
[ "\${destination:-}" = "$FAKE_EXPECTED_REMOTE" ] && [ "$#" -eq 1 ] || exit 64
remote_command="$1"
payload_path="$FAKE_REMOTE_HOME/remote-payload.sh"
/bin/cat > "$payload_path"
payload="$( /bin/cat "$payload_path" )"
scan="\${remote_command}"$'\\n'"\${payload}"
safe_scan="\${scan//>\\/dev\\/null/}"
safe_scan="\${safe_scan//2>\\&1/}"
if [[ "$safe_scan" == *'>'* || "$safe_scan" == *'<'* ]]; then
  exit 64
fi
if [[ "$safe_scan" =~ (^|[\\;\\|\\&\\(]|[[:space:]])/ ]]; then
  exit 64
fi
cd "$FAKE_REMOTE_HOME"
/usr/bin/env -i HOME="$FAKE_REMOTE_HOME" PATH="$FAKE_REMOTE_BIN" FAKE_COMMAND_LOG="$FAKE_COMMAND_LOG" /bin/bash -c "$remote_command" < "$payload_path"
`,
    );
    await writeExecutable(
      path.join(directory, "scp"),
      `#!/bin/bash
set -eu
{
  printf 'scp'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
identity=""
port=""
batch_mode=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -i) [ "$#" -ge 2 ] || exit 64; identity="$2"; shift 2 ;;
    -P) [ "$#" -ge 2 ] || exit 64; port="$2"; shift 2 ;;
    -o) [ "$#" -ge 2 ] || exit 64; batch_mode="$2"; shift 2 ;;
    -*) exit 64 ;;
    *) break ;;
  esac
done
[ "$identity" = "$FAKE_EXPECTED_KEY" ] || exit 64
[ "$port" = "22" ] || exit 64
[ "$batch_mode" = "BatchMode=yes" ] || exit 64
[ "$#" -eq 2 ] || exit 64
source_file="$1"
destination="$2"
[ "$source_file" = "$FAKE_EXPECTED_ENV" ] || exit 64
[ "$destination" = "$FAKE_EXPECTED_REMOTE:deepagent-ui/.env.docker" ] || exit 64
/bin/mkdir -p "$FAKE_REMOTE_HOME/deepagent-ui"
/bin/cp "$source_file" "$FAKE_REMOTE_HOME/deepagent-ui/.env.docker"
`,
    );
    await writeExecutable(
      path.join(directory, "curl"),
      `#!/bin/bash
{
  printf 'curl'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
matched_url=0
previous_argument=""
[ "$1" = "--disable" ] && [ "$2" = "--globoff" ] || exit 64
for argument in "$@"; do
  case "$argument" in
    http://*|https://*) [ "$previous_argument" = "--" ] && [ "$argument" = "$FAKE_EXPECTED_PUBLIC_URL" ] || exit 64; matched_url=$((matched_url + 1)) ;;
  esac
  previous_argument="$argument"
done
[ "$matched_url" -eq 1 ] || exit 64
printf '${curlStatus}'
`,
    );
    await writeExecutable(
      path.join(directory, "docker"),
      `#!/bin/bash
set -eu
{
  printf 'docker'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
case "$1 \${2:-}" in
  "info ") exit 0 ;;
  "container inspect") exit 1 ;;
  "run -d")
    env_file=""
    volume=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --env-file) shift; [ "$#" -gt 0 ] || exit 65; env_file="$1" ;;
        -v|--volume) shift; [ "$#" -gt 0 ] || exit 65; volume="$1" ;;
      esac
      shift
    done
    [ "$env_file" = "$HOME/deepagent-ui/.env.docker" ] && [ -f "$env_file" ] || exit 65
    [ "$volume" = "$HOME/deepagent-ui/data:/app/data/markdown_threads:Z" ] || exit 65
    [ -d "$HOME/deepagent-ui/data" ] || exit 65
    printf 'test-container-id\\n'
    ;;
esac
`,
    );
    await writeExecutable(
      path.join(directory, "mkdir"),
      `#!/bin/bash
set -eu
{
  printf 'mkdir'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
[ "$#" -eq 2 ] && [ "$1" = "-p" ] && [ "$2" = "$HOME/deepagent-ui/data" ] || exit 65
/bin/mkdir -p "$HOME/deepagent-ui/data"
`,
    );
    for (const command of ["chmod"]) {
      await writeExecutable(
        path.join(directory, command),
        `#!/bin/bash
{
  printf '${command}'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
exit 0
`,
      );
    }
    await writeExecutable(
      path.join(remoteBin, "bash"),
      "#!/bin/bash\nexec /bin/bash \"$@\"\n",
    );
    await writeExecutable(path.join(directory, "sleep"), "#!/bin/bash\nexit 0\n");
    await writeExecutable(path.join(remoteBin, "docker"), `#!/bin/bash\nexec "${directory}/docker" "$@"\n`);
    await writeExecutable(path.join(remoteBin, "chmod"), `#!/bin/bash\nexec "${directory}/chmod" "$@"\n`);
    await writeExecutable(path.join(remoteBin, "mkdir"), `#!/bin/bash\nexec "${directory}/mkdir" "$@"\n`);

    await callback({
      commandPath: `${directory}:${process.env.PATH}`,
      baseEnv: {
        PATH: `${directory}:${process.env.PATH}`,
        FAKE_COMMAND_LOG: logPath,
        FAKE_REMOTE_HOME: remoteHome,
        FAKE_REMOTE_BIN: remoteBin,
        FAKE_EXPECTED_ENV: envPath,
        FAKE_EXPECTED_KEY: keyPath,
        FAKE_EXPECTED_REMOTE: remote,
        FAKE_EXPECTED_PUBLIC_URL: "http://203.0.113.10",
      },
      envPath,
      keyPath,
      logPath,
      remoteHome,
      remote,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("--help documents required Oracle configuration", async () => {
  await withFakeCommands("200", async ({ baseEnv, logPath }) => {
    const result = run(["--help"], baseEnv);

    assertCompleted(result);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: \.\/deploy-oracle\.sh/);
    assert.match(result.stdout, /ORACLE_HOST/);
    assert.match(result.stdout, /ORACLE_SSH_KEY/);
    assert.match(result.stdout, /DOCKER_HUB_USERNAME/);
    assert.equal(await readFile(logPath, "utf8"), "");
  });
});

test("missing Oracle configuration fails before remote action", async () => {
  await withFakeCommands("200", async ({ baseEnv, logPath }) => {
    const result = run([], baseEnv);

    assertCompleted(result);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /ORACLE_HOST is required/);
    assert.equal(await readFile(logPath, "utf8"), "");
  });
});

test("invalid Oracle public URLs fail before remote action", async () => {
  await withFakeCommands("200", async ({ baseEnv, envPath, keyPath, logPath }) => {
    for (const publicUrl of ["-not-a-url", "ftp://ui.example.test"]) {
      const result = run([], {
        ...baseEnv,
        ORACLE_HOST: "203.0.113.10",
        ORACLE_SSH_KEY: keyPath,
        ORACLE_ENV_FILE: envPath,
        DOCKER_HUB_USERNAME: "example",
        ORACLE_PUBLIC_URL: publicUrl,
      });

      assertCompleted(result);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr + result.stdout, /ORACLE_PUBLIC_URL is invalid/);
    }
    assert.equal(await readFile(logPath, "utf8"), "");
  });
});

test("deploys existing AMD64 image with secure runtime and persistent data", async () => {
  await withFakeCommands("200", async ({
    baseEnv,
    envPath,
    keyPath,
    logPath,
    remoteHome,
    remote,
  }) => {
    const publicUrl = "https://ui.example.test/app/[1-2]?x=one&y=two";
    const result = run([], {
      ...baseEnv,
      FAKE_EXPECTED_PUBLIC_URL: publicUrl,
      ORACLE_HOST: "203.0.113.10",
      ORACLE_SSH_KEY: keyPath,
      ORACLE_ENV_FILE: envPath,
      DOCKER_HUB_USERNAME: "example",
      ORACLE_PUBLIC_URL: publicUrl,
    });
    const log = await readFile(logPath, "utf8");
    const output = result.stdout + result.stderr;

    assertCompleted(result);
    assert.equal(result.status, 0, output);
    assertSshTransport(log, keyPath, remote);
    assert.match(log, /docker\.io\/example\/deepagent-ui:latest/);
    assert.match(log, new RegExp(`scp(?: <[^>]+>)* <${escapeRegex(envPath)}> <${remote}:deepagent-ui/\\.env\\.docker>`));
    assert.match(log, new RegExp(`chmod <0700> <${escapeRegex(`${remoteHome}/deepagent-ui`)}>`));
    assert.match(log, new RegExp(`chmod <0600> <${escapeRegex(`${remoteHome}/deepagent-ui/.env.docker`)}>`));
    assert.match(log, /docker <pull> <docker\.io\/example\/deepagent-ui:latest>/);
    assert.match(log, /<--restart> <unless-stopped>/);
    assert.match(log, /<-p> <80:3000>/);
    assert.match(log, new RegExp(`<--env-file> <${escapeRegex(`${remoteHome}/deepagent-ui/.env.docker`)}>`));
    assert.match(log, new RegExp(`<AUTH_URL=${escapeRegex(publicUrl)}>`));
    assert.match(log, new RegExp(`<NEXTAUTH_URL=${escapeRegex(publicUrl)}>`));
    assert.match(log, /<AUTH_TRUST_HOST=true>/);
    assert.match(log, /\/app\/data\/markdown_threads/);
    assert.match(log, new RegExp(`<${escapeRegex(`${remoteHome}/deepagent-ui/data:/app/data/markdown_threads:Z`)}>`));
    assert.match(log, /curl(?=[^\n]*<--connect-timeout> <10>)(?=[^\n]*<--max-time> <30>)[^\n]*/);
    assert.match(log, /curl <--disable> <--globoff> <-sS>/);
    assert.match(log, new RegExp(`curl[^\\n]* <--> <${escapeRegex(publicUrl)}>`));
    assert.equal((log.match(/^curl /gm) ?? []).length, 1);
    assert.doesNotMatch(log + output, /test-secret/);
  });
});

test("failed health verification requests logs and exits nonzero", async () => {
  await withFakeCommands("500", async ({
    baseEnv,
    envPath,
    keyPath,
    logPath,
    remoteHome,
    remote,
  }) => {
    const result = run([], {
      ...baseEnv,
      ORACLE_HOST: "203.0.113.10",
      ORACLE_SSH_KEY: keyPath,
      ORACLE_ENV_FILE: envPath,
      DOCKER_HUB_USERNAME: "example",
    });
    const log = await readFile(logPath, "utf8");

    assertCompleted(result);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /health verification failed/i);
    assert.equal((log.match(/^curl /gm) ?? []).length, 12);
    assert.match(log, /curl(?=[^\n]*<--connect-timeout> <10>)(?=[^\n]*<--max-time> <30>)[^\n]*/);
    assert.match(log, /docker <logs> <--tail> <100>/);
    assertSshTransport(log, keyPath, remote);
  });
});
