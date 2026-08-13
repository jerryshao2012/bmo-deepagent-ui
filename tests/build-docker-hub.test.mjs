import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
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
const scriptPath = path.join(repoRoot, "build.sh");
const dockerEnvExample = await readFile(
  path.join(repoRoot, ".env.docker.example"),
  "utf8"
);
const pinnedImage = "docker.io/jerryshao2013/deepagent-ui:latest";
const resolvedBackendUrl =
  "https://deep-research-agent-testseed.env.example.test";
const resolvedUiUrl = "https://bmo-deepagent-ui-testseed.env.example.test";
const resolverOutput = [
  "AZURE_ENVIRONMENT_ID='/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/test-resource-group/providers/Microsoft.App/managedEnvironments/test-environment'",
  "AZURE_ENVIRONMENT_DEFAULT_DOMAIN='env.example.test'",
  "BACKEND_APP_NAME='deep-research-agent-testseed'",
  "UI_APP_NAME='bmo-deepagent-ui-testseed'",
  `BACKEND_URL='${resolvedBackendUrl}'`,
  `AZURE_UI_URL='${resolvedUiUrl}'`,
  `FRONTEND_URLS='${resolvedUiUrl},https://bmo-deepagent-ui.vercel.app'`,
  `GOOGLE_CALLBACK_URL='${resolvedBackendUrl}/auth/callback/google'`,
  `GITHUB_CALLBACK_URL='${resolvedBackendUrl}/auth/callback/github'`,
  `GITHUB_HOMEPAGE_URL='${resolvedUiUrl}'`,
  "CHANGED='true'",
].join("\n");
const priorManifest = Buffer.from(
  "PRIOR MANIFEST BYTES\n\u0000unchanged",
  "utf8"
);

const fakeRuntime = `#!/bin/bash
set -u
for variable_name in LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET SYNTHETIC_SECRET_CANARY NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE; do
  [ -z "\${!variable_name-}" ] || printf 'environment-leak:%s\n' "$variable_name" >> "$COMMAND_LOG"
done
{
  printf '%s' "\${0##*/}"
  for argument in "$@"; do printf ' <%s>' "$argument"; done
  printf '\n'
} >> "$COMMAND_LOG"

case "\${1:-}" in
  info)
    exit "$INFO_STATUS"
    ;;
  build)
    context="\${!#}"
    printf '%s\n' "$context" > "$CONTEXT_PATH_LOG"
    [ -z "\${DOCKER_HUB_PAT+x}" ] || exit 88
    [ -z "\${DOCKER_HUB_PAT_VALUE+x}" ] || exit 89
    {
      [ ! -e "$context/.env" ] && printf 'excluded:.env\n'
      [ ! -e "$context/.env.docker" ] && printf 'excluded:.env.docker\n'
      [ ! -e "$context/.git" ] && printf 'excluded:.git\n'
      [ ! -e "$context/node_modules" ] && printf 'excluded:node_modules\n'
      [ ! -e "$context/.deployment-build.json" ] && printf 'excluded:manifest\n'
      [ -f "$context/Dockerfile" ] && printf 'included:Dockerfile\n'
      IFS= read -r marker < "$context/public/deployment-version.txt"
      printf 'marker:%s\n' "$marker"
    } >> "$CONTEXT_AUDIT"
    exit "$BUILD_STATUS"
    ;;
  login)
    IFS= read -r credential || :
    printf '%s' "$credential" > "$LOGIN_STDIN_LOG"
    exit "$FAKE_LOGIN_STATUS"
    ;;
  push)
    exit "$PUSH_STATUS"
    ;;
esac
exit 86
`;

