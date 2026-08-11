import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
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
const scriptPath = path.join(repoRoot, "deploy-azure-container-app.sh");
const subscriptionId = "subscription-container-app-test";
const runtimeOverrideUnset = Symbol("runtime-override-unset");
const defaultDockerEnv = `# Values loaded after env.sh

NEXT_PUBLIC_ASSISTANT_ID='docker-assistant'
NEXT_PUBLIC_LANGGRAPH_URL="https://docker-backend.invalid"\r
`;

const fakeAz = `#!/bin/bash
set -u
{
  printf 'az'
  for argument in "$@"; do
    printf ' <%s>' "$argument"
  done
  printf '\\n'
} >> "$COMMAND_LOG"

scenario="\${AZ_SCENARIO:-success}"
command="\${1:-}:\${2:-}"

argv_error() {
  printf 'fake az argv contract violation for %s\\n' "$command" >&2
  exit 86
}

case "$command" in
  account:show)
    [ "$#" -eq 6 ] &&
      [ "$3" = "--query" ] && [ "$4" = "id" ] &&
      [ "$5" = "-o" ] && [ "$6" = "tsv" ] || argv_error
    printf '%s\\n' "$AZURE_SUBSCRIPTION_ID"
    ;;
  account:set)
    [ "$#" -eq 4 ] &&
      [ "$3" = "--subscription" ] &&
      [ "$4" = "$AZURE_SUBSCRIPTION_ID" ] || argv_error
    ;;
  group:show)
    [ "$#" -eq 8 ] &&
      [ "$3" = "--name" ] && [ "$4" = "test-resource-group" ] &&
      [ "$5" = "--query" ] && [ "$6" = "name" ] &&
      [ "$7" = "-o" ] && [ "$8" = "tsv" ] || argv_error
    [ "$scenario" = "resource-group-missing" ] && exit 3
    printf '%s\\n' "test-resource-group"
    ;;
  acr:show)
    [ "$#" -eq 10 ] &&
      [ "$3" = "--name" ] && [ "$4" = "testregistry" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--query" ] && [ "$8" = "loginServer" ] &&
      [ "$9" = "-o" ] && [ "\${10}" = "tsv" ] || argv_error
    [ "$scenario" = "acr-missing" ] && exit 4
    [ "$scenario" = "empty-acr-login-server" ] || printf '%s\\n' "testregistry.azurecr.io"
    ;;
  acr:login)
    [ "$#" -eq 9 ] &&
      [ "$3" = "--name" ] && [ "$4" = "testregistry" ] &&
      [ "$5" = "--expose-token" ] &&
      [ "$6" = "--query" ] && [ "$7" = "accessToken" ] &&
      [ "$8" = "-o" ] && [ "$9" = "tsv" ] || argv_error
    [ "$scenario" = "token-failure" ] && exit 41
    [ "$scenario" = "empty-token" ] || printf '%s\\n' "$FAKE_ACR_TOKEN"
    ;;
  containerapp:show)
    [ "$#" -eq 10 ] &&
      [ "$3" = "--name" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--query" ] &&
      [ "$9" = "-o" ] && [ "\${10}" = "tsv" ] || argv_error
    name="$4"
    query="$8"

    if [ "$name" = "bmo-deepagent-ui-testseed" ]; then
      details_query="join('|', [to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn), to_string(properties.configuration.ingress.targetPort), to_string(properties.configuration.activeRevisionsMode), to_string(identity.type), to_string(length(properties.template.containers)), to_string(properties.template.containers[0].name)])"
      case "$query" in
        "$details_query")
          [ "$scenario" = "ui-app-missing" ] && exit 5
          external=true
          fqdn=ui.example.test
          target_port=3000
          revision_mode=Single
          identity_type=SystemAssigned
          container_count=1
          container_name=deepagent-ui
          case "$scenario" in
            ui-internal-ingress) external=false ;;
            ui-missing-fqdn) fqdn=null ;;
            wrong-target-port) target_port=8080 ;;
            multiple-revision-mode) revision_mode=Multiple ;;
            missing-system-identity) identity_type=UserAssigned ;;
            zero-containers) container_count=0; container_name= ;;
            multiple-containers) container_count=2 ;;
          esac
          printf '%s|%s|%s|%s|%s|%s|%s\\n' \\
            "$external" "$fqdn" "$target_port" "$revision_mode" \\
            "$identity_type" "$container_count" "$container_name"
          ;;
        properties.latestReadyRevisionName)
          [ "$scenario" = "empty-previous-revision" ] || printf '%s\\n' "ui--previous"
          ;;
        properties.latestRevisionName)
          case "$scenario" in
            empty-new-revision) ;;
            unchanged-revision) printf '%s\\n' "ui--previous" ;;
            *) printf '%s\\n' "ui--new" ;;
          esac
          ;;
        *) argv_error ;;
      esac
    elif [ "$name" = "deep-research-agent-testseed" ]; then
      expected_query="join('|', [to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn)])"
      [ "$query" = "$expected_query" ] || argv_error
      [ "$scenario" = "backend-missing" ] && exit 6
      external=true
      fqdn=backend.example.test
      [ "$scenario" = "backend-internal-ingress" ] && external=false
      [ "$scenario" = "backend-missing-fqdn" ] && fqdn=null
      printf '%s|%s\\n' "$external" "$fqdn"
    else
      argv_error
    fi
    ;;
  containerapp:registry)
    [ "$#" -eq 11 ] && [ "$3" = "list" ] &&
      [ "$4" = "--name" ] && [ "$5" = "bmo-deepagent-ui-testseed" ] &&
      [ "$6" = "--resource-group" ] && [ "$7" = "test-resource-group" ] &&
      [ "$8" = "--query" ] &&
      [ "$9" = "[].join('|', [server, identity])" ] &&
      [ "\${10}" = "-o" ] && [ "\${11}" = "tsv" ] || argv_error
    case "$scenario" in
      wrong-acr-registry) printf '%s\\n' "other.azurecr.io|system" ;;
      wrong-acr-identity) printf '%s\\n' "testregistry.azurecr.io|user-assigned" ;;
      *) printf '%s\\n' "testregistry.azurecr.io|system" ;;
    esac
    ;;
  containerapp:secret)
    [ "$#" -eq 11 ] && [ "$3" = "set" ] &&
      [ "$4" = "--name" ] && [ "$5" = "bmo-deepagent-ui-testseed" ] &&
      [ "$6" = "--resource-group" ] && [ "$7" = "test-resource-group" ] &&
      [ "$8" = "--secrets" ] &&
      [ "$9" = "upload-api-key=keyvaultref:https://testvault.vault.azure.net/secrets/UPLOAD-API-KEY,identityref:system" ] &&
      [ "\${10}" = "-o" ] && [ "\${11}" = "none" ] || argv_error
    [ "$scenario" = "secret-set-failure" ] && exit 43
    :
    ;;
  containerapp:update)
    [ "$#" -eq 24 ] &&
      [ "$3" = "--name" ] && [ "$4" = "bmo-deepagent-ui-testseed" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--container-name" ] && [ "$8" = "deepagent-ui" ] &&
      [ "$9" = "--image" ] && [ "\${10}" = "testregistry.azurecr.io/deepagent-ui:latest" ] &&
      [ "\${11}" = "--revision-suffix" ] &&
      [ "\${13}" = "--set-env-vars" ] &&
      [ "\${14}" = "NEXT_TELEMETRY_DISABLED=1" ] &&
      [ "\${15}" = "NEXT_PUBLIC_LANGGRAPH_URL=https://backend.example.test" ] &&
      [ "\${16}" = "BACKEND_API_URL=https://backend.example.test" ] &&
      [ "\${17}" = "NEXT_PUBLIC_ASSISTANT_ID=docker-assistant" ] &&
      [ "\${18}" = "AUTH_URL=https://ui.example.test" ] &&
      [ "\${19}" = "NEXTAUTH_URL=https://ui.example.test" ] &&
      [ "\${20}" = "AUTH_TRUST_HOST=true" ] &&
      [ "\${21}" = "NODE_ENV=production" ] &&
      [ "\${22}" = "UPLOAD_API_KEY=secretref:upload-api-key" ] &&
      [ "\${23}" = "-o" ] && [ "\${24}" = "none" ] || argv_error
    case "\${12}" in ui-[0-9]*t[0-9]*-[0-9]*) ;; *) argv_error ;; esac
    [ "$scenario" = "update-failure" ] && exit 44
    :
    ;;
  containerapp:revision)
    [ "$#" -eq 13 ] && [ "$3" = "show" ] &&
      [ "$4" = "--name" ] && [ "$5" = "ui--new" ] &&
      [ "$6" = "--app" ] && [ "$7" = "bmo-deepagent-ui-testseed" ] &&
      [ "$8" = "--resource-group" ] && [ "$9" = "test-resource-group" ] &&
      [ "\${10}" = "--query" ] &&
      [ "\${11}" = "join('|', [properties.provisioningState, properties.runningState])" ] &&
      [ "\${12}" = "-o" ] && [ "\${13}" = "tsv" ] || argv_error
    revision_call_count=0
    if [ -f "$REVISION_CALL_COUNT" ]; then
      IFS= read -r revision_call_count < "$REVISION_CALL_COUNT"
    fi
    revision_call_count=$((revision_call_count + 1))
    printf '%s\\n' "$revision_call_count" > "$REVISION_CALL_COUNT"
    case "$scenario" in
      revision-failed) printf '%s\\n' "Failed|Degraded" ;;
      revision-timeout) printf '%s\\n' "Provisioning|Processing" ;;
      revision-sequence)
        if [ "$revision_call_count" -eq 1 ]; then
          printf '%s\\n' "Provisioning|Processing"
        else
          printf '%s\\n' "Succeeded|Running"
        fi
        ;;
      *) printf '%s\\n' "Succeeded|Running" ;;
    esac
    ;;
  keyvault:show)
    [ "$#" -eq 10 ] &&
      [ "$3" = "--name" ] && [ "$4" = "testvault" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--query" ] && [ "$8" = "properties.vaultUri" ] &&
      [ "$9" = "-o" ] && [ "\${10}" = "tsv" ] || argv_error
    [ "$scenario" = "vault-missing" ] && exit 7
    [ "$scenario" = "empty-vault-uri" ] || printf '%s\\n' "https://testvault.vault.azure.net/"
    ;;
  keyvault:secret)
    [ "$#" -eq 11 ] && [ "$3" = "show" ] &&
      [ "$4" = "--vault-name" ] && [ "$5" = "testvault" ] &&
      [ "$6" = "--name" ] && [ "$7" = "UPLOAD-API-KEY" ] &&
      [ "$8" = "--query" ] && [ "$9" = "id" ] &&
      [ "\${10}" = "-o" ] && [ "\${11}" = "tsv" ] || argv_error
    [ "$scenario" = "upload-secret-missing" ] && exit 8
    [ "$scenario" = "empty-upload-secret-id" ] || \\
      printf '%s\\n' "https://testvault.vault.azure.net/secrets/UPLOAD-API-KEY/version"
    ;;
  *)
    argv_error
    ;;
esac
`;

