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
  containerapp:show)
    [ "$#" -eq 10 ] &&
      [ "$3" = "--name" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--query" ] &&
      [ "$9" = "-o" ] && [ "\${10}" = "tsv" ] || argv_error
    name="$4"
    query="$8"

    if [ "$name" = "bmo-deepagent-ui-testseed" ]; then
      expected_query="join('|', [to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn), to_string(properties.configuration.ingress.targetPort), to_string(properties.configuration.activeRevisionsMode), to_string(identity.type), to_string(length(properties.template.containers)), to_string(properties.template.containers[0].name)])"
      [ "$query" = "$expected_query" ] || argv_error
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

const runDeployment = async ({
  scenario = "success",
  dockerEnv = defaultDockerEnv,
  runtimes = ["docker"],
  containerCli = runtimeOverrideUnset,
  outsideCwd = false,
  scriptTransform,
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
        path.join(repoRoot, "scripts/azure-subscription.sh"),
        path.join(scriptsDir, "azure-subscription.sh")
      ),
      copyFile(
        path.join(repoRoot, "scripts/container-runtime.sh"),
        path.join(scriptsDir, "container-runtime.sh")
      ),
    ]);
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

    for (const [command, target] of [
      ["dirname", "/usr/bin/dirname"],
      ["mktemp", "/usr/bin/mktemp"],
      ["mv", "/bin/mv"],
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
      ["--noprofile", "--norc", fixtureScriptPath],
      {
        cwd: outsideCwd ? outsideDir : fixtureRoot,
        encoding: "utf8",
        env: environment,
      }
    );
    const log = await readFile(commandLog, "utf8").catch(() => "");
    const dockerEnvAfter = await readFile(dockerEnvPath).catch(() => null);
    const outsideDockerEnvAfter = await readFile(outsideDockerEnvPath);
    return {
      result,
      log,
      dockerEnvBefore,
      dockerEnvAfter,
      outsideDockerSentinel,
      outsideDockerEnvAfter,
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
  assert.doesNotMatch(log, /^docker\b/m);
  assertNoMutation(log);
});