const runBuild = async ({
  args = [],
  runtimes = ["docker"],
  callerContainerCli = "docker",
  exportedPat,
  siblingPat = "sibling-docker-pat",
  dockerEnv = "NEXT_PUBLIC_ASSISTANT_ID='docker-assistant'\nNEXT_PUBLIC_LANGGRAPH_URL=https://ignored.invalid\n",
  existingManifest,
  buildStatus = 0,
  loginStatus = 0,
  pushStatus = 0,
  manifestWriteStatus = 0,
  renameStatus = 0,
  username,
  xtrace = false,
  backendEnvExtra = "",
  uiEnvExtra = "",
  inheritedEnv = {},
  allexport = false,
  cleanupRmStatus = 0,
  endpointResolverOutput = resolverOutput,
  endpointResolverStatus = 0,
} = {}) => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "docker-hub-build-test-"));
  const fixtureRoot = path.join(tempRoot, "ui");
  const backendRoot = path.join(tempRoot, "deep-research");
  const binDir = path.join(fixtureRoot, "bin");
  const scriptsDir = path.join(fixtureRoot, "scripts");
  const commandLog = path.join(fixtureRoot, "commands.log");
  const loginStdinLog = path.join(fixtureRoot, "login-stdin.log");
  const contextPathLog = path.join(fixtureRoot, "context-path.log");
  const contextAudit = path.join(fixtureRoot, "context-audit.log");
  const executedSentinel = path.join(fixtureRoot, "must-not-execute");
  const cleanupDirectory = path.join(fixtureRoot, "must-not-delete-directory");
  const cleanupFile = path.join(fixtureRoot, "must-not-delete-file");
  const trapSentinel = path.join(fixtureRoot, "must-not-run-injected-trap");
  const controlSentinel = path.join(
    fixtureRoot,
    "must-not-run-docker-env-control"
  );
  const nodeOptionsPayload = path.join(fixtureRoot, "docker-env-control.cjs");

  try {
    await mkdir(binDir, { recursive: true });
    await mkdir(scriptsDir);
    await mkdir(backendRoot);
    await mkdir(path.join(fixtureRoot, "public"));
    await mkdir(cleanupDirectory);
    await writeFile(cleanupFile, "preserve\n");
    await writeFile(
      nodeOptionsPayload,
      `require("node:fs").writeFileSync(${JSON.stringify(
        controlSentinel
      )}, "executed\\n");\n`
    );
    await Promise.all([
      copyFile(scriptPath, path.join(fixtureRoot, "build.sh")),
      copyFile(path.join(repoRoot, "env.sh"), path.join(fixtureRoot, "env.sh")),
      copyFile(
        path.join(repoRoot, "Dockerfile"),
        path.join(fixtureRoot, "Dockerfile")
      ),
      copyFile(
        path.join(repoRoot, ".dockerignore"),
        path.join(fixtureRoot, ".dockerignore")
      ),
      copyFile(
        path.join(repoRoot, "scripts/container-runtime.sh"),
        path.join(scriptsDir, "container-runtime.sh")
      ),
      copyFile(
        path.join(repoRoot, "scripts/sanitize-passkey-dotenv.mjs"),
        path.join(scriptsDir, "sanitize-passkey-dotenv.mjs")
      ),
    ]);
    await writeFile(
      path.join(scriptsDir, "resolve-azure-endpoints.sh"),
      `#!/bin/bash
printf 'resolver' >> "$COMMAND_LOG"
for argument in "$@"; do printf ' <%s>' "$argument" >> "$COMMAND_LOG"; done
printf '\n' >> "$COMMAND_LOG"
printf '%s\n' "$ENDPOINT_RESOLVER_OUTPUT"
exit "$ENDPOINT_RESOLVER_STATUS"
`
    );
    await chmod(path.join(scriptsDir, "resolve-azure-endpoints.sh"), 0o755);
    await writeFile(path.join(fixtureRoot, "public", "keep.txt"), "keep\n");
    await writeFile(
      path.join(backendRoot, "env.sh"),
      'export DEEP_RESEARCH_AGENT_URL="https://backend.example.test"\n'
    );
    await writeFile(
      path.join(fixtureRoot, ".env"),
      `export SEED="testseed"
export RESOURCE_GROUP="test-resource-group"
export LOCATION="test-location"
export KV_NAME="test-vault"
export AZURE_SUBSCRIPTION_ID="12345678-1234-1234-1234-123456789abc"
export ENV_NAME="test-environment"
export BACKEND_APP_NAME="deep-research-agent-testseed"
export UI_APP_NAME="bmo-deepagent-ui-testseed"
export NEXT_PUBLIC_ASSISTANT_ID="env-assistant"
[ -z "\${DOCKER_HUB_PAT-}" ] || return 76
[ -z "\${DOCKER_HUB_PAT_VALUE-}" ] || return 77
[ -z "\${EXPORTED_DOCKER_HUB_PAT_VALUE-}" ] || return 78
export DOCKER_HUB_PAT="ui-env-must-not-use"
${uiEnvExtra
  .replaceAll("__CLEANUP_DIR__", cleanupDirectory)
  .replaceAll("__CLEANUP_FILE__", cleanupFile)
  .replaceAll("__TRAP_SENTINEL__", trapSentinel)}
`
    );
    if (dockerEnv !== false) {
      await writeFile(
        path.join(fixtureRoot, ".env.docker"),
        dockerEnv.replaceAll("__NODE_OPTIONS_PAYLOAD__", nodeOptionsPayload)
      );
    }
    await writeFile(
      path.join(backendRoot, ".env"),
      `UNRELATED=must-not-import
CONTAINER_CLI=container
DOCKER_HUB_USERNAME=attacker
BASH_ENV=/tmp/attacker
MALICIOUS=$(touch ${executedSentinel})
DOCKER_HUB_PAT='${siblingPat}'
${backendEnvExtra}`
    );
    if (existingManifest !== undefined) {
      await writeFile(
        path.join(fixtureRoot, ".deployment-build.json"),
        existingManifest
      );
    }

    for (const runtime of runtimes) {
      const runtimePath = path.join(binDir, runtime);
      await writeFile(runtimePath, fakeRuntime);
      await chmod(runtimePath, 0o755);
    }
    for (const [name, target] of [
      ["dirname", "/usr/bin/dirname"],
      ["rsync", "/usr/bin/rsync"],
      ["cp", "/bin/cp"],
      ["rm", "/bin/rm"],
      ["mkdir", "/bin/mkdir"],
      ["mktemp", "/usr/bin/mktemp"],
    ]) {
      const commandPath = path.join(binDir, name);
      await writeFile(
        commandPath,
        `#!/bin/bash
for variable_name in LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET SYNTHETIC_SECRET_CANARY NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE; do
  [ -z "\${!variable_name-}" ] || printf 'environment-leak:%s\n' "$variable_name" >> "$COMMAND_LOG"
done
{
  printf '${name}'
  for argument in "$@"; do printf ' <%s>' "$argument"; done
  printf '\n'
} >> "$COMMAND_LOG"
[ "${name}" != "rm" ] || [ "$CLEANUP_RM_STATUS" -eq 0 ] || exit "$CLEANUP_RM_STATUS"
exec ${target} "$@"
`
      );
      await chmod(commandPath, 0o755);
    }
    const datePath = path.join(binDir, "date");
    await writeFile(
      datePath,
      `#!/bin/bash
printf 'date' >> "$COMMAND_LOG"
for argument in "$@"; do printf ' <%s>' "$argument" >> "$COMMAND_LOG"; done
printf '\n' >> "$COMMAND_LOG"
[ "$#" -eq 2 ] && [ "$1" = "-u" ] && [ "$2" = "+%Y%m%dT%H%M%SZ" ] || exit 86
printf '20260812T101112Z\n'
`
    );
    await chmod(datePath, 0o755);
    const nodePath = path.join(binDir, "node");
    await writeFile(
      nodePath,
      `#!/bin/bash
for variable_name in LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET SYNTHETIC_SECRET_CANARY NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE; do
  [ -z "\${!variable_name-}" ] || printf 'environment-leak:%s\n' "$variable_name" >> "$COMMAND_LOG"
done
if [ "\${1:-}" = "-e" ] && printf '%s' "\${2:-}" | /usr/bin/grep -q 'writeFileSync'; then
  [ "$MANIFEST_WRITE_STATUS" -eq 0 ] || exit "$MANIFEST_WRITE_STATUS"
fi
exec ${process.execPath} "$@"
`
    );
    await chmod(nodePath, 0o755);
    const mvPath = path.join(binDir, "mv");
    await writeFile(
      mvPath,
      `#!/bin/bash
{
  printf 'mv'
  for argument in "$@"; do printf ' <%s>' "$argument"; done
  printf '\n'
} >> "$COMMAND_LOG"
[ "$RENAME_STATUS" -eq 0 ] || exit "$RENAME_STATUS"
exec /bin/mv "$@"
`
    );
    await chmod(mvPath, 0o755);

    const env = {
      PATH: binDir,
      COMMAND_LOG: commandLog,
      LOGIN_STDIN_LOG: loginStdinLog,
      CONTEXT_PATH_LOG: contextPathLog,
      CONTEXT_AUDIT: contextAudit,
      INFO_STATUS: "0",
      BUILD_STATUS: String(buildStatus),
      FAKE_LOGIN_STATUS: String(loginStatus),
      PUSH_STATUS: String(pushStatus),
      MANIFEST_WRITE_STATUS: String(manifestWriteStatus),
      RENAME_STATUS: String(renameStatus),
      CLEANUP_RM_STATUS: String(cleanupRmStatus),
      ENDPOINT_RESOLVER_OUTPUT: endpointResolverOutput,
      ENDPOINT_RESOLVER_STATUS: String(endpointResolverStatus),
      ...Object.fromEntries(
        Object.entries(inheritedEnv).map(([key, value]) => [
          key,
          value
            .replaceAll("__CLEANUP_DIR__", cleanupDirectory)
            .replaceAll("__CLEANUP_FILE__", cleanupFile)
            .replaceAll("__NODE_OPTIONS_PAYLOAD__", nodeOptionsPayload),
        ])
      ),
    };
    if (callerContainerCli !== null) {
      env.CONTAINER_CLI = callerContainerCli;
    }
    if (exportedPat !== undefined) env.DOCKER_HUB_PAT = exportedPat;
    if (username !== undefined) env.DOCKER_HUB_USERNAME = username;
    const result = spawnSync(
      "/bin/bash",
      [
        "--noprofile",
        "--norc",
        ...(allexport ? ["-a"] : []),
        ...(xtrace ? ["-x"] : []),
        path.join(fixtureRoot, "build.sh"),
        ...args,
      ],
      { cwd: fixtureRoot, encoding: "utf8", env }
    );
    const log = await readFile(commandLog, "utf8").catch(() => "");
    const stdin = await readFile(loginStdinLog, "utf8").catch(() => "");
    const audit = await readFile(contextAudit, "utf8").catch(() => "");
    const loggedContextPath = (
      await readFile(contextPathLog, "utf8").catch(() => "")
    ).trim();
    const contextPath = loggedContextPath
      ? path.resolve(fixtureRoot, loggedContextPath)
      : "";
    const contextExistsAfter = contextPath
      ? await access(contextPath)
          .then(() => true)
          .catch(() => false)
      : false;
    const manifest = await readFile(
      path.join(fixtureRoot, ".deployment-build.json")
    ).catch(() => null);
    const tempManifestFiles = await import("node:fs/promises").then(
      ({ readdir }) =>
        readdir(fixtureRoot).then((entries) =>
          entries.filter((entry) =>
            entry.startsWith(".deployment-build.json.tmp.")
          )
        )
    );
    const sentinelExists = await access(executedSentinel)
      .then(() => true)
      .catch(() => false);
    const cleanupDirectoryExists = await access(cleanupDirectory)
      .then(() => true)
      .catch(() => false);
    const cleanupFileExists = await access(cleanupFile)
      .then(() => true)
      .catch(() => false);
    const trapSentinelExists = await access(trapSentinel)
      .then(() => true)
      .catch(() => false);
    const controlSentinelExists = await access(controlSentinel)
      .then(() => true)
      .catch(() => false);
    return {
      result,
      log,
      stdin,
      audit,
      contextExistsAfter,
      manifest,
      tempManifestFiles,
      sentinelExists,
      cleanupDirectoryExists,
      cleanupFileExists,
      trapSentinelExists,
      controlSentinelExists,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const assertNoBuildSideEffects = (
  { log, manifest },
  expectedManifest = null
) => {
  assert.equal(log, "");
  assert.deepEqual(manifest, expectedManifest);
};

for (const args of [
  ["--container-cli", "podman"],
  ["--container-cli=podman"],
  ["-c", "podman"],
]) {
  test(`build accepts runtime argument form ${args.join(" ")}`, async () => {
    const { result, log } = await runBuild({
      args,
      runtimes: ["podman", "docker"],
      exportedPat: "argument-runtime-pat",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(log, /^podman <info>/m);
    assert.match(log, /^podman <build>/m);
    assert.doesNotMatch(log, /^docker\b/m);
  });
}

test("build runtime argument wins over inherited CONTAINER_CLI", async () => {
  const { result, log } = await runBuild({
    args: ["--container-cli", "podman"],
    runtimes: ["podman", "docker"],
    callerContainerCli: "docker",
    exportedPat: "argument-precedence-pat",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /^podman <build>/m);
  assert.doesNotMatch(log, /^docker\b/m);
});

test("build retains inherited CONTAINER_CLI without an argument", async () => {
  const { result, log } = await runBuild({
    runtimes: ["podman", "docker"],
    callerContainerCli: "podman",
    exportedPat: "environment-runtime-pat",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /^podman <build>/m);
  assert.doesNotMatch(log, /^docker\b/m);
});

for (const [name, callerContainerCli, runtimes, diagnostic] of [
  [
    "empty inherited CONTAINER_CLI",
    "",
    ["container", "podman", "docker"],
    /CONTAINER_CLI.*container.*podman.*docker/i,
  ],
  [
    "unsupported inherited CONTAINER_CLI",
    "nerdctl",
    ["container", "podman", "docker"],
    /CONTAINER_CLI.*container.*podman.*docker/i,
  ],
  [
    "unavailable inherited CONTAINER_CLI",
    "podman",
    ["docker"],
    /podman.*PATH/i,
  ],
]) {
  test(`build rejects ${name} before side effects`, async () => {
    const { result, log, manifest } = await runBuild({
      callerContainerCli,
      runtimes,
      existingManifest: priorManifest,
      uiEnvExtra: `printf 'config-source\\n' >> "$COMMAND_LOG"
`,
      exportedPat: "unused-inherited-runtime-pat",
    });

    assert.equal(result.status, 64, result.stderr);
    assert.match(result.stderr, diagnostic);
    assertNoBuildSideEffects({ log, manifest }, priorManifest);
  });
}

for (const [name, callerContainerCli] of [
  ["invalid", "nerdctl"],
  ["unavailable", "container"],
]) {
  test(`build CLI runtime overrides ${name} inherited CONTAINER_CLI`, async () => {
    const { result, log } = await runBuild({
      args: ["--container-cli", "podman"],
      callerContainerCli,
      runtimes: ["podman"],
      exportedPat: "cli-over-inherited-runtime-pat",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(log, /^podman <build>/m);
  });
}

test("build protects inherited runtime snapshot state", async () => {
  const { result, log } = await runBuild({
    callerContainerCli: "podman",
    runtimes: ["podman", "docker"],
    inheritedEnv: {
      CALLER_CONTAINER_CLI_WAS_SET: "false",
      CALLER_CONTAINER_CLI: "docker",
    },
    exportedPat: "protected-inherited-snapshot-pat",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /^podman <build>/m);
  assert.doesNotMatch(log, /^docker\b/m);
});

test("build retains automatic runtime selection without an argument or environment override", async () => {
  const { result, log } = await runBuild({
    runtimes: ["podman", "docker"],
    callerContainerCli: null,
    exportedPat: "automatic-runtime-pat",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /^docker <build>/m);
  assert.doesNotMatch(log, /^podman\b/m);
});

test("build runtime argument state cannot be replaced by inherited or sourced values", async () => {
  const { result, log } = await runBuild({
    args: ["--container-cli", "podman"],
    runtimes: ["container", "podman", "docker"],
    callerContainerCli: "docker",
    inheritedEnv: {
      CLI_CONTAINER_CLI: "container",
      CLI_CONTAINER_CLI_SEEN: "false",
    },
    uiEnvExtra: `export CLI_CONTAINER_CLI=container
export CLI_CONTAINER_CLI_SEEN=false
`,
    exportedPat: "protected-parser-state-pat",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /^podman <build>/m);
  assert.doesNotMatch(log, /^(?:container|docker)\b/m);
});

for (const [name, args] of [
  ["missing long value", ["--container-cli"]],
  ["missing short value", ["-c"]],
  ["empty separate value", ["--container-cli", ""]],
  ["empty equals value", ["--container-cli="]],
  ["unsupported value", ["--container-cli", "nerdctl"]],
  ["duplicate same flags", ["--container-cli", "docker", "-c", "docker"]],
  [
    "duplicate conflicting flags",
    ["--container-cli", "docker", "--container-cli=podman"],
  ],
  ["combined short form", ["-cpodman"]],
  ["unknown argument", ["--unknown"]],
  ["help mixed with another argument", ["--help", "--container-cli", "docker"]],
  ["help after another argument", ["--container-cli", "docker", "--help"]],
]) {
  test(`build rejects ${name} before side effects`, async () => {
    const { result, log, manifest } = await runBuild({
      args,
      runtimes: ["container", "podman", "docker"],
      existingManifest: priorManifest,
      uiEnvExtra: `printf 'config-source\\n' >> "$COMMAND_LOG"
`,
      exportedPat: "unused-argument-pat",
    });

    assert.equal(result.status, 64, result.stderr);
    assertNoBuildSideEffects({ log, manifest }, priorManifest);
  });
}

test("build rejects unavailable selected runtime before side effects", async () => {
  const { result, log, manifest } = await runBuild({
    args: ["--container-cli", "podman"],
    runtimes: ["docker"],
    existingManifest: priorManifest,
    uiEnvExtra: `printf 'config-source\\n' >> "$COMMAND_LOG"
`,
    exportedPat: "unused-runtime-pat",
  });

  assert.equal(result.status, 64, result.stderr);
  assert.match(result.stderr, /podman.*PATH/i);
  assertNoBuildSideEffects({ log, manifest }, priorManifest);
});

for (const help of ["--help", "-h"]) {
  test(`build ${help} is side-effect-free`, async () => {
    const { result, log, manifest } = await runBuild({
      args: [help],
      runtimes: [],
      existingManifest: priorManifest,
      uiEnvExtra: `printf 'config-source\\n' >> "$COMMAND_LOG"
`,
      exportedPat: "unused-help-pat",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: .*build\.sh/);
    assert.match(result.stdout, /container.*podman.*docker/i);
    assertNoBuildSideEffects({ log, manifest }, priorManifest);
  });
}

test("build then Docker Hub login then push writes exact atomic manifest", async () => {
  const {
    result,
    log,
    stdin,
    audit,
    manifest,
    contextExistsAfter,
    tempManifestFiles,
  } = await runBuild({ exportedPat: "exported-docker-pat" });

  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  const build = log.indexOf("docker <build>");
  const resolve = log.indexOf("resolver");
  const login = log.indexOf("docker <login>");
  const push = log.indexOf("docker <push>");
  const rename = log.indexOf("mv <");
  assert.ok(
    resolve >= 0 &&
      resolve < build &&
      build < login &&
      login < push &&
      push < rename,
    log
  );
  assert.match(
    log,
    /^docker <build> <--platform> <linux\/amd64> <--build-arg> <NEXT_PUBLIC_LANGGRAPH_URL=https:\/\/deep-research-agent-testseed\.env\.example\.test> <--build-arg> <NEXT_PUBLIC_ASSISTANT_ID=docker-assistant> <-t> <docker\.io\/jerryshao2013\/deepagent-ui:latest> <.+>$/m
  );
  assert.match(
    log,
    /^docker <login> <--username> <jerryshao2013> <--password-stdin> <docker\.io>$/m
  );
  assert.match(
    log,
    /^docker <push> <docker\.io\/jerryshao2013\/deepagent-ui:latest>$/m
  );
  assert.equal(stdin, "exported-docker-pat");
  assert.ok(manifest);
  assert.deepEqual(JSON.parse(manifest.toString()), {
    schemaVersion: 1,
    deploymentMarker:
      "20260812T101112Z-" +
      String(JSON.parse(manifest.toString()).deploymentMarker)
        .split("-")
        .at(-1),
    image: pinnedImage,
    backendUrl: resolvedBackendUrl,
    assistantId: "docker-assistant",
  });
  const stagedMarker = audit.match(/^marker:(.+)$/m)?.[1];
  assert.match(stagedMarker ?? "", /^20260812T101112Z-[0-9]+$/);
  assert.equal(JSON.parse(manifest.toString()).deploymentMarker, stagedMarker);
  assert.match(audit, /^excluded:manifest$/m);
  assert.equal(contextExistsAfter, false);
  assert.deepEqual(tempManifestFiles, []);
});

test("build rejects unsafe resolver output before container runtime and preserves manifest bytes", async () => {
  for (const output of [
    `${resolverOutput}\nUNKNOWN='value'`,
    resolverOutput.replace(
      "BACKEND_URL=",
      "BACKEND_URL='duplicate'\nBACKEND_URL="
    ),
    resolverOutput.replace("CHANGED='true'", "CHANGED=true"),
    resolverOutput.replace(
      `BACKEND_URL='${resolvedBackendUrl}'`,
      "BACKEND_URL='unterminated"
    ),
  ]) {
    const { result, log, manifest } = await runBuild({
      exportedPat: "unused-pat",
      existingManifest: priorManifest,
      endpointResolverOutput: output,
    });
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /resolver.*(?:invalid|unknown|duplicate)/i);
    assert.doesNotMatch(log, /^docker\b/m);
    assert.deepEqual(manifest, priorManifest);
  }
});

test("build preserves resolver failure status and bytes before container runtime", async () => {
  const { result, log, manifest } = await runBuild({
    exportedPat: "unused-pat",
    existingManifest: priorManifest,
    endpointResolverStatus: 74,
  });
  assert.equal(result.status, 74, result.stderr);
  assert.doesNotMatch(log, /^docker\b/m);
  assert.deepEqual(manifest, priorManifest);
});

for (const [name, options, status] of [
  ["build", { buildStatus: 31 }, 31],
  ["login", { loginStatus: 32 }, 32],
  ["push", { pushStatus: 33 }, 33],
  ["manifest write", { manifestWriteStatus: 34 }, 34],
  ["manifest rename", { renameStatus: 35 }, 35],
]) {
  test(`${name} failure preserves prior manifest bytes and cleans temporary files`, async () => {
    const { result, manifest, contextExistsAfter, tempManifestFiles } =
      await runBuild({
        exportedPat: "failure-test-pat",
        existingManifest: priorManifest,
        ...options,
      });

    assert.equal(result.status, status, result.stderr);
    assert.deepEqual(manifest, priorManifest);
    assert.equal(contextExistsAfter, false);
    assert.deepEqual(tempManifestFiles, []);
  });
}

test("first failed build never creates a deployment manifest", async () => {
  const { result, manifest, log } = await runBuild({
    exportedPat: "failure-test-pat",
    buildStatus: 36,
  });

  assert.equal(result.status, 36, result.stderr);
  assert.equal(manifest, null);
  assert.doesNotMatch(log, /^docker <login>|^docker <push>|^mv </m);
});

for (const [name, exportedPat] of [
  ["exported PAT", "exported-secret-value"],
  ["sibling-file PAT", undefined],
]) {
  test(`${name} reaches login stdin only and stays out of xtrace`, async () => {
    const siblingPat = "sibling-secret-value";
    const expected = exportedPat ?? siblingPat;
    const { result, log, stdin, manifest, sentinelExists } = await runBuild({
      exportedPat,
      siblingPat,
      xtrace: true,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(stdin, expected);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}${log}${manifest}`,
      new RegExp(expected)
    );
    assert.equal(sentinelExists, false);
    assert.doesNotMatch(log, /<attacker>|container <|must-not-import/);
  });
}

test("xtrace is restored in source only after PAT variables are unset", async () => {
  const source = await readFile(scriptPath, "utf8");
  const unsetPat = source.indexOf("unset DOCKER_HUB_PAT_VALUE");
  const restore = source.lastIndexOf("restore_xtrace");
  const push = source.indexOf("container_cli_push");

  assert.ok(unsetPat >= 0 && unsetPat < restore && restore < push);
});

test("conflicting Docker Hub username fails before runtime access", async () => {
  const { result, log } = await runBuild({
    exportedPat: "unused-pat",
    username: "attacker",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DOCKER_HUB_USERNAME.*jerryshao2013/i);
  assert.doesNotMatch(log, /^docker\b/m);
});

test(".env.docker rejects non-allowlisted credentials and controls without leaking them", async () => {
  const { result, log, controlSentinelExists, manifest } = await runBuild({
    exportedPat: "approved-login-pat",
    dockerEnv: `NEXT_PUBLIC_ASSISTANT_ID=allowlisted-assistant
LANGCHAIN_API_KEY=docker-env-secret-canary
UPLOAD_API_KEY=docker-env-secret-canary
PASSKEY_PROXY_SECRET=docker-env-secret-canary
NODE_OPTIONS=--require=__NODE_OPTIONS_PAYLOAD__
DOCKER_CONFIG=docker-env-secret-canary
REGISTRY_AUTH_FILE=docker-env-secret-canary
`,
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(controlSentinelExists, false);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}`,
    /environment-leak|docker-env-secret-canary/
  );
  assert.doesNotMatch(log, /^(?:docker|rsync|node)\b/m);
  assert.equal(manifest, null);
});

test("build sanitizes inherited credentials and controls before child tools", async () => {
  const { result, log, controlSentinelExists } = await runBuild({
    exportedPat: "approved-login-pat",
    inheritedEnv: {
      LANGCHAIN_API_KEY: "docker-env-secret-canary",
      UPLOAD_API_KEY: "docker-env-secret-canary",
      PASSKEY_PROXY_SECRET: "docker-env-secret-canary",
      NODE_OPTIONS: "--require=__NODE_OPTIONS_PAYLOAD__",
      DOCKER_CONFIG: "docker-env-secret-canary",
      REGISTRY_AUTH_FILE: "docker-env-secret-canary",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(controlSentinelExists, false);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}`,
    /environment-leak|docker-env-secret-canary/
  );
});

test("tracked .env.docker example and unrelated secrets remain compatible without child leakage", async () => {
  const { result, log, manifest } = await runBuild({
    exportedPat: "approved-login-pat",
    dockerEnv: `${dockerEnvExample}\nSYNTHETIC_SECRET_CANARY=example-secret-canary\n`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(manifest.toString("utf8")).assistantId, "research");
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}`,
    /environment-leak|example-secret-canary|YOUR_LANGCHAIN_API_KEY_HERE|YOUR_UPLOAD_API_KEY_HERE|REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES/
  );
});

const reservedDockerEnvKeys = [
  // Deployment configuration, runtime selection, and credentials.
  "AZURE_SUBSCRIPTION_ID",
  "RESOURCE_GROUP",
  "ACR_NAME",
  "KV_NAME",
  "SEED",
  "CONTAINER_APP_NAME",
  "CONTAINER_CLI",
  "DOCKER_HUB_USERNAME",
  "DOCKER_HUB_PAT",
  // build.sh state that controls tracing, cleanup, image identity, or manifest content.
  "XTRACE_WAS_ENABLED",
  "XTRACE_RESTORED",
  "ALLEXPORT_WAS_ENABLED",
  "ALLEXPORT_RESTORED",
  "SCRIPT_DIR",
  "BUILD_CONTEXT_DIR",
  "MANIFEST_TEMP",
  "DOCKER_HUB_PAT_VALUE",
  "EXPORTED_DOCKER_HUB_PAT_VALUE",
  "CALLER_DOCKER_HUB_USERNAME",
  "CALLER_CONTAINER_CLI_WAS_SET",
  "CALLER_CONTAINER_CLI",
  "CALLER_CONTAINER_CLI_PATH",
  "CLI_CONTAINER_CLI",
  "CLI_CONTAINER_CLI_SEEN",
  "CLI_CONTAINER_CLI_PATH",
  "ENTRY_XTRACE_WAS_ENABLED",
  "ENV_CONFIG_OUTPUT",
  "CONFIG_LINE_COUNT",
  "ENV_SH_SKIP_DOCKER_SYNC",
  "ENV_SH_SKIP_DOCKER_SYNC_WAS_SET",
  "ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS",
  "ENV_SH_SOURCE_STATUS",
  "APPROVED_DOCKER_HUB_USERNAME",
  "ASSISTANT_ID",
  "IMAGE_NAME",
  "DEPLOYMENT_MARKER",
  "LOGIN_STATUS",
  // Shell, loader, linker, and trace controls.
  "PATH",
  "IFS",
  "CDPATH",
  "ENV",
  "BASH_ENV",
  "SHELLOPTS",
  "BASHOPTS",
  "HOME",
  "PWD",
  "OLDPWD",
  "TMPDIR",
  "PS4",
  "BASH_XTRACEFD",
  "PROMPT_COMMAND",
  "BASH_COMPAT",
  "POSIXLY_CORRECT",
  "GLOBIGNORE",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
];

for (const key of reservedDockerEnvKeys) {
  test(`.env.docker cannot override reserved build key ${key}`, async () => {
    const { result, log } = await runBuild({
      dockerEnv: `${key}=attacker-controlled\n`,
      exportedPat: "unused-pat",
    });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /protected|reserved/i);
    assert.doesNotMatch(log, /^docker\b/m);
  });
}

test("UI .env cannot inject cleanup paths that delete unrelated files", async () => {
  const { result, cleanupDirectoryExists, cleanupFileExists, log, stdin } =
    await runBuild({
      exportedPat: "exported-precedence-pat",
      uiEnvExtra: `export BUILD_CONTEXT_DIR="__CLEANUP_DIR__"
export MANIFEST_TEMP="__CLEANUP_FILE__"
export DOCKER_HUB_USERNAME="attacker"
`,
    });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(stdin, "exported-precedence-pat");
  assert.equal(cleanupDirectoryExists, true);
  assert.equal(cleanupFileExists, true);
  assert.doesNotMatch(log, /<attacker>/);
});

test("UI .env shell controls cannot replace PAT precedence or build state", async () => {
  const exportedPat = "exported-precedence-secret";
  const injectedPat = "ui-env-injected-secret";
  const { result, log, stdin, manifest, trapSentinelExists } = await runBuild({
    exportedPat,
    uiEnvExtra: `set -x
export DOCKER_HUB_PAT_VALUE="${injectedPat}"
export LOGIN_STATUS=77
export IMAGE_NAME="docker.io/attacker/wrong:latest"
export DEPLOYMENT_MARKER="attacker-marker"
export XTRACE_RESTORED=true
cleanup() { touch "__TRAP_SENTINEL__"; }
trap 'touch "__TRAP_SENTINEL__"' EXIT
`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(stdin, exportedPat);
  assert.equal(trapSentinelExists, false);
  assert.ok(manifest);
  assert.deepEqual(JSON.parse(manifest.toString()), {
    schemaVersion: 1,
    deploymentMarker:
      "20260812T101112Z-" +
      String(JSON.parse(manifest.toString()).deploymentMarker)
        .split("-")
        .at(-1),
    image: pinnedImage,
    backendUrl: resolvedBackendUrl,
    assistantId: "docker-assistant",
  });
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}${manifest}`,
    new RegExp(`${exportedPat}|${injectedPat}|attacker-marker|attacker/wrong`)
  );
});

test("inherited holder and cleanup controls cannot override exported PAT", async () => {
  const exportedPat = "exported-holder-precedence";
  const { result, stdin, cleanupDirectoryExists, cleanupFileExists } =
    await runBuild({
      exportedPat,
      inheritedEnv: {
        DOCKER_HUB_PAT_VALUE: "inherited-holder-attacker",
        BUILD_CONTEXT_DIR: "__CLEANUP_DIR__",
        MANIFEST_TEMP: "__CLEANUP_FILE__",
        LOGIN_STATUS: "91",
        IMAGE_NAME: "docker.io/attacker/inherited:latest",
        XTRACE_RESTORED: "true",
      },
    });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(stdin, exportedPat);
  assert.equal(cleanupDirectoryExists, true);
  assert.equal(cleanupFileExists, true);
});

test("env.sh failure preserves status with credential-safe diagnostics", async () => {
  const secret = "env-source-secret-must-not-leak";
  const { result, log } = await runBuild({
    exportedPat: "exported-secret-must-not-leak",
    uiEnvExtra: `set -x
export DOCKER_HUB_PAT_VALUE="${secret}"
return 73
`,
  });

  assert.equal(result.status, 73, result.stderr);
  assert.match(result.stderr, /env\.sh configuration failed/i);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}`,
    /env-source-secret-must-not-leak|exported-secret-must-not-leak/
  );
  assert.doesNotMatch(log, /^docker\b/m);
});

for (const [name, options] of [
  [
    "pre-exported alias",
    {
      inheritedEnv: {
        EXPORTED_DOCKER_HUB_PAT_VALUE: "pre-exported-alias-secret",
      },
    },
  ],
  ["bash allexport", { allexport: true }],
]) {
  test(`${name} cannot expose the exported PAT to env.sh`, async () => {
    const secret = "actual-exported-pat-secret";
    const { result, stdin, log } = await runBuild({
      exportedPat: secret,
      ...options,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(stdin, secret);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}${log}`,
      /actual-exported-pat-secret|pre-exported-alias-secret/
    );
  });
}

for (const [name, failure, status] of [
  ["build", { buildStatus: 41 }, 41],
  ["login", { loginStatus: 42 }, 42],
  ["push", { pushStatus: 43 }, 43],
]) {
  test(`cleanup removal failure preserves original ${name} status`, async () => {
    const { result, contextExistsAfter } = await runBuild({
      exportedPat: "cleanup-status-pat",
      cleanupRmStatus: 67,
      ...failure,
    });

    assert.equal(result.status, status, result.stderr);
    assert.equal(contextExistsAfter, true);
  });
}

test("missing PAT fails after build but before login and push", async () => {
  const { result, log } = await runBuild({ siblingPat: "" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DOCKER_HUB_PAT.*required/i);
  assert.match(log, /^docker <build>/m);
  assert.doesNotMatch(log, /^docker <login>|^docker <push>/m);
});