const fakeCommand = `#!/bin/bash
set -u
{
  printf '%s' "\${0##*/}"
  for argument in "$@"; do
    printf ' <%s>' "$argument"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
exit 0
`;

const fakeRuntime = `#!/bin/bash
set -u
{
  printf '%s' "\${0##*/}"
  for argument in "$@"; do
    printf ' <%s>' "$argument"
  done
  printf '\\n'
} >> "$COMMAND_LOG"

case "\${1:-}:\${2:-}" in
  info:)
    exit "$RUNTIME_INFO_STATUS"
    ;;
  build:*)
    context="\${!#}"
    {
      [ ! -e "$context/.env" ] && printf 'excluded:.env\\n'
      [ ! -e "$context/.env.docker" ] && printf 'excluded:.env.docker\\n'
      [ ! -e "$context/.git" ] && printf 'excluded:.git\\n'
      [ ! -e "$context/.next" ] && printf 'excluded:.next\\n'
      [ ! -e "$context/node_modules" ] && printf 'excluded:node_modules\\n'
      [ -f "$context/Dockerfile" ] && printf 'included:Dockerfile\\n'
      IFS= read -r marker < "$context/public/deployment-version.txt"
      printf 'marker:%s\\n' "$marker"
    } >> "$CONTEXT_AUDIT"
    printf '%s\\n' "$marker" > "$MARKER_CAPTURE"
    exit "$BUILD_STATUS"
    ;;
  login:*)
    IFS= read -r login_stdin || :
    printf '%s' "$login_stdin" > "$RUNTIME_STDIN_LOG"
    exit "$LOGIN_STATUS"
    ;;
  push:*)
    exit "$PUSH_STATUS"
    ;;
esac
exit 64
`;

