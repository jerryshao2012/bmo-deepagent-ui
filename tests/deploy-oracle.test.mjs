import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  });

const writeExecutable = async (filePath, contents) => {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
};

const withFakeCommands = async (curlStatus, callback) => {
  const directory = await mkdtemp(path.join(tmpdir(), "deploy-oracle-test-"));
  const logPath = path.join(directory, "commands.log");
  const keyPath = path.join(directory, "oracle.key");
  const envPath = path.join(directory, ".env.docker");

  await writeFile(logPath, "");
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
`,
  );
  await writeExecutable(
    path.join(directory, "scp"),
    `#!/bin/bash
{
  printf 'scp'
  printf ' <%s>' "$@"
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
exit 0
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
printf '${curlStatus}'
`,
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
`,
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
`,
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

test("--help documents required Oracle configuration", () => {
  const result = run(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: \.\/deploy-oracle\.sh/);
  assert.match(result.stdout, /ORACLE_HOST/);
  assert.match(result.stdout, /ORACLE_SSH_KEY/);
  assert.match(result.stdout, /DOCKER_HUB_USERNAME/);
});

test("missing Oracle configuration fails before remote action", () => {
  const result = run();

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /ORACLE_HOST is required/);
});

test("deploys existing AMD64 image with secure runtime and persistent data", async () => {
  await withFakeCommands("200", async ({
    commandPath,
    envPath,
    keyPath,
    logPath,
    remoteHome,
  }) => {
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
    assert.match(log, /docker <pull> <docker\.io\/example\/deepagent-ui:latest>/);
    assert.match(log, /<--restart> <unless-stopped>/);
    assert.match(log, /<-p> <80:3000>/);
    assert.match(log, /<AUTH_URL=https:\/\/ui\.example\.test\/app\?x=one&y=two>/);
    assert.match(log, /<NEXTAUTH_URL=https:\/\/ui\.example\.test\/app\?x=one&y=two>/);
    assert.match(log, /<AUTH_TRUST_HOST=true>/);
    assert.match(log, /\/app\/data\/markdown_threads/);
    assert.match(log, /scp[\s\S]*\.env\.docker/);
    assert.match(log, /curl[\s\S]*https:\/\/ui\.example\.test/);
  });
});

test("failed health verification requests logs and exits nonzero", async () => {
  await withFakeCommands("500", async ({
    commandPath,
    envPath,
    keyPath,
    logPath,
    remoteHome,
  }) => {
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
    assert.match(result.stderr + result.stdout, /health verification failed/i);
    assert.match(log, /docker <logs> <--tail> <100>/);
  });
});
