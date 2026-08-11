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

case "$command" in
  account:show)
    printf '%s\\n' "$AZURE_SUBSCRIPTION_ID"
    ;;
  account:set)
    [ "\${3:-}" = "--subscription" ] || exit 64
    [ "\${4:-}" = "$AZURE_SUBSCRIPTION_ID" ] || exit 64
    ;;
  group:show)
    [ "$scenario" = "resource-group-missing" ] && exit 3
    printf '%s\\n' "test-resource-group"
    ;;
  acr:show)
    [ "$scenario" = "acr-missing" ] && exit 4
    [ "$scenario" = "empty-acr-login-server" ] || printf '%s\\n' "testregistry.azurecr.io"
    ;;
  containerapp:show)
    name=""
    query=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --name) name="\${2:-}"; shift 2 ;;
        --query) query="\${2:-}"; shift 2 ;;
        *) shift ;;
      esac
    done

    if [ "$name" = "bmo-deepagent-ui-testseed" ]; then
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
    elif [ "$name" = "deep-research-agent-testseed" ]; then
      [ "$scenario" = "backend-missing" ] && exit 6
      external=true
      fqdn=backend.example.test
      [ "$scenario" = "backend-internal-ingress" ] && external=false
      [ "$scenario" = "backend-missing-fqdn" ] && fqdn=null
      printf '%s|%s\\n' "$external" "$fqdn"
    else
      printf 'unexpected Container App name: %s (query: %s)\\n' "$name" "$query" >&2
      exit 64
    fi
    ;;
  containerapp:registry)
    [ "\${3:-}" = "list" ] || exit 64
    case "$scenario" in
      wrong-acr-registry) printf '%s\\n' "other.azurecr.io|system" ;;
      wrong-acr-identity) printf '%s\\n' "testregistry.azurecr.io|user-assigned" ;;
      *) printf '%s\\n' "testregistry.azurecr.io|system" ;;
    esac
    ;;
  keyvault:show)
    [ "$scenario" = "vault-missing" ] && exit 7
    [ "$scenario" = "empty-vault-uri" ] || printf '%s\\n' "https://testvault.vault.azure.net/"
    ;;
  keyvault:secret)
    [ "\${3:-}" = "show" ] || exit 64
    [ "$scenario" = "upload-secret-missing" ] && exit 8
    [ "$scenario" = "empty-upload-secret-id" ] || \\
      printf '%s\\n' "https://testvault.vault.azure.net/secrets/UPLOAD-API-KEY/version"
    ;;
  *)
    printf 'unexpected az command: %s\\n' "$command" >&2
    exit 64
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

const runDeployment = async ({
  scenario = "success",
  dockerEnv = true,
  runtimes = ["docker"],
  containerCli = runtimeOverrideUnset,
} = {}) => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "container-app-preflight-test-")
  );

  try {
    const binDir = path.join(fixtureRoot, "bin");
    const scriptsDir = path.join(fixtureRoot, "scripts");
    const commandLog = path.join(fixtureRoot, "commands.log");
    await mkdir(binDir);
    await mkdir(scriptsDir);
    await Promise.all([
      copyFile(
        scriptPath,
        path.join(fixtureRoot, "deploy-azure-container-app.sh")
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

    await writeFile(
      path.join(fixtureRoot, "env.sh"),
      `#!/bin/bash
export AZURE_SUBSCRIPTION_ID="${subscriptionId}"
export SEED="testseed"
export RESOURCE_GROUP="test-resource-group"
export ACR_NAME="testregistry"
export KV_NAME="testvault"
export NEXT_PUBLIC_ASSISTANT_ID="env-assistant"
export NEXT_PUBLIC_LANGGRAPH_URL="https://env-backend.invalid"
export CONTAINER_APP_NAME="\${CONTAINER_APP_NAME:-bmo-deepagent-ui-$SEED}"
`
    );
    if (dockerEnv) {
      await writeFile(
        path.join(fixtureRoot, ".env.docker"),
        `# Values loaded after env.sh

NEXT_PUBLIC_ASSISTANT_ID='docker-assistant'
NEXT_PUBLIC_LANGGRAPH_URL="https://docker-backend.invalid"\r
`
      );
    }

    const azPath = path.join(binDir, "az");
    await writeFile(azPath, fakeAz);
    await chmod(azPath, 0o755);
    for (const command of ["curl", "rsync", "node", "cp", "sleep", "date"]) {
      const commandPath = path.join(binDir, command);
      await writeFile(commandPath, fakeCommand);
      await chmod(commandPath, 0o755);
    }
    for (const runtime of runtimes) {
      const runtimePath = path.join(binDir, runtime);
      await writeFile(runtimePath, fakeCommand);
      await chmod(runtimePath, 0o755);
    }

    const dirnamePath = path.join(binDir, "dirname");
    await writeFile(
      dirnamePath,
      `#!/bin/bash
{
  printf 'dirname'
  for argument in "$@"; do
    printf ' <%s>' "$argument"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
exec /usr/bin/dirname "$@"
`
    );
    await chmod(dirnamePath, 0o755);

    const environment = {
      PATH: binDir,
      COMMAND_LOG: commandLog,
      AZ_SCENARIO: scenario,
    };
    if (containerCli !== runtimeOverrideUnset) {
      environment.CONTAINER_CLI = containerCli;
    }

    const result = spawnSync(
      "/bin/bash",
      [
        "--noprofile",
        "--norc",
        path.join(fixtureRoot, "deploy-azure-container-app.sh"),
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: environment,
      }
    );
    const log = await readFile(commandLog, "utf8").catch(() => "");
    return { result, log };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
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
  assert.doesNotMatch(log, /^docker\b/m);
  assertNoMutation(log);
});