const fakeCurl = `#!/bin/bash
set -u
{
  printf 'curl'
  for argument in "$@"; do
    printf ' <%s>' "$argument"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
[ "$#" -eq 7 ] &&
  [ "$1" = "--silent" ] && [ "$2" = "--show-error" ] &&
  [ "$3" = "--output" ] && [ "$5" = "--write-out" ] &&
  [ "$6" = "%{http_code}" ] &&
  [ "$7" = "https://ui.example.test/deployment-version.txt" ] || exit 86
[ "$HTTP_SCENARIO" = "curl-failure" ] && exit 47
curl_count=0
if [ -f "$CURL_CALL_COUNT" ]; then
  IFS= read -r curl_count < "$CURL_CALL_COUNT"
fi
curl_count=$((curl_count + 1))
printf '%s\\n' "$curl_count" > "$CURL_CALL_COUNT"
IFS= read -r expected_marker < "$MARKER_CAPTURE"
case "$HTTP_SCENARIO" in
  stale-then-success)
    if [ "$curl_count" -eq 1 ]; then
      printf '%s\\n' stale-marker > "$4"
    else
      printf '%s\\n' "$expected_marker" > "$4"
    fi
    printf '200'
    ;;
  marker-timeout)
    printf '%s\\n' stale-marker > "$4"
    printf '200'
    ;;
  http-error)
    printf '%s\\n' unavailable > "$4"
    printf '503'
    ;;
  *)
    printf '%s\\n' "$expected_marker" > "$4"
    printf '200'
    ;;
esac
`;

const fakeSleep = `#!/bin/bash
set -u
printf 'sleep <%s>\\n' "$1" >> "$COMMAND_LOG"
[ "$#" -eq 1 ] || exit 86
`;

const fakeDate = `#!/bin/bash
set -u
{
  printf 'date'
  for argument in "$@"; do printf ' <%s>' "$argument"; done
  printf '\\n'
} >> "$COMMAND_LOG"
[ "$#" -eq 2 ] && [ "$1" = "-u" ] || exit 86
case "$2" in
  +%Y%m%dT%H%M%SZ) printf '20260811T170000Z\\n' ;;
  +%Y%m%dt%H%M%S) printf '20260811t170000\\n' ;;
  *) exit 86 ;;
esac
`;

const runDeployment = async ({
  scenario = "success",
  dockerEnv = defaultDockerEnv,
  runtimes = ["docker"],
  containerCli = runtimeOverrideUnset,
  outsideCwd = false,
  scriptTransform,
  runtimeInfoStatus = 0,
  buildStatus = 0,
  loginStatus = 0,
  pushStatus = 0,
  httpScenario = "success",
} = {}) => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "container-app-preflight-test-")
  );
  const fixtureRoot = path.join(tempRoot, "ui");

  try {
    const binDir = path.join(fixtureRoot, "bin");
    const scriptsDir = path.join(fixtureRoot, "scripts");
    const deepResearchDir = path.join(tempRoot, "deep-research");
    const outsideDir = path.join(tempRoot, "outside");
    const commandLog = path.join(fixtureRoot, "commands.log");
    const runtimeStdinLog = path.join(fixtureRoot, "runtime-stdin.log");
    const contextAuditPath = path.join(fixtureRoot, "context-audit.log");
    const contextPathLog = path.join(fixtureRoot, "context-path.log");
    const markerCapture = path.join(fixtureRoot, "marker.log");
    const revisionCallCount = path.join(fixtureRoot, "revision-count");
    const curlCallCount = path.join(fixtureRoot, "curl-count");
    const fixtureScriptPath = path.join(
      fixtureRoot,
      "deploy-azure-container-app.sh"
    );
    await mkdir(binDir, { recursive: true });
    await mkdir(scriptsDir);
    await mkdir(deepResearchDir);
    await mkdir(outsideDir);
    await Promise.all([
      copyFile(scriptPath, fixtureScriptPath),
      copyFile(path.join(repoRoot, "env.sh"), path.join(fixtureRoot, "env.sh")),
      copyFile(
        path.join(repoRoot, ".dockerignore"),
        path.join(fixtureRoot, ".dockerignore")
      ),
      copyFile(
        path.join(repoRoot, "Dockerfile"),
        path.join(fixtureRoot, "Dockerfile")
      ),
      copyFile(
        path.join(repoRoot, "scripts/azure-subscription.sh"),
        path.join(scriptsDir, "azure-subscription.sh")
      ),
      copyFile(
        path.join(repoRoot, "scripts/container-runtime.sh"),
        path.join(scriptsDir, "container-runtime.sh")
      ),
    ]);
    for (const directory of ["public", ".git", ".next", "node_modules"]) {
      await mkdir(path.join(fixtureRoot, directory));
    }
    await writeFile(path.join(fixtureRoot, "public", "keep.txt"), "keep\n");
    await writeFile(path.join(fixtureRoot, ".git", "secret"), "excluded\n");
    await writeFile(path.join(fixtureRoot, ".next", "cache"), "excluded\n");
    await writeFile(
      path.join(fixtureRoot, "node_modules", "dependency"),
      "excluded\n"
    );
    if (scriptTransform) {
      const source = await readFile(fixtureScriptPath, "utf8");
      await writeFile(fixtureScriptPath, scriptTransform(source));
    }

    await writeFile(
      path.join(deepResearchDir, "env.sh"),
      `#!/bin/bash
export DEEP_RESEARCH_AGENT_URL="https://deep-env.example.invalid"
`
    );
    await writeFile(
      path.join(fixtureRoot, ".env"),
      `#!/bin/bash
export AZURE_SUBSCRIPTION_ID="${subscriptionId}"
export SEED="testseed"
export RESOURCE_GROUP="test-resource-group"
export ACR_NAME="testregistry"
export KV_NAME="testvault"
export NEXT_PUBLIC_ASSISTANT_ID="env-assistant"
export NEXT_PUBLIC_LANGGRAPH_URL="https://env-backend.invalid"
export CONTAINER_APP_NAME="bmo-deepagent-ui-testseed"
`
    );
    const dockerEnvPath = path.join(fixtureRoot, ".env.docker");
    if (dockerEnv !== false) {
      await writeFile(dockerEnvPath, dockerEnv);
    }
    const dockerEnvBefore = await readFile(dockerEnvPath).catch(() => null);

    const outsideEnvPath = path.join(outsideDir, ".env");
    const outsideDockerEnvPath = path.join(outsideDir, ".env.docker");
    const outsideDockerSentinel = Buffer.from(
      "OUTSIDE_DOCKER_ENV_MUST_NOT_CHANGE\n"
    );
    await writeFile(outsideEnvPath, "return 91\n");
    await writeFile(outsideDockerEnvPath, outsideDockerSentinel);

    const azPath = path.join(binDir, "az");
    await writeFile(azPath, fakeAz);
    await chmod(azPath, 0o755);
    const fakeSources = [
      ["curl", fakeCurl],
      ["sleep", fakeSleep],
      ["date", fakeDate],
      ["node", fakeCommand],
    ];
    for (const [command, source] of fakeSources) {
      const commandPath = path.join(binDir, command);
      await writeFile(commandPath, source);
      await chmod(commandPath, 0o755);
    }
    for (const runtime of runtimes) {
      const runtimePath = path.join(binDir, runtime);
      await writeFile(runtimePath, fakeRuntime);
      await chmod(runtimePath, 0o755);
    }

    for (const [command, target] of [
      ["dirname", "/usr/bin/dirname"],
      ["mv", "/bin/mv"],
      ["mkdir", "/bin/mkdir"],
      ["rm", "/bin/rm"],
      ["cp", "/bin/cp"],
      ["rsync", "/usr/bin/rsync"],
    ]) {
      const commandPath = path.join(binDir, command);
      await writeFile(
        commandPath,
        `#!/bin/bash
{
  printf '${command}'
  for argument in "$@"; do
    printf ' <%s>' "$argument"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
exec ${target} "$@"
`
      );
      await chmod(commandPath, 0o755);
    }

    const mktempPath = path.join(binDir, "mktemp");
    await writeFile(
      mktempPath,
      `#!/bin/bash
{
  printf 'mktemp'
  for argument in "$@"; do printf ' <%s>' "$argument"; done
  printf '\\n'
} >> "$COMMAND_LOG"
created_context=$(/usr/bin/mktemp "$@") || exit $?
printf '%s\\n' "$created_context" > "$CONTEXT_PATH_LOG"
printf '%s\\n' "$created_context"
`
    );
    await chmod(mktempPath, 0o755);

    const environment = {
      PATH: binDir,
      COMMAND_LOG: commandLog,
      AZ_SCENARIO: scenario,
      FAKE_ACR_TOKEN: "super-secret-acr-token",
      REVISION_CALL_COUNT: revisionCallCount,
      CURL_CALL_COUNT: curlCallCount,
      RUNTIME_STDIN_LOG: runtimeStdinLog,
      CONTEXT_AUDIT: contextAuditPath,
      CONTEXT_PATH_LOG: contextPathLog,
      MARKER_CAPTURE: markerCapture,
      RUNTIME_INFO_STATUS: String(runtimeInfoStatus),
      BUILD_STATUS: String(buildStatus),
      LOGIN_STATUS: String(loginStatus),
      PUSH_STATUS: String(pushStatus),
      HTTP_SCENARIO: httpScenario,
      CONTAINER_APP_REVISION_POLL_ATTEMPTS: "2",
      CONTAINER_APP_HTTP_POLL_ATTEMPTS: "2",
      CONTAINER_APP_POLL_INTERVAL_SECONDS: "5",
    };
    if (containerCli !== runtimeOverrideUnset) {
      environment.CONTAINER_CLI = containerCli;
    }

    const result = spawnSync(
      "/bin/bash",
      ["--noprofile", "--norc", fixtureScriptPath],
      {
        cwd: outsideCwd ? outsideDir : fixtureRoot,
        encoding: "utf8",
        env: environment,
      }
    );
    const log = await readFile(commandLog, "utf8").catch(() => "");
    const runtimeStdin = await readFile(runtimeStdinLog, "utf8").catch(
      () => ""
    );
    const contextAudit = await readFile(contextAuditPath, "utf8").catch(
      () => ""
    );
    const createdContext = (
      await readFile(contextPathLog, "utf8").catch(() => "")
    ).trim();
    const contextExistsAfter = createdContext
      ? await access(createdContext)
          .then(() => true)
          .catch(() => false)
      : false;
    if (contextExistsAfter) {
      await rm(createdContext, { recursive: true, force: true });
    }
    const dockerEnvAfter = await readFile(dockerEnvPath).catch(() => null);
    const outsideDockerEnvAfter = await readFile(outsideDockerEnvPath);
    return {
      result,
      log,
      dockerEnvBefore,
      dockerEnvAfter,
      outsideDockerSentinel,
      outsideDockerEnvAfter,
      runtimeStdin,
      contextAudit,
      createdContext,
      contextExistsAfter,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const assertNoMutation = (log) => {
  assert.doesNotMatch(log, /(?:docker|podman) <(?:build|login|push)>/);
  assert.doesNotMatch(log, /container <build>/);
  assert.doesNotMatch(log, /container <registry> <login>/);
  assert.doesNotMatch(log, /container <image> <push>/);
  assert.doesNotMatch(log, /az <acr> <login>/);
  assert.doesNotMatch(log, /az <containerapp> <secret> <set>/);
  assert.doesNotMatch(log, /az <containerapp> <update>/);
  assert.doesNotMatch(log, /az <containerapp> <create>/);
};

test("Azure Container Apps deployment entry point is executable", async () => {
  await access(scriptPath, constants.X_OK);
});

for (const [name, scenario, expectedStatus] of [
  ["successful", "success", 0],
  ["failed", "resource-group-missing", 1],
]) {
  test(`preflight preserves .env.docker bytes after a ${name} run`, async () => {
    const { result, dockerEnvBefore, dockerEnvAfter } = await runDeployment({
      scenario,
    });

    if (expectedStatus === 0) {
      assert.equal(result.status, 0, result.stderr);
    } else {
      assert.notEqual(result.status, 0, result.stdout);
    }
    assert.deepEqual(dockerEnvAfter, dockerEnvBefore);
  });
}

test("preflight succeeds from an unrelated working directory without touching it", async () => {
  const {
    result,
    outsideDockerSentinel,
    outsideDockerEnvAfter,
    dockerEnvBefore,
    dockerEnvAfter,
  } = await runDeployment({ outsideCwd: true });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(outsideDockerEnvAfter, outsideDockerSentinel);
  assert.deepEqual(dockerEnvAfter, dockerEnvBefore);
});

const invalidDockerEnvCases = [
  ["protected override", "RESOURCE_GROUP=attacker\n", /protected/i],
  [
    "export syntax",
    "export NEXT_PUBLIC_ASSISTANT_ID=attacker\n",
    /shell identifier|unsupported/i,
  ],
  [
    "unmatched quote",
    'NEXT_PUBLIC_ASSISTANT_ID="unterminated\n',
    /unmatched quote/i,
  ],
  ["leading-space comment", "  # not supported\n", /unsupported/i],
  ["whitespace-only line", "   \n", /unsupported/i],
];

for (const [name, dockerEnv, expectedError] of invalidDockerEnvCases) {
  test(`preflight rejects .env.docker ${name} before external access`, async () => {
    const { result, log, dockerEnvBefore, dockerEnvAfter } =
      await runDeployment({ dockerEnv });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /\.env\.docker.*line 1/i);
    assert.match(result.stderr, expectedError);
    assert.doesNotMatch(log, /^(?:az|docker|podman|container)\b/m);
    assert.deepEqual(dockerEnvAfter, dockerEnvBefore);
    assertNoMutation(log);
  });
}

test("fake Azure rejects a production-breaking query change", async () => {
  const { result, log } = await runDeployment({
    scriptTransform: (source) =>
      source.replace("--query name", "--query unexpectedGroupQuery"),
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /fake az argv contract violation/i);
  assert.match(log, /<--query> <unexpectedGroupQuery>/);
  assertNoMutation(log);
});

test("preflight rejects a missing container runtime before Azure access", async () => {
  const { result, log } = await runDeployment({ runtimes: [] });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /no supported container runtime/i);
  assert.doesNotMatch(log, /^az\b/m);
  assertNoMutation(log);
});

for (const [name, containerCli, expectedError] of [
  ["invalid", "nerdctl", /CONTAINER_CLI.*container.*podman.*docker/i],
  ["missing", "podman", /requested container runtime.*podman.*PATH/i],
]) {
  test(`preflight rejects an explicit ${name} runtime before Azure access`, async () => {
    const { result, log } = await runDeployment({ containerCli });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, expectedError);
    assert.doesNotMatch(log, /^az\b/m);
    assertNoMutation(log);
  });
}

const preflightFailures = [
  ["resource-group-missing", /resource group/i],
  ["acr-missing", /container registry/i],
  ["empty-acr-login-server", /login server/i],
  ["ui-app-missing", /UI Container App/i],
  ["ui-internal-ingress", /external ingress/i],
  ["ui-missing-fqdn", /public FQDN/i],
  ["wrong-target-port", /target port.*3000/i],
  ["multiple-revision-mode", /single-revision/i],
  ["missing-system-identity", /system-assigned identity/i],
  ["zero-containers", /exactly one.*container/i],
  ["multiple-containers", /exactly one.*container/i],
  ["wrong-acr-registry", /ACR pull configuration/i],
  ["wrong-acr-identity", /system identity/i],
  ["backend-missing", /backend Container App/i],
  ["backend-internal-ingress", /backend.*external ingress/i],
  ["backend-missing-fqdn", /backend.*public FQDN/i],
  ["vault-missing", /Key Vault/i],
  ["empty-vault-uri", /vault URI/i],
  ["upload-secret-missing", /UPLOAD-API-KEY/i],
  ["empty-upload-secret-id", /UPLOAD-API-KEY.*ID/i],
];

for (const [scenario, expectedError] of preflightFailures) {
  test(`preflight rejects ${scenario}`, async () => {
    const { result, log } = await runDeployment({ scenario });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, expectedError);
    assertNoMutation(log);
  });
}

test("preflight selects subscription and discovers canonical endpoints", async () => {
  const { result, log } = await runDeployment();
  const source = await readFile(scriptPath, "utf8");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Container runtime: docker/);
  assert.match(result.stdout, /UI: https:\/\/ui\.example\.test/);
  assert.match(result.stdout, /Backend: https:\/\/backend\.example\.test/);
  assert.match(
    result.stdout,
    /LangGraph URL: https:\/\/backend\.example\.test/
  );
  assert.match(result.stdout, /Assistant ID: docker-assistant/);
  assert.doesNotMatch(result.stdout, /docker-backend\.invalid/);
  assert.match(result.stdout, /preflight complete/i);

  const selection = log.indexOf(
    `az <account> <set> <--subscription> <${subscriptionId}>`
  );
  const groupQuery = log.indexOf("az <group> <show>");
  assert.ok(selection >= 0 && selection < groupQuery, log);
  const runtimeSelection = source.indexOf("select_container_cli");
  const resourceQuery = source.indexOf("az group show");
  assert.ok(
    runtimeSelection >= 0 && runtimeSelection < resourceQuery,
    "runtime selection must precede first Azure resource query"
  );
});

test("deployment builds a clean image and performs exact Azure update", async () => {
  const {
    result,
    log,
    runtimeStdin,
    contextAudit,
    createdContext,
    contextExistsAfter,
  } = await runDeployment();

  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  assert.match(log, /^docker <info>$/m);
  assert.match(
    log,
    new RegExp(
      "^docker <build> <--platform> <linux/amd64> <--progress> <plain> " +
        "<--build-arg> <NEXT_PUBLIC_LANGGRAPH_URL=https://backend\\.example\\.test> " +
        "<--build-arg> <NEXT_PUBLIC_ASSISTANT_ID=docker-assistant> " +
        "<--tag> <testregistry\\.azurecr\\.io/deepagent-ui:latest> <.+>$",
      "m"
    )
  );
  for (const evidence of [
    "excluded:.env",
    "excluded:.env.docker",
    "excluded:.git",
    "excluded:.next",
    "excluded:node_modules",
    "included:Dockerfile",
  ]) {
    assert.match(contextAudit, new RegExp(`^${evidence}$`, "m"));
  }
  assert.match(contextAudit, /^marker:20260811T170000Z-[0-9]+$/m);
  assert.ok(createdContext);
  assert.equal(contextExistsAfter, false);

  assert.equal(runtimeStdin, "super-secret-acr-token");
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}`,
    /super-secret-acr-token/
  );
  assert.match(
    log,
    /^docker <login> <--username> <00000000-0000-0000-0000-000000000000> <--password-stdin> <testregistry\.azurecr\.io>$/m
  );
  assert.match(
    log,
    /^docker <push> <testregistry\.azurecr\.io\/deepagent-ui:latest>$/m
  );
  const push = log.indexOf("docker <push>");
  const previousRevision = log.indexOf(
    "<--query> <properties.latestReadyRevisionName>"
  );
  const secretMutation = log.indexOf("az <containerapp> <secret> <set>");
  assert.ok(
    push >= 0 && push < previousRevision && previousRevision < secretMutation
  );
  assert.match(log, /^az <containerapp> <secret> <set>/m);
  const updateLine = log.match(/^az <containerapp> <update>.*$/m)?.[0] ?? "";
  assert.match(updateLine, /<--container-name> <deepagent-ui>/);
  assert.match(updateLine, /<--revision-suffix> <ui-20260811t170000-[0-9]+>/);
  assert.match(updateLine, /<NEXT_PUBLIC_ASSISTANT_ID=docker-assistant>/);
  assert.doesNotMatch(
    updateLine,
    /<--(?:ingress|target-port|scale|identity|registry|traffic|network|volume)[^>]*>/
  );
  assert.match(log, /^az <containerapp> <revision> <show>/m);
  assert.match(
    log,
    /^curl .*<https:\/\/ui\.example\.test\/deployment-version\.txt>$/m
  );
  assert.match(result.stdout, /deployment complete/i);
});

for (const [name, options, expectedStatus, forbidden] of [
  ["build", { buildStatus: 37 }, 37, /az <acr> <login>/],
  ["token", { scenario: "token-failure" }, 41, /^docker <login>/m],
  ["empty token", { scenario: "empty-token" }, 1, /^docker <login>/m],
  ["login", { loginStatus: 38 }, 38, /^docker <push>/m],
  ["push", { pushStatus: 39 }, 39, /az <containerapp> <secret> <set>/],
]) {
  test(`deployment propagates ${name} failure before application mutation`, async () => {
    const { result, log, contextExistsAfter } = await runDeployment(options);

    assert.equal(result.status, expectedStatus, result.stderr);
    assert.doesNotMatch(log, forbidden);
    assert.doesNotMatch(log, /az <containerapp> <update>/);
    assert.equal(contextExistsAfter, false);
  });
}

for (const [scenario, status, forbidden] of [
  ["secret-set-failure", 43, /az <containerapp> <update>/],
  ["update-failure", 44, /az <containerapp> <revision> <show>/],
]) {
  test(`deployment propagates ${scenario}`, async () => {
    const { result, log } = await runDeployment({ scenario });

    assert.equal(result.status, status, result.stderr);
    assert.doesNotMatch(log, forbidden);
  });
}

for (const [scenario, expectedError] of [
  ["empty-previous-revision", /previous.*revision/i],
  ["unchanged-revision", /new revision.*different/i],
  ["revision-failed", /Failed.*Degraded/i],
  ["revision-timeout", /timed out.*revision/i],
]) {
  test(`deployment rejects ${scenario}`, async () => {
    const { result, log } = await runDeployment({ scenario });

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, expectedError);
    if (scenario === "revision-failed" || scenario === "revision-timeout") {
      assert.doesNotMatch(log, /^curl\b/m);
    }
  });
}

test("deployment waits through provisioning and a stale marker", async () => {
  const { result, log } = await runDeployment({
    scenario: "revision-sequence",
    httpScenario: "stale-then-success",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (log.match(/^az <containerapp> <revision> <show>/gm) ?? []).length,
    2
  );
  assert.equal((log.match(/^curl\b/gm) ?? []).length, 2);
  assert.match(log, /^sleep <5>$/m);
});

for (const [name, httpScenario, expectedStatus, expectedError] of [
  ["marker timeout", "marker-timeout", 1, /marker.*timed out/i],
  ["curl failure", "curl-failure", 47, /HTTP verification/i],
]) {
  test(`deployment reports ${name} without rollback`, async () => {
    const { result, log } = await runDeployment({ httpScenario });

    assert.equal(result.status, expectedStatus, result.stderr);
    assert.match(result.stderr, expectedError);
    assert.doesNotMatch(log, /<--traffic>|<--revision-mode>/);
  });
}
