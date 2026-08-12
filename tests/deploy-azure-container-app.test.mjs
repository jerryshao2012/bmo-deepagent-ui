import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const scriptPath = path.join(repoRoot, "deploy-azure-container-app.sh");
const resolverPath = path.join(repoRoot, "scripts/resolve-azure-endpoints.sh");
const rbacEvaluatorPath = path.join(
  repoRoot,
  "scripts/evaluate-keyvault-rbac.mjs"
);
const dockerEnvExample = await readFile(
  path.join(repoRoot, ".env.docker.example"),
  "utf8"
);
const subscriptionId = "subscription-container-app-test";
const pinnedImage = "docker.io/jerryshao2013/deepagent-ui:latest";
const deploymentMarker = "20260812T101112Z-4242";
const resolvedBackendUrl =
  "https://deep-research-agent-testseed.env.example.test";
const resolvedUiUrl = "https://bmo-deepagent-ui-testseed.env.example.test";
const deploymentResolverOutput = [
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
const defaultDockerEnv = `# Values loaded after env.sh

NEXT_PUBLIC_ASSISTANT_ID='docker-assistant'
NEXT_PUBLIC_LANGGRAPH_URL="https://ignored.invalid"\r
`;
const defaultManifest = {
  schemaVersion: 1,
  deploymentMarker,
  image: pinnedImage,
  backendUrl: resolvedBackendUrl,
  assistantId: "docker-assistant",
};

const fakeAz = `#!/bin/bash
set -u
for variable_name in LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET SYNTHETIC_SECRET_CANARY NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE; do
  [ -z "\${!variable_name-}" ] || printf 'environment-leak:%s\n' "$variable_name" >> "$COMMAND_LOG"
done
{
  printf 'az'
  for argument in "$@"; do printf ' <%s>' "$argument"; done
  printf '\n'
} >> "$COMMAND_LOG"

scenario="\${AZ_SCENARIO:-success}"
command="\${1:-}:\${2:-}"
user_identity_id="/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/test-resource-group/providers/Microsoft.ManagedIdentity/userAssignedIdentities/test-identity"
expected_identity_principal="system-principal-id"
case "$scenario" in
  user-assigned-identity|multiple-user-assigned-identities|missing-user-assigned-principal)
    expected_identity_principal="user-principal-id"
    ;;
esac
argv_error() { printf 'fake az argv contract violation for %s\n' "$command" >&2; exit 86; }

case "$command" in
  account:show)
    [ "$#" -eq 6 ] && [ "$3" = "--query" ] && [ "$4" = "id" ] &&
      [ "$5" = "-o" ] && [ "$6" = "tsv" ] || argv_error
    printf '%s\n' "$AZURE_SUBSCRIPTION_ID"
    ;;
  account:set)
    [ "$#" -eq 4 ] && [ "$3" = "--subscription" ] &&
      [ "$4" = "$AZURE_SUBSCRIPTION_ID" ] || argv_error
    ;;
  group:show)
    [ "$#" -eq 8 ] && [ "$3" = "--name" ] && [ "$4" = "test-resource-group" ] &&
      [ "$5" = "--query" ] && [ "$6" = "name" ] &&
      [ "$7" = "-o" ] && [ "$8" = "tsv" ] || argv_error
    [ "$scenario" = "resource-group-missing" ] && exit 3
    printf 'test-resource-group\n'
    ;;
  containerapp:show)
    [ "$#" -eq 10 ] && [ "$3" = "--name" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--query" ] && [ "$9" = "-o" ] && [ "\${10}" = "tsv" ] || argv_error
    name="$4"
    query="$8"
    if [ "$name" = "bmo-deepagent-ui-testseed" ]; then
      legacy_details_query="join('|', [to_string(properties.managedEnvironmentId), to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn), to_string(properties.configuration.ingress.targetPort), to_string(properties.configuration.activeRevisionsMode), to_string(identity.type), to_string(identity.principalId), to_string(length(properties.template.containers)), to_string(properties.template.containers[0].name)])"
      managed_details_query="join('|', [to_string(properties.managedEnvironmentId), to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn), to_string(properties.configuration.ingress.targetPort), to_string(properties.configuration.activeRevisionsMode), to_string(identity.type), to_string(identity.principalId), to_string(identity.userAssignedIdentities), to_string(length(properties.template.containers)), to_string(properties.template.containers[0].name)])"
      case "$query" in
        "$legacy_details_query"|"$managed_details_query")
          [ "$scenario" = "ui-app-missing" ] && exit 5
          environment_id=/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/test-resource-group/providers/Microsoft.App/managedEnvironments/test-environment
          external=true; fqdn=bmo-deepagent-ui-testseed.env.example.test; target_port=3000; mode=Single
          identity=SystemAssigned; principal_id=system-principal-id
          user_identities_json=null
          count=1; container_name=deepagent-ui
          case "$scenario" in
            ui-internal-ingress) external=false ;;
            ui-missing-fqdn) fqdn=null ;;
            ui-fqdn-drift) fqdn=other-ui.env.example.test ;;
            ui-environment-drift) environment_id=/subscriptions/other/resourceGroups/test-resource-group/providers/Microsoft.App/managedEnvironments/test-environment ;;
            wrong-target-port) target_port=8080 ;;
            multiple-revision-mode) mode=Multiple ;;
            missing-managed-identity) identity=None; principal_id=null ;;
            missing-system-principal) principal_id=null ;;
            user-assigned-identity)
              identity=UserAssigned; principal_id=null
              user_identities_json='{"'"$user_identity_id"'":{"principalId":"user-principal-id"}}'
              ;;
            multiple-user-assigned-identities)
              identity=UserAssigned; principal_id=null
              user_identities_json='{"'"$user_identity_id"'":{"principalId":"user-principal-id"},"/subscriptions/test/resourceGroups/test-resource-group/providers/Microsoft.ManagedIdentity/userAssignedIdentities/other-identity":{"principalId":"other-principal-id"}}'
              ;;
            missing-user-assigned-principal)
              identity=UserAssigned; principal_id=null
              user_identities_json='{"'"$user_identity_id"'":{"principalId":null}}'
              ;;
            zero-containers) count=0; container_name= ;;
            multiple-containers) count=2 ;;
          esac
          if [ "$query" = "$managed_details_query" ]; then
            printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$environment_id" "$external" "$fqdn" "$target_port" "$mode" "$identity" "$principal_id" "$user_identities_json" "$count" "$container_name"
          else
            printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' "$environment_id" "$external" "$fqdn" "$target_port" "$mode" "$identity" "$principal_id" "$count" "$container_name"
          fi
          ;;
        properties.latestReadyRevisionName)
          case "$scenario" in
            empty-previous-revision) ;;
            unchanged-revision) printf 'bmo-deepagent-ui-testseed--ui-20260812t101112-%s\n' "$PPID" ;;
            *) printf 'ui--previous\n' ;;
          esac
          ;;
        *) argv_error ;;
      esac
    elif [ "$name" = "deep-research-agent-testseed" ]; then
      [ "$query" = "join('|', [to_string(properties.managedEnvironmentId), to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn)])" ] || argv_error
      [ "$scenario" = "backend-missing" ] && exit 6
      environment_id=/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/test-resource-group/providers/Microsoft.App/managedEnvironments/test-environment
      external=true; fqdn=deep-research-agent-testseed.env.example.test
      [ "$scenario" = "backend-internal-ingress" ] && external=false
      [ "$scenario" = "backend-missing-fqdn" ] && fqdn=null
      [ "$scenario" = "backend-drift" ] && fqdn=changed-backend.example.test
      [ "$scenario" = "backend-environment-drift" ] && environment_id=/subscriptions/other/resourceGroups/test-resource-group/providers/Microsoft.App/managedEnvironments/test-environment
      printf '%s|%s|%s\n' "$environment_id" "$external" "$fqdn"
    else
      argv_error
    fi
    ;;
  containerapp:secret)
    subcommand="\${3:-}"
    case "$subcommand" in
      list)
        [ "$#" -eq 11 ] && [ "$4" = "--name" ] && [ "$5" = "bmo-deepagent-ui-testseed" ] &&
          [ "$6" = "--resource-group" ] && [ "$7" = "test-resource-group" ] &&
          [ "$8" = "--query" ] && [ "$9" = "[].[name, keyVaultUrl, identity]" ] &&
          [ "\${10}" = "-o" ] && [ "\${11}" = "tsv" ] || argv_error
        [ "$scenario" = "docker-secret-list-cli-failure" ] && exit 49
        case "$scenario" in
          docker-secret-missing) printf 'unrelated\thttps://other/secrets/value\tsystem\n' ;;
          docker-secret-versioned) printf 'docker-hub-pat\thttps://testvault.vault.azure.net/secrets/DOCKER-HUB-PAT/version\tsystem\n' ;;
          docker-secret-wrong-vault) printf 'docker-hub-pat\thttps://other.vault.azure.net/secrets/DOCKER-HUB-PAT\tsystem\n' ;;
          docker-secret-wrong-identity) printf 'docker-hub-pat\thttps://testvault.vault.azure.net/secrets/DOCKER-HUB-PAT\tuser-assigned\n' ;;
          user-assigned-identity|multiple-user-assigned-identities|missing-user-assigned-principal)
            printf 'docker-hub-pat\thttps://testvault.vault.azure.net/secrets/DOCKER-HUB-PAT\t%s\n' "$user_identity_id"
            printf 'unrelated\thttps://other/secrets/value\tsystem\n'
            ;;
          *)
            printf 'docker-hub-pat\thttps://testvault.vault.azure.net/secrets/DOCKER-HUB-PAT\tsystem\n'
            printf 'unrelated\thttps://other/secrets/value\tsystem\n'
            ;;
        esac
        ;;
      set)
        identity_ref=system
        [ "$scenario" = "user-assigned-identity" ] && identity_ref="$user_identity_id"
        [ "$#" -eq 12 ] && [ "$4" = "--name" ] && [ "$5" = "bmo-deepagent-ui-testseed" ] &&
          [ "$6" = "--resource-group" ] && [ "$7" = "test-resource-group" ] &&
          [ "$8" = "--secrets" ] &&
          [ "$9" = "upload-api-key=keyvaultref:https://testvault.vault.azure.net/secrets/UPLOAD-API-KEY,identityref:$identity_ref" ] &&
          [ "\${10}" = "passkey-proxy-secret=keyvaultref:https://testvault.vault.azure.net/secrets/PASSKEY-PROXY-SECRET,identityref:$identity_ref" ] &&
          [ "\${11}" = "-o" ] && [ "\${12}" = "none" ] || argv_error
        [ "$scenario" = "secret-set-failure" ] && exit 43
        :
        ;;
      *) argv_error ;;
    esac
    ;;
  containerapp:registry)
    [ "$#" -eq 11 ] && [ "$3" = "list" ] &&
      [ "$4" = "--name" ] && [ "$5" = "bmo-deepagent-ui-testseed" ] &&
      [ "$6" = "--resource-group" ] && [ "$7" = "test-resource-group" ] &&
      [ "$8" = "--query" ] && [ "$9" = "[].[server, username, passwordSecretRef]" ] &&
      [ "\${10}" = "-o" ] && [ "\${11}" = "tsv" ] || argv_error
    [ "$scenario" = "docker-registry-list-cli-failure" ] && exit 50
    case "$scenario" in
      docker-registry-missing) printf 'other.example.test\tother\tother-secret\n' ;;
      docker-registry-wrong-username) printf 'docker.io\tattacker\tdocker-hub-pat\n' ;;
      docker-registry-wrong-secret) printf 'docker.io\tjerryshao2013\twrong-secret\n' ;;
      *)
        printf 'docker.io\tjerryshao2013\tdocker-hub-pat\n'
        printf 'other.example.test\tother\tother-secret\n'
        ;;
    esac
    ;;
  containerapp:update)
    [ "$#" -eq 28 ] && [ "$3" = "--name" ] && [ "$4" = "bmo-deepagent-ui-testseed" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--container-name" ] && [ "$8" = "deepagent-ui" ] &&
      [ "$9" = "--image" ] && [ "\${10}" = "docker.io/jerryshao2013/deepagent-ui:latest" ] &&
      [ "\${11}" = "--revision-suffix" ] && [ "\${13}" = "--set-env-vars" ] &&
      [ "\${14}" = "NEXT_TELEMETRY_DISABLED=1" ] &&
      [ "\${15}" = "NEXT_PUBLIC_LANGGRAPH_URL=https://deep-research-agent-testseed.env.example.test" ] &&
      [ "\${16}" = "BACKEND_API_URL=https://deep-research-agent-testseed.env.example.test" ] &&
      [ "\${17}" = "NEXT_PUBLIC_ASSISTANT_ID=docker-assistant" ] &&
      [ "\${18}" = "AUTH_URL=https://bmo-deepagent-ui-testseed.env.example.test" ] &&
      [ "\${19}" = "NEXTAUTH_URL=https://bmo-deepagent-ui-testseed.env.example.test" ] &&
      [ "\${20}" = "AUTH_TRUST_HOST=true" ] && [ "\${21}" = "NODE_ENV=production" ] &&
      [ "\${22}" = "UPLOAD_API_KEY=secretref:upload-api-key" ] &&
      [ "\${23}" = "PASSKEY_ENABLED=true" ] &&
      [ "\${24}" = "PASSKEY_ORIGIN=https://bmo-deepagent-ui-testseed.env.example.test" ] &&
      [ "\${25}" = "PASSKEY_PROXY_ID=web-bff" ] &&
      [ "\${26}" = "PASSKEY_PROXY_SECRET=secretref:passkey-proxy-secret" ] &&
      [ "\${27}" = "-o" ] && [ "\${28}" = "none" ] || argv_error
    case "\${12}" in ui-[0-9]*t[0-9]*-[0-9]*) ;; *) argv_error ;; esac
    printf 'bmo-deepagent-ui-testseed--%s\n' "\${12}" > "$EXPECTED_REVISION_NAME"
    [ "$scenario" = "update-failure" ] && exit 44
    :
    ;;
  containerapp:revision)
    [ "$#" -eq 13 ] && [ "$3" = "show" ] &&
      [ "$4" = "--name" ] && [ "$5" = "bmo-deepagent-ui-testseed" ] &&
      [ "$6" = "--revision" ] && IFS= read -r expected_revision < "$EXPECTED_REVISION_NAME" && [ "$7" = "$expected_revision" ] &&
      [ "$8" = "--resource-group" ] && [ "$9" = "test-resource-group" ] &&
      [ "\${10}" = "--query" ] &&
      [ "\${11}" = "join('|', [properties.provisioningState, properties.runningState, properties.healthState])" ] &&
      [ "\${12}" = "-o" ] && [ "\${13}" = "tsv" ] || argv_error
    count=0; [ ! -f "$REVISION_COUNT" ] || IFS= read -r count < "$REVISION_COUNT"
    count=$((count + 1)); printf '%s\n' "$count" > "$REVISION_COUNT"
    case "$scenario" in
      revision-failed) printf 'Failed|Degraded|Unhealthy\n' ;;
      revision-timeout) printf 'Provisioning|Processing|Unknown\n' ;;
      revision-unhealthy) printf 'Provisioned|Running|Unhealthy\n' ;;
      revision-sequence) [ "$count" -eq 1 ] && printf 'Provisioning|Processing|Unknown\n' || printf 'Provisioned|Running|Healthy\n' ;;
      *) printf 'Provisioned|Running|Healthy\n' ;;
    esac
    ;;
  keyvault:show)
    [ "$#" -eq 10 ] && [ "$3" = "--name" ] && [ "$4" = "testvault" ] &&
      [ "$5" = "--resource-group" ] && [ "$6" = "test-resource-group" ] &&
      [ "$7" = "--query" ] && [ "$8" = "join('|', [properties.vaultUri, id, to_string(properties.enableRbacAuthorization), to_string(length(properties.accessPolicies[?objectId=='$expected_identity_principal' && (contains(permissions.secrets, 'get') || contains(permissions.secrets, 'all'))]))])" ] &&
      [ "$9" = "-o" ] && [ "\${10}" = "tsv" ] || argv_error
    [ "$scenario" = "vault-missing" ] && exit 7
    rbac=true; policy_count=0
    [ "$scenario" = "access-policy-secret-get" ] && rbac=false && policy_count=1
    [ "$scenario" = "empty-vault-uri" ] || printf 'https://testvault.vault.azure.net/|/subscriptions/test/resourceGroups/test-resource-group/providers/Microsoft.KeyVault/vaults/testvault|%s|%s\n' "$rbac" "$policy_count"
    ;;
  keyvault:secret)
    [ "$#" -eq 11 ] && [ "$3" = "show" ] &&
      [ "$4" = "--vault-name" ] && [ "$5" = "testvault" ] &&
      [ "$6" = "--name" ] && [ "$8" = "--query" ] && [ "$9" = "id" ] &&
      [ "\${10}" = "-o" ] && [ "\${11}" = "tsv" ] || argv_error
    case "$7:$scenario" in
      DOCKER-HUB-PAT:docker-pat-show-cli-failure) exit 48 ;;
      UPLOAD-API-KEY:upload-secret-missing|DOCKER-HUB-PAT:docker-pat-missing|PASSKEY-PROXY-SECRET:passkey-secret-missing) exit 8 ;;
      UPLOAD-API-KEY:empty-upload-secret-id|DOCKER-HUB-PAT:empty-docker-pat-id|PASSKEY-PROXY-SECRET:empty-passkey-secret-id) ;;
      UPLOAD-API-KEY:*) printf 'https://testvault.vault.azure.net/secrets/UPLOAD-API-KEY/version\n' ;;
      DOCKER-HUB-PAT:*) printf 'https://testvault.vault.azure.net/secrets/DOCKER-HUB-PAT/version\n' ;;
      PASSKEY-PROXY-SECRET:*) printf 'https://testvault.vault.azure.net/secrets/PASSKEY-PROXY-SECRET/version\n' ;;
      *) argv_error ;;
    esac
    ;;
  role:assignment)
    [ "$#" -eq 12 ] && [ "$3" = "list" ] &&
      [ "$4" = "--assignee-object-id" ] && [ "$5" = "$expected_identity_principal" ] &&
      [ "$6" = "--scope" ] && [ "$7" = "/subscriptions/test/resourceGroups/test-resource-group/providers/Microsoft.KeyVault/vaults/testvault" ] &&
      [ "$8" = "--include-inherited" ] && [ "$9" = "--query" ] &&
      [ "\${10}" = "[].roleDefinitionId" ] &&
      [ "\${11}" = "-o" ] && [ "\${12}" = "tsv" ] || argv_error
    [ "$scenario" = "missing-keyvault-access" ] || printf '/subscriptions/test/providers/Microsoft.Authorization/roleDefinitions/custom-secret-reader\n'
    ;;
  role:definition)
    [ "$#" -eq 7 ] && [ "$3" = "list" ] &&
      [ "$4" = "--name" ] && [ "$5" = "/subscriptions/test/providers/Microsoft.Authorization/roleDefinitions/custom-secret-reader" ] &&
      [ "$6" = "-o" ] && [ "$7" = "json" ] || argv_error
    case "$scenario" in
      role-owner-actions-only) printf '[{"permissions":[{"actions":["*"],"notActions":[],"dataActions":[],"notDataActions":[]}]}]\n' ;;
      role-contributor) printf '[{"permissions":[{"actions":["Microsoft.KeyVault/vaults/*"],"notActions":[],"dataActions":[],"notDataActions":[]}]}]\n' ;;
      role-data-action-excluded) printf '[{"permissions":[{"actions":[],"notActions":[],"dataActions":["Microsoft.KeyVault/vaults/secrets/*"],"notDataActions":["Microsoft.KeyVault/vaults/secrets/read"]}]}]\n' ;;
      role-data-actions-wildcard) printf '[{"permissions":[{"actions":[],"notActions":[],"dataActions":["*"],"notDataActions":[]}]}]\n' ;;
      role-malformed) printf '[{"permissions":"unknown"}]\n' ;;
      role-secrets-user) printf '[{"permissions":[{"actions":[],"notActions":[],"dataActions":["Microsoft.KeyVault/vaults/secrets/readMetadata/action","Microsoft.KeyVault/vaults/secrets/read"],"notDataActions":[]}]}]\n' ;;
      *) printf '[{"permissions":[{"actions":[],"notActions":[],"dataActions":["Microsoft.KeyVault/vaults/secrets/read"],"notDataActions":[]}]}]\n' ;;
    esac
    ;;
  *) argv_error ;;
esac
`;

const fakeCurl = `#!/bin/bash
set -u
for variable_name in LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET SYNTHETIC_SECRET_CANARY NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE; do
  [ -z "\${!variable_name-}" ] || printf 'environment-leak:%s\n' "$variable_name" >> "$COMMAND_LOG"
done
{
  printf 'curl'
  for argument in "$@"; do printf ' <%s>' "$argument"; done
  printf '\n'
} >> "$COMMAND_LOG"
[ "$#" -eq 11 ] && [ "$1" = "--silent" ] && [ "$2" = "--show-error" ] &&
  [ "$3" = "--connect-timeout" ] && [ "$4" = "10" ] &&
  [ "$5" = "--max-time" ] && [ "$6" = "30" ] && [ "$7" = "--output" ] &&
  [ "$9" = "--write-out" ] && [ "\${10}" = "%{http_code}" ] &&
  [ "\${11}" = "https://bmo-deepagent-ui-testseed.env.example.test/deployment-version.txt" ] || exit 86
count=0; [ ! -f "$CURL_COUNT" ] || IFS= read -r count < "$CURL_COUNT"
count=$((count + 1)); printf '%s\n' "$count" > "$CURL_COUNT"
[ "$HTTP_SCENARIO" = "curl-failure" ] && exit 47
[ "$HTTP_SCENARIO" = "curl-transient" ] && [ "$count" -eq 1 ] && exit 47
case "$HTTP_SCENARIO" in
  stale-then-success) [ "$count" -eq 1 ] && printf 'stale\n' > "$8" || printf '%s\n' "$EXPECTED_MARKER" > "$8"; printf '200' ;;
  marker-timeout) printf 'stale\n' > "$8"; printf '200' ;;
  marker-plus-extra) printf '%s\nextra\n' "$EXPECTED_MARKER" > "$8"; printf '200' ;;
  *) printf '%s\n' "$EXPECTED_MARKER" > "$8"; printf '200' ;;
esac
`;

const runDeployment = async ({
  scenario = "success",
  dockerEnv = defaultDockerEnv,
  manifest = defaultManifest,
  manifestBytes,
  outsideCwd = false,
  httpScenario = "success",
  revisionPollAttempts = "2",
  httpPollAttempts = "2",
  pollIntervalSeconds = "5",
  inheritedEnv = {},
  uiEnvExtra = "",
  xtrace = false,
  endpointResolverOutput = deploymentResolverOutput,
  endpointResolverStatus = 0,
  oauthRedirectsConfirmed = true,
} = {}) => {
  const tempRoot = await mkdtemp(
    path.join(tmpdir(), "container-app-deploy-test-")
  );
  const fixtureRoot = path.join(tempRoot, "ui");
  const backendRoot = path.join(tempRoot, "deep-research");
  const outsideRoot = path.join(tempRoot, "outside");
  const binDir = path.join(fixtureRoot, "bin");
  const scriptsDir = path.join(fixtureRoot, "scripts");
  const commandLog = path.join(fixtureRoot, "commands.log");
  const revisionCount = path.join(fixtureRoot, "revision-count");
  const expectedRevisionName = path.join(fixtureRoot, "expected-revision-name");
  const resolverCallCount = path.join(fixtureRoot, "resolver-call-count");
  const curlCount = path.join(fixtureRoot, "curl-count");
  const controlSentinel = path.join(
    fixtureRoot,
    "must-not-run-docker-env-control"
  );
  const nodeOptionsPayload = path.join(fixtureRoot, "docker-env-control.cjs");
  try {
    await mkdir(binDir, { recursive: true });
    await mkdir(scriptsDir);
    await mkdir(backendRoot);
    await mkdir(outsideRoot);
    await writeFile(
      nodeOptionsPayload,
      `require("node:fs").writeFileSync(${JSON.stringify(
        controlSentinel
      )}, "executed\\n");\n`
    );
    await Promise.all([
      copyFile(
        scriptPath,
        path.join(fixtureRoot, "deploy-azure-container-app.sh")
      ),
      copyFile(path.join(repoRoot, "env.sh"), path.join(fixtureRoot, "env.sh")),
      copyFile(
        path.join(repoRoot, "scripts/azure-subscription.sh"),
        path.join(scriptsDir, "azure-subscription.sh")
      ),
      copyFile(
        path.join(repoRoot, "scripts/sanitize-passkey-dotenv.mjs"),
        path.join(scriptsDir, "sanitize-passkey-dotenv.mjs")
      ),
      copyFile(
        rbacEvaluatorPath,
        path.join(scriptsDir, "evaluate-keyvault-rbac.mjs")
      ),
    ]);
    await writeFile(
      path.join(scriptsDir, "resolve-azure-endpoints.sh"),
      `#!/bin/bash
printf 'resolver' >> "$COMMAND_LOG"
for argument in "$@"; do printf ' <%s>' "$argument" >> "$COMMAND_LOG"; done
printf '\n' >> "$COMMAND_LOG"
count=0
[ ! -f "$RESOLVER_CALL_COUNT" ] || IFS= read -r count < "$RESOLVER_CALL_COUNT"
count=$((count + 1)); printf '%s\n' "$count" > "$RESOLVER_CALL_COUNT"
output="$ENDPOINT_RESOLVER_OUTPUT"
if [ -n "\${RESOLVER_DRIFT_AFTER_CALL:-}" ] && [ "$count" -ge "$RESOLVER_DRIFT_AFTER_CALL" ]; then
  output="\${output//env.example.test/drift.example.test}"
fi
changed=false
case "$output" in *"CHANGED='true'"*) changed=true ;; esac
if [ "$changed" = true ]; then
  printf '%s\n' 'ACTION REQUIRED: update and verify Google/GitHub OAuth provider settings before deployment.' >&2
else
  printf '%s\n' 'OAuth provider reminder: verify the following URLs remain configured.' >&2
fi
printf '%s\n' \
  'Google authorized redirect URI: https://deep-research-agent-testseed.env.example.test/auth/callback/google' \
  'GitHub authorization callback URL: https://deep-research-agent-testseed.env.example.test/auth/callback/github' \
  'GitHub homepage / frontend origin: https://bmo-deepagent-ui-testseed.env.example.test' >&2
printf '%s\n' "$output"
exit "$ENDPOINT_RESOLVER_STATUS"
`
    );
    await chmod(path.join(scriptsDir, "resolve-azure-endpoints.sh"), 0o755);
    await writeFile(
      path.join(backendRoot, "env.sh"),
      'export DEEP_RESEARCH_AGENT_URL="https://env-backend.invalid"\n'
    );
    await writeFile(
      path.join(fixtureRoot, ".env"),
      `export AZURE_SUBSCRIPTION_ID="${subscriptionId}"
export SEED="testseed"
export RESOURCE_GROUP="test-resource-group"
export KV_NAME="testvault"
export ENV_NAME="test-environment"
export CONTAINER_APP_NAME="bmo-deepagent-ui-testseed"
export BACKEND_APP_NAME="deep-research-agent-testseed"
export UI_APP_NAME="bmo-deepagent-ui-testseed"
export NEXT_PUBLIC_ASSISTANT_ID="env-assistant"
${uiEnvExtra}
`
    );
    if (dockerEnv !== false)
      await writeFile(
        path.join(fixtureRoot, ".env.docker"),
        dockerEnv.replaceAll("__NODE_OPTIONS_PAYLOAD__", nodeOptionsPayload)
      );
    const dockerEnvPath = path.join(fixtureRoot, ".env.docker");
    const dockerEnvBefore = await readFile(dockerEnvPath).catch(() => null);
    if (manifest !== false) {
      await writeFile(
        path.join(fixtureRoot, ".deployment-build.json"),
        manifestBytes ?? `${JSON.stringify(manifest)}\n`
      );
    }
    const outsideSentinel = Buffer.from("OUTSIDE MUST STAY\n");
    await writeFile(path.join(outsideRoot, ".env.docker"), outsideSentinel);

    for (const [name, source] of [
      ["az", fakeAz],
      ["curl", fakeCurl],
      [
        "sleep",
        '#!/bin/bash\nprintf \'sleep <%s>\\n\' "$1" >> "$COMMAND_LOG"\n',
      ],
      [
        "date",
        '#!/bin/bash\nprintf \'date\' >> "$COMMAND_LOG"\nfor argument in "$@"; do printf \' <%s>\' "$argument" >> "$COMMAND_LOG"; done\nprintf \'\\n\' >> "$COMMAND_LOG"\n[ "$#" -eq 2 ] && [ "$1" = "-u" ] && [ "$2" = "+%Y%m%dt%H%M%S" ] || exit 86\nprintf \'20260812t101112\\n\'\n',
      ],
      [
        "node",
        `#!/bin/bash
for variable_name in LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET SYNTHETIC_SECRET_CANARY NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE; do
  [ -z "\${!variable_name-}" ] || printf 'environment-leak:%s\\n' "$variable_name" >> "$COMMAND_LOG"
done
exec ${process.execPath} "$@"
`,
      ],
      ["dirname", '#!/bin/bash\nexec /usr/bin/dirname "$@"\n'],
      ["rm", '#!/bin/bash\nexec /bin/rm "$@"\n'],
      ["mktemp", '#!/bin/bash\nexec /usr/bin/mktemp "$@"\n'],
    ]) {
      const commandPath = path.join(binDir, name);
      await writeFile(commandPath, source);
      await chmod(commandPath, 0o755);
    }
    const env = {
      PATH: binDir,
      COMMAND_LOG: commandLog,
      AZ_SCENARIO: scenario,
      REVISION_COUNT: revisionCount,
      EXPECTED_REVISION_NAME: expectedRevisionName,
      RESOLVER_CALL_COUNT: resolverCallCount,
      CURL_COUNT: curlCount,
      HTTP_SCENARIO: httpScenario,
      EXPECTED_MARKER: deploymentMarker,
      ENDPOINT_RESOLVER_OUTPUT: endpointResolverOutput,
      ENDPOINT_RESOLVER_STATUS: String(endpointResolverStatus),
      CONTAINER_APP_REVISION_POLL_ATTEMPTS: revisionPollAttempts,
      CONTAINER_APP_HTTP_POLL_ATTEMPTS: httpPollAttempts,
      CONTAINER_APP_POLL_INTERVAL_SECONDS: pollIntervalSeconds,
      ...Object.fromEntries(
        Object.entries(inheritedEnv).map(([key, value]) => [
          key,
          value.replaceAll("__NODE_OPTIONS_PAYLOAD__", nodeOptionsPayload),
        ])
      ),
    };
    if (oauthRedirectsConfirmed) env.OAUTH_REDIRECTS_CONFIRMED = "true";
    const result = spawnSync(
      "/bin/bash",
      [
        "--noprofile",
        "--norc",
        ...(xtrace ? ["-x"] : []),
        path.join(fixtureRoot, "deploy-azure-container-app.sh"),
      ],
      { cwd: outsideCwd ? outsideRoot : fixtureRoot, encoding: "utf8", env }
    );
    const log = await readFile(commandLog, "utf8").catch(() => "");
    const dockerEnvAfter = await readFile(dockerEnvPath).catch(() => null);
    const outsideAfter = await readFile(path.join(outsideRoot, ".env.docker"));
    const controlSentinelExists = await access(controlSentinel)
      .then(() => true)
      .catch(() => false);
    return {
      result,
      log,
      dockerEnvBefore,
      dockerEnvAfter,
      outsideSentinel,
      outsideAfter,
      controlSentinelExists,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const assertNoAppMutation = (log) => {
  assert.doesNotMatch(log, /az <containerapp> <secret> <set>/);
  assert.doesNotMatch(log, /az <containerapp> <update>/);
  assert.doesNotMatch(log, /az <containerapp> <create>/);
};

const assertNoPermissionMutation = (log) => {
  assert.doesNotMatch(log, /az <role> <assignment> <(?:create|delete)>/);
  assert.doesNotMatch(log, /az <keyvault> <(?:set-policy|delete-policy)>/);
  assert.doesNotMatch(log, /az <containerapp> <identity> <(?:assign|remove)>/);
};

for (const [name, permissions, expected] of [
  [
    "Key Vault Secrets User",
    [
      {
        actions: [],
        notActions: [],
        dataActions: [
          "Microsoft.KeyVault/vaults/secrets/readMetadata/action",
          "Microsoft.KeyVault/vaults/secrets/read",
        ],
        notDataActions: [],
      },
    ],
    true,
  ],
  [
    "custom exact data action",
    [
      {
        actions: [],
        notActions: [],
        dataActions: ["Microsoft.KeyVault/vaults/secrets/read"],
        notDataActions: [],
      },
    ],
    true,
  ],
  [
    "custom exact get data action",
    [
      {
        actions: [],
        notActions: [],
        dataActions: ["Microsoft.KeyVault/vaults/secrets/get"],
        notDataActions: [],
      },
    ],
    true,
  ],
  [
    "data action wildcard",
    [
      {
        actions: [],
        notActions: [],
        dataActions: ["*"],
        notDataActions: [],
      },
    ],
    true,
  ],
  [
    "Owner management actions",
    [
      {
        actions: ["*"],
        notActions: [],
        dataActions: [],
        notDataActions: [],
      },
    ],
    false,
  ],
  [
    "Contributor management actions",
    [
      {
        actions: ["Microsoft.KeyVault/vaults/*"],
        notActions: [],
        dataActions: [],
        notDataActions: [],
      },
    ],
    false,
  ],
  [
    "excluded broad data action",
    [
      {
        actions: [],
        notActions: [],
        dataActions: ["Microsoft.KeyVault/vaults/secrets/*"],
        notDataActions: ["Microsoft.KeyVault/vaults/secrets/read"],
      },
    ],
    false,
  ],
]) {
  test(`RBAC evaluator treats ${name} as secret-read=${expected}`, () => {
    const result = spawnSync(process.execPath, [rbacEvaluatorPath], {
      input: JSON.stringify([{ permissions }]),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${expected}\n`);
  });
}

test("RBAC evaluator fails closed for malformed role definitions", () => {
  const result = spawnSync(process.execPath, [rbacEvaluatorPath], {
    input: JSON.stringify([{ permissions: "unknown" }]),
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /invalid role definition response/i);
});

test("Azure Container Apps deployment entry point is executable", async () => {
  await access(scriptPath, constants.X_OK);
});

test("changed endpoints print exact OAuth values and block mutation without process-local confirmation", async () => {
  const { result, log } = await runDeployment({
    oauthRedirectsConfirmed: false,
  });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(
    result.stderr,
    /ACTION REQUIRED: update and verify Google\/GitHub OAuth provider settings before deployment\./
  );
  assert.match(
    result.stderr,
    /Google authorized redirect URI: https:\/\/deep-research-agent-testseed\.env\.example\.test\/auth\/callback\/google/
  );
  assert.match(
    result.stderr,
    /GitHub authorization callback URL: https:\/\/deep-research-agent-testseed\.env\.example\.test\/auth\/callback\/github/
  );
  assert.match(
    result.stderr,
    /GitHub homepage \/ frontend origin: https:\/\/bmo-deepagent-ui-testseed\.env\.example\.test/
  );
  assert.match(result.stderr, /OAUTH_REDIRECTS_CONFIRMED=true/);
  assertNoAppMutation(log);
});

test("unchanged endpoint reminder is nonblocking without OAuth confirmation", async () => {
  const { result, log } = await runDeployment({
    oauthRedirectsConfirmed: false,
    endpointResolverOutput: deploymentResolverOutput.replace(
      "CHANGED='true'",
      "CHANGED='false'"
    ),
  });
  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  assert.match(
    result.stderr,
    /OAuth provider reminder: verify the following URLs remain configured\./
  );
});

test("deployment strictly decodes resolver output and preserves resolver status", async () => {
  for (const output of [
    `${deploymentResolverOutput}\nUNKNOWN='value'`,
    deploymentResolverOutput.replace(
      "BACKEND_URL=",
      "BACKEND_URL='duplicate'\nBACKEND_URL="
    ),
    deploymentResolverOutput.replace("CHANGED='true'", "CHANGED=true"),
  ]) {
    const { result, log } = await runDeployment({
      endpointResolverOutput: output,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /resolver.*(?:invalid|unknown|duplicate)/i);
    assert.doesNotMatch(log, /^az\b/m);
    assertNoAppMutation(log);
  }
  const failed = await runDeployment({ endpointResolverStatus: 73 });
  assert.equal(failed.result.status, 73, failed.result.stderr);
  assert.doesNotMatch(failed.log, /^az\b/m);
});

test("manifest backend must match resolver before Azure or app mutation", async () => {
  const output = deploymentResolverOutput.replaceAll(
    resolvedBackendUrl,
    "https://changed-backend.example.test"
  );
  const { result, log } = await runDeployment({
    endpointResolverOutput: output,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest backend URL drift/i);
  assert.doesNotMatch(log, /^az\b/m);
  assertNoAppMutation(log);
});

test("deployment configures managed passkey secret and runtime then records endpoints after exact health success", async () => {
  const { result, log } = await runDeployment();
  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  const firstResolve = log.indexOf("resolver\n");
  const secretSet = log.indexOf("az <containerapp> <secret> <set>");
  const update = log.indexOf("az <containerapp> <update>");
  const ready = log.indexOf("az <containerapp> <revision> <show>");
  const health = log.indexOf("curl <");
  const finalCompare = log.lastIndexOf("resolver\n");
  const record = log.lastIndexOf("resolver <--record-if-current> <");
  assert.ok(
    firstResolve >= 0 &&
      firstResolve < secretSet &&
      secretSet < update &&
      update < ready &&
      ready < health &&
      health < finalCompare &&
      finalCompare < record &&
      health < record,
    log
  );
  assert.match(
    log,
    /<passkey-proxy-secret=keyvaultref:https:\/\/testvault\.vault\.azure\.net\/secrets\/PASSKEY-PROXY-SECRET,identityref:system>/
  );
  const updateLine = log.match(/^az <containerapp> <update>.*$/m)?.[0] ?? "";
  for (const value of [
    "PASSKEY_ENABLED=true",
    "PASSKEY_ORIGIN=https://bmo-deepagent-ui-testseed.env.example.test",
    "PASSKEY_PROXY_ID=web-bff",
    "PASSKEY_PROXY_SECRET=secretref:passkey-proxy-secret",
    "AUTH_URL=https://bmo-deepagent-ui-testseed.env.example.test",
    "NEXTAUTH_URL=https://bmo-deepagent-ui-testseed.env.example.test",
    "NEXT_PUBLIC_LANGGRAPH_URL=https://deep-research-agent-testseed.env.example.test",
    "BACKEND_API_URL=https://deep-research-agent-testseed.env.example.test",
  ]) {
    assert.match(updateLine, new RegExp(`<${value.replaceAll("/", "\\/")}>`));
  }
});

test("deployment reuses one existing user-assigned identity without changing Azure permissions or identities", async () => {
  const { result, log } = await runDeployment({
    scenario: "user-assigned-identity",
  });
  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  assert.match(
    log,
    /<upload-api-key=keyvaultref:https:\/\/testvault\.vault\.azure\.net\/secrets\/UPLOAD-API-KEY,identityref:\/subscriptions\/12345678-1234-1234-1234-123456789abc\/resourceGroups\/test-resource-group\/providers\/Microsoft\.ManagedIdentity\/userAssignedIdentities\/test-identity>/
  );
  assert.match(log, /objectId=='user-principal-id'/);
  assertNoPermissionMutation(log);
});

test("deployment rejects endpoint drift after health without recording metadata", async () => {
  const { result, log } = await runDeployment({
    endpointResolverOutput: deploymentResolverOutput,
    inheritedEnv: { RESOLVER_DRIFT_AFTER_CALL: "2" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /endpoint resolver changed during deployment/i);
  assert.doesNotMatch(log, /resolver <--record-if-current>/);
});

for (const [scenario, error] of [
  ["missing-system-principal", /system-assigned.*principal/i],
  ["missing-user-assigned-principal", /user-assigned.*principal/i],
  ["multiple-user-assigned-identities", /exactly one.*user-assigned/i],
  ["missing-keyvault-access", /Key Vault secret read access/i],
  ["role-owner-actions-only", /Key Vault secret read access/i],
  ["role-contributor", /Key Vault secret read access/i],
  ["role-data-action-excluded", /Key Vault secret read access/i],
  ["role-malformed", /role definition response/i],
  ["passkey-secret-missing", /PASSKEY-PROXY-SECRET/i],
  ["empty-passkey-secret-id", /PASSKEY-PROXY-SECRET.*ID/i],
]) {
  test(`passkey preflight rejects ${scenario} before app mutation`, async () => {
    const { result, log } = await runDeployment({ scenario });
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, error);
    assertNoAppMutation(log);
    assertNoPermissionMutation(log);
  });
}

for (const scenario of ["role-secrets-user", "role-data-actions-wildcard"]) {
  test(`RBAC preflight accepts ${scenario}`, async () => {
    const { result, log } = await runDeployment({ scenario });
    assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  });
}

test("existing Key Vault access policy with secret get is accepted without role lookup", async () => {
  const { result, log } = await runDeployment({
    scenario: "access-policy-secret-get",
  });
  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  assert.doesNotMatch(log, /^az <role>/m);
});

for (const httpScenario of ["marker-timeout", "curl-failure"]) {
  test(`endpoint metadata is not recorded after ${httpScenario}`, async () => {
    const { result, log } = await runDeployment({ httpScenario });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(log, /resolver <--record>/);
  });
}

for (const [name, options, error] of [
  ["missing manifest", { manifest: false }, /manifest.*required/i],
  [
    "malformed manifest",
    { manifestBytes: "{not-json\n" },
    /manifest.*invalid|malformed/i,
  ],
  [
    "wrong schema",
    { manifest: { ...defaultManifest, schemaVersion: 2 } },
    /schema/i,
  ],
  [
    "wrong image",
    { manifest: { ...defaultManifest, image: "docker.io/attacker/ui:latest" } },
    /image.*does not match/i,
  ],
  [
    "assistant drift",
    { manifest: { ...defaultManifest, assistantId: "old-assistant" } },
    /assistant.*drift/i,
  ],
]) {
  test(`deployment rejects ${name} before Azure access or app mutation`, async () => {
    const { result, log } = await runDeployment(options);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, error);
    assert.doesNotMatch(log, /^az\b/m);
    assertNoAppMutation(log);
  });
}

const preflightFailures = [
  ["resource-group-missing", /resource group/i],
  ["ui-app-missing", /UI Container App/i],
  ["ui-internal-ingress", /external ingress/i],
  ["ui-missing-fqdn", /public FQDN/i],
  ["ui-fqdn-drift", /UI.*FQDN.*resolved/i],
  ["ui-environment-drift", /UI.*managed environment/i],
  ["wrong-target-port", /target port.*3000/i],
  ["multiple-revision-mode", /single-revision/i],
  ["missing-managed-identity", /managed identity/i],
  ["zero-containers", /exactly one.*container/i],
  ["multiple-containers", /exactly one.*container/i],
  ["backend-missing", /backend Container App/i],
  ["backend-internal-ingress", /backend.*external ingress/i],
  ["backend-missing-fqdn", /backend.*public FQDN/i],
  ["backend-drift", /backend.*FQDN.*resolved/i],
  ["backend-environment-drift", /backend.*managed environment/i],
  ["vault-missing", /Key Vault/i],
  ["empty-vault-uri", /vault URI/i],
  ["upload-secret-missing", /UPLOAD-API-KEY/i],
  ["empty-upload-secret-id", /UPLOAD-API-KEY.*ID/i],
  ["docker-pat-missing", /DOCKER-HUB-PAT/i],
  ["empty-docker-pat-id", /DOCKER-HUB-PAT.*ID/i],
  ["docker-secret-missing", /secret.*docker-hub-pat/i],
  ["docker-secret-versioned", /unversioned.*DOCKER-HUB-PAT/i],
  ["docker-secret-wrong-vault", /unversioned.*DOCKER-HUB-PAT/i],
  ["docker-secret-wrong-identity", /selected managed identity/i],
  ["docker-registry-missing", /Docker Hub registry/i],
  ["docker-registry-wrong-username", /username.*jerryshao2013/i],
  ["docker-registry-wrong-secret", /passwordSecretRef.*docker-hub-pat/i],
];

for (const [scenario, error] of preflightFailures) {
  test(`preflight rejects ${scenario} before app mutation`, async () => {
    const { result, log } = await runDeployment({ scenario });
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, error);
    assertNoAppMutation(log);
  });
}

test("deployment consumes manifest without runtime, build, login, push, rsync, or registry mutation", async () => {
  const { result, log } = await runDeployment();
  const source = await readFile(scriptPath, "utf8");
  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  assert.doesNotMatch(
    source,
    /container-runtime\.sh|select_container_cli|container_cli_|\brsync\b|az acr login/
  );
  assert.doesNotMatch(log, /^(?:docker|podman|container|rsync)\b/m);
  assert.doesNotMatch(
    log,
    /az <containerapp> <registry> <set>|az <containerapp> <registry> <remove>/
  );
});

test("deployment rejects non-allowlisted .env.docker credentials and controls without leaking them", async () => {
  const dockerEnv = `NEXT_PUBLIC_ASSISTANT_ID=docker-assistant
LANGCHAIN_API_KEY=docker-env-secret-canary
UPLOAD_API_KEY=docker-env-secret-canary
PASSKEY_PROXY_SECRET=docker-env-secret-canary
NODE_OPTIONS=--require=__NODE_OPTIONS_PAYLOAD__
DOCKER_CONFIG=docker-env-secret-canary
REGISTRY_AUTH_FILE=docker-env-secret-canary
`;
  const { result, log, controlSentinelExists } = await runDeployment({
    dockerEnv,
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(controlSentinelExists, false);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}`,
    /environment-leak|docker-env-secret-canary/
  );
  assert.doesNotMatch(log, /^(?:az|curl|node)\b/m);
});

test("deployment sanitizes inherited credentials and controls before child tools", async () => {
  const { result, log, controlSentinelExists } = await runDeployment({
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

test("tracked .env.docker example and unrelated secrets reach Azure preflight without child leakage", async () => {
  const { result, log } = await runDeployment({
    scenario: "resource-group-missing",
    dockerEnv: `${dockerEnvExample}\nSYNTHETIC_SECRET_CANARY=example-secret-canary\n`,
    manifest: { ...defaultManifest, assistantId: "research" },
  });

  assert.notEqual(result.status, 0);
  assert.match(log, /^az <group> <show>/m);
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}${log}`,
    /environment-leak|example-secret-canary|YOUR_LANGCHAIN_API_KEY_HERE|YOUR_UPLOAD_API_KEY_HERE|REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES/
  );
});

for (const [name, options] of [
  ["success", {}],
  ["manifest failure", { manifest: false }],
]) {
  test(`deployment bash -x hides sourced and parsed config on ${name}`, async () => {
    const dockerEnvCanary = "docker-env-xtrace-canary";
    const sourceEnvCanary = "source-env-xtrace-canary";
    const { result, log } = await runDeployment({
      ...options,
      xtrace: true,
      uiEnvExtra: `export PASSKEY_PROXY_SECRET="${sourceEnvCanary}"`,
      dockerEnv: `NEXT_PUBLIC_ASSISTANT_ID=docker-assistant
NEXT_PUBLIC_LANGGRAPH_URL=https://${dockerEnvCanary}.invalid
`,
    });

    if (name === "success") assert.equal(result.status, 0, result.stderr);
    else assert.notEqual(result.status, 0);
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}${log}`,
      new RegExp(`${dockerEnvCanary}|${sourceEnvCanary}`)
    );
  });
}

test("deployment validates prerequisites then performs narrow secret and image update", async () => {
  const { result, log } = await runDeployment();
  assert.equal(result.status, 0, `${result.stderr}\n${log}`);
  const patRead = log.indexOf("<--name> <DOCKER-HUB-PAT>");
  const appSecrets = log.indexOf("az <containerapp> <secret> <list>");
  const registries = log.indexOf("az <containerapp> <registry> <list>");
  const secretSet = log.indexOf("az <containerapp> <secret> <set>");
  const update = log.indexOf("az <containerapp> <update>");
  assert.ok(
    patRead >= 0 &&
      patRead < appSecrets &&
      appSecrets < registries &&
      registries < secretSet &&
      secretSet < update,
    log
  );
  assert.match(
    log,
    /^az <containerapp> <secret> <set>.*<upload-api-key=keyvaultref:https:\/\/testvault\.vault\.azure\.net\/secrets\/UPLOAD-API-KEY,identityref:system>/m
  );
  const updateLine = log.match(/^az <containerapp> <update>.*$/m)?.[0] ?? "";
  assert.match(updateLine, /<--container-name> <deepagent-ui>/);
  assert.match(
    updateLine,
    /<--image> <docker\.io\/jerryshao2013\/deepagent-ui:latest>/
  );
  assert.match(updateLine, /<--revision-suffix> <ui-20260812t101112-[0-9]+>/);
  assert.match(
    updateLine,
    /<NEXT_PUBLIC_LANGGRAPH_URL=https:\/\/deep-research-agent-testseed\.env\.example\.test>/
  );
  assert.match(updateLine, /<NEXT_PUBLIC_ASSISTANT_ID=docker-assistant>/);
  assert.doesNotMatch(
    updateLine,
    /<--(?:ingress|target-port|scale|identity|registry|traffic|network|volume|dapr)[^>]*>/
  );
  assert.match(
    log,
    /^curl .*<https:\/\/bmo-deepagent-ui-testseed\.env\.example\.test\/deployment-version\.txt>$/m
  );
  assert.match(result.stdout, /deployment complete/i);
});

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

for (const [scenario, status] of [
  ["docker-pat-show-cli-failure", 48],
  ["docker-secret-list-cli-failure", 49],
  ["docker-registry-list-cli-failure", 50],
]) {
  test(`deployment preserves exact ${scenario} status`, async () => {
    const { result, log } = await runDeployment({ scenario });
    assert.equal(result.status, status, result.stderr);
    assertNoAppMutation(log);
  });
}

for (const [scenario, error] of [
  ["empty-previous-revision", /previous.*revision/i],
  ["unchanged-revision", /new revision.*different/i],
  ["revision-failed", /Failed.*Degraded/i],
  ["revision-timeout", /timed out.*revision/i],
  ["revision-unhealthy", /Unhealthy/i],
]) {
  test(`deployment rejects ${scenario}`, async () => {
    const { result, log } = await runDeployment({ scenario });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    if (scenario.startsWith("revision-")) assert.doesNotMatch(log, /^curl\b/m);
  });
}

test("deployment waits through provisioning and stale marker", async () => {
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
});

for (const [name, httpScenario, status, error] of [
  ["marker timeout", "marker-timeout", 1, /marker.*timed out/i],
  ["curl failure", "curl-failure", 47, /HTTP verification/i],
]) {
  test(`deployment reports ${name} without rollback`, async () => {
    const { result, log } = await runDeployment({ httpScenario });
    assert.equal(result.status, status, result.stderr);
    assert.match(result.stderr, error);
    assert.doesNotMatch(log, /<--traffic>|<--revision-mode>/);
  });
}

for (const [name, value] of [
  ["revision attempts", { revisionPollAttempts: "0" }],
  ["HTTP attempts", { httpPollAttempts: "invalid" }],
  ["poll interval", { pollIntervalSeconds: "-1" }],
]) {
  test(`deployment rejects invalid ${name} before app mutation`, async () => {
    const { result, log } = await runDeployment(value);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /poll|attempt|interval/i);
    assertNoAppMutation(log);
  });
}

test("deployment preserves .env.docker bytes and works outside repository cwd", async () => {
  const {
    result,
    dockerEnvBefore,
    dockerEnvAfter,
    outsideSentinel,
    outsideAfter,
  } = await runDeployment({ outsideCwd: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(dockerEnvAfter, dockerEnvBefore);
  assert.deepEqual(outsideAfter, outsideSentinel);
});

for (const [name, dockerEnv, error] of [
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
]) {
  test(`deployment rejects .env.docker ${name} before external access`, async () => {
    const { result, log, dockerEnvBefore, dockerEnvAfter } =
      await runDeployment({ dockerEnv });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, error);
    assert.doesNotMatch(log, /^az\b/m);
    assert.deepEqual(dockerEnvAfter, dockerEnvBefore);
  });
}

const resolverSubscriptionId = "12345678-1234-1234-1234-123456789abc";
const resolverResourceGroup = "test-resource-group";
const resolverEnvironmentName = "test-environment";
const resolverBackendApp = "deep-research-agent-testseed";
const resolverUiApp = "bmo-deepagent-ui-testseed";
const resolverDomain = "calmpond-12345678.canadacentral.azurecontainerapps.io";
const resolverEnvironmentId =
  `/subscriptions/${resolverSubscriptionId}/resourceGroups/${resolverResourceGroup}` +
  `/providers/Microsoft.App/managedEnvironments/${resolverEnvironmentName}`;
const resolverBackendUrl = `https://${resolverBackendApp}.${resolverDomain}`;
const resolverUiUrl = `https://${resolverUiApp}.${resolverDomain}`;
const resolverMetadataName = ".resolved-azure-endpoints.json";
const resolverExpectedAzCall = [
  "containerapp",
  "env",
  "show",
  "--subscription",
  resolverSubscriptionId,
  "--resource-group",
  resolverResourceGroup,
  "--name",
  resolverEnvironmentName,
  "--query",
  "[id,properties.defaultDomain,properties.provisioningState]",
  "--output",
  "tsv",
];

const resolverExpectedStdout = [
  `AZURE_ENVIRONMENT_ID='${resolverEnvironmentId}'`,
  `AZURE_ENVIRONMENT_DEFAULT_DOMAIN='${resolverDomain}'`,
  `BACKEND_APP_NAME='${resolverBackendApp}'`,
  `UI_APP_NAME='${resolverUiApp}'`,
  `BACKEND_URL='${resolverBackendUrl}'`,
  `AZURE_UI_URL='${resolverUiUrl}'`,
  `FRONTEND_URLS='${resolverUiUrl},https://bmo-deepagent-ui.vercel.app'`,
  `GOOGLE_CALLBACK_URL='${resolverBackendUrl}/auth/callback/google'`,
  `GITHUB_CALLBACK_URL='${resolverBackendUrl}/auth/callback/github'`,
  `GITHUB_HOMEPAGE_URL='${resolverUiUrl}'`,
  "CHANGED='true'",
].join("\n");
const resolverGoldenSha256 =
  "7f459aee2b2edf425411d2dd448af2c7c48b84f667c7f1851deb10636b80d8e4";

const resolverExpectedMetadata = {
  azure_environment_id: resolverEnvironmentId,
  azure_environment_default_domain: resolverDomain,
  backend_app_name: resolverBackendApp,
  ui_app_name: resolverUiApp,
  backend_url: resolverBackendUrl,
  azure_ui_url: resolverUiUrl,
  frontend_urls: `${resolverUiUrl},https://bmo-deepagent-ui.vercel.app`,
  google_callback_url: `${resolverBackendUrl}/auth/callback/google`,
  github_callback_url: `${resolverBackendUrl}/auth/callback/github`,
  github_homepage_url: resolverUiUrl,
};

const resolverFakeAz = `#!/bin/bash
set -u
printf '%s\\n' "$*" >> "$RESOLVER_AZ_LOG"
expected=(
  containerapp env show
  --subscription "$AZURE_SUBSCRIPTION_ID"
  --resource-group "$RESOURCE_GROUP"
  --name "$ENV_NAME"
  --query '[id,properties.defaultDomain,properties.provisioningState]'
  --output tsv
)
[ "$#" -eq "\${#expected[@]}" ] || exit 86
index=1
for value in "\${expected[@]}"; do
  [ "\${!index}" = "$value" ] || exit 86
  index=$((index + 1))
done
printf '%s' "\${FAKE_AZ_STDERR-}" >&2
printf '%s' "\${FAKE_AZ_STDOUT-}"
exit "\${FAKE_AZ_STATUS:-0}"
`;

const createResolverFixture = async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "azure-endpoint-resolver-test-")
  );
  const bin = path.join(root, "bin");
  const azLog = path.join(root, "az.log");
  await mkdir(bin);
  await writeFile(path.join(bin, "az"), resolverFakeAz);
  await chmod(path.join(bin, "az"), 0o700);
  return { root, bin, azLog };
};

const runResolver = (
  executable,
  fixture,
  {
    args = [],
    environment = {},
    azStdout = `${resolverEnvironmentId}\t${resolverDomain}\tSucceeded\n`,
    azStderr = "",
    azStatus = 0,
  } = {}
) =>
  spawnSync("bash", [executable, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      RESOLVER_AZ_LOG: fixture.azLog,
      FAKE_AZ_STDOUT: azStdout,
      FAKE_AZ_STDERR: azStderr,
      FAKE_AZ_STATUS: String(azStatus),
      AZURE_SUBSCRIPTION_ID: resolverSubscriptionId,
      RESOURCE_GROUP: resolverResourceGroup,
      ENV_NAME: resolverEnvironmentName,
      BACKEND_APP_NAME: resolverBackendApp,
      UI_APP_NAME: resolverUiApp,
      ...environment,
    },
  });

const readResolverAzCalls = async (fixture) => {
  const contents = await readFile(fixture.azLog, "utf8").catch(() => "");
  return contents.trim() ? contents.trim().split("\n") : [];
};

const parseResolverAssignments = (stdout) => {
  const assignments = {};
  for (const line of stdout.trimEnd().split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)='((?:[^']|'"'"')*)'$/);
    assert.ok(match, `unsafe resolver assignment: ${JSON.stringify(line)}`);
    const [, key, encoded] = match;
    assert.equal(assignments[key], undefined, `duplicate resolver key: ${key}`);
    assignments[key] = encoded.replaceAll(`'"'"'`, `'`);
  }
  return assignments;
};

const expectedResolverNotice = (changed) =>
  [
    changed
      ? "ACTION REQUIRED: update and verify Google/GitHub OAuth provider settings before deployment."
      : "OAuth provider reminder: verify the following URLs remain configured.",
    `Google authorized redirect URI: ${resolverBackendUrl}/auth/callback/google`,
    `GitHub authorization callback URL: ${resolverBackendUrl}/auth/callback/github`,
    `GitHub homepage / frontend origin: ${resolverUiUrl}`,
  ].join("\n") + "\n";

test("endpoint resolver queries environment once and emits deterministic schema", async () => {
  const fixture = await createResolverFixture();
  try {
    const result = runResolver(resolverPath, fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${resolverExpectedStdout}\n`);
    assert.equal(result.stderr, expectedResolverNotice(true));
    assert.deepEqual(parseResolverAssignments(result.stdout), {
      AZURE_ENVIRONMENT_ID: resolverEnvironmentId,
      AZURE_ENVIRONMENT_DEFAULT_DOMAIN: resolverDomain,
      BACKEND_APP_NAME: resolverBackendApp,
      UI_APP_NAME: resolverUiApp,
      BACKEND_URL: resolverBackendUrl,
      AZURE_UI_URL: resolverUiUrl,
      FRONTEND_URLS: `${resolverUiUrl},https://bmo-deepagent-ui.vercel.app`,
      GOOGLE_CALLBACK_URL: `${resolverBackendUrl}/auth/callback/google`,
      GITHUB_CALLBACK_URL: `${resolverBackendUrl}/auth/callback/github`,
      GITHUB_HOMEPAGE_URL: resolverUiUrl,
      CHANGED: "true",
    });
    assert.deepEqual(await readResolverAzCalls(fixture), [
      resolverExpectedAzCall.join(" "),
    ]);
    assert.equal(
      await access(path.join(fixture.root, resolverMetadataName))
        .then(() => true)
        .catch(() => false),
      false
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("endpoint resolver accepts newline-separated TSV arrays from containerapp extension", async () => {
  const fixture = await createResolverFixture();
  try {
    const result = runResolver(resolverPath, fixture, {
      azStdout: `${resolverEnvironmentId}\n${resolverDomain}\nSucceeded\n`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${resolverExpectedStdout}\n`);
    assert.deepEqual(await readResolverAzCalls(fixture), [
      resolverExpectedAzCall.join(" "),
    ]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("endpoint resolver records atomically then compares without writes", async () => {
  const fixture = await createResolverFixture();
  try {
    const recorded = runResolver(resolverPath, fixture, { args: ["--record"] });
    assert.equal(recorded.status, 0, recorded.stderr);
    const metadataPath = path.join(fixture.root, resolverMetadataName);
    assert.deepEqual(
      JSON.parse(await readFile(metadataPath, "utf8")),
      resolverExpectedMetadata
    );
    assert.equal((await stat(metadataPath)).mode & 0o777, 0o600);
    assert.deepEqual(
      (await readFile(metadataPath, "utf8")).endsWith("\n"),
      true
    );
    const before = await readFile(metadataPath);
    const mktempSentinel = path.join(fixture.root, "mktemp-called");
    await writeFile(
      path.join(fixture.bin, "mktemp"),
      `#!/bin/sh\nprintf called > ${JSON.stringify(mktempSentinel)}\nexit 72\n`
    );
    await chmod(path.join(fixture.bin, "mktemp"), 0o700);

    const compared = runResolver(resolverPath, fixture);
    assert.equal(compared.status, 0, compared.stderr);
    assert.equal(
      compared.stdout,
      `${resolverExpectedStdout.replace("CHANGED='true'", "CHANGED='false'")}\n`
    );
    assert.equal(compared.stderr, expectedResolverNotice(false));
    assert.deepEqual(await readFile(metadataPath), before);
    assert.equal(
      await access(mktempSentinel)
        .then(() => true)
        .catch(() => false),
      false
    );
    assert.deepEqual(
      (await readFile(fixture.azLog, "utf8")).trim().split("\n"),
      [resolverExpectedAzCall.join(" "), resolverExpectedAzCall.join(" ")]
    );
    assert.deepEqual(
      (await readdir(fixture.root)).filter((name) =>
        name.startsWith(`${resolverMetadataName}.tmp.`)
      ),
      []
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("endpoint resolver guarded record writes only when current assignments exactly match", async () => {
  const fixture = await createResolverFixture();
  try {
    const metadataPath = path.join(fixture.root, resolverMetadataName);
    const expectedPath = path.join(fixture.root, "expected-assignments");
    await writeFile(expectedPath, `${resolverExpectedStdout}\n`);

    const recorded = runResolver(resolverPath, fixture, {
      args: ["--record-if-current", expectedPath],
    });
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.deepEqual(
      JSON.parse(await readFile(metadataPath, "utf8")),
      resolverExpectedMetadata
    );

    const prior = Buffer.from(await readFile(metadataPath));
    await writeFile(
      expectedPath,
      `${resolverExpectedStdout.replace(
        resolverDomain,
        "drift.example.test"
      )}\n`
    );
    const rejected = runResolver(resolverPath, fixture, {
      args: ["--record-if-current", expectedPath],
    });
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /current endpoints.*expected/i);
    assert.equal(rejected.stdout, "");
    assert.deepEqual(await readFile(metadataPath), prior);
    assert.deepEqual(
      (await readdir(fixture.root)).filter((name) =>
        name.startsWith(`${resolverMetadataName}.tmp.`)
      ),
      []
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("endpoint resolver reports changes without replacing metadata", async () => {
  const fixture = await createResolverFixture();
  try {
    const metadataPath = path.join(fixture.root, resolverMetadataName);
    const prior = Buffer.from('{"prior":"metadata"}\n');
    await writeFile(metadataPath, prior);
    const result = runResolver(resolverPath, fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /metadata file is malformed/);
    assert.equal(result.stdout, "");
    assert.deepEqual(await readFile(metadataPath), prior);

    const changedMetadata = {
      ...resolverExpectedMetadata,
      azure_environment_default_domain: "old.example.test",
    };
    const changedBytes = Buffer.from(`${JSON.stringify(changedMetadata)}\n`);
    await writeFile(metadataPath, changedBytes);
    const changed = runResolver(resolverPath, fixture);
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(parseResolverAssignments(changed.stdout).CHANGED, "true");
    assert.deepEqual(await readFile(metadataPath), changedBytes);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

for (const [name, environment, message] of [
  [
    "missing subscription",
    { AZURE_SUBSCRIPTION_ID: "" },
    "AZURE_SUBSCRIPTION_ID",
  ],
  ["invalid subscription", { AZURE_SUBSCRIPTION_ID: "not-a-uuid" }, "UUID"],
  ["invalid resource group", { RESOURCE_GROUP: "bad/group" }, "resource-group"],
  ["trailing-dot resource group", { RESOURCE_GROUP: "bad." }, "resource-group"],
  [
    "invalid environment",
    { ENV_NAME: "Bad_Environment" },
    "managed-environment",
  ],
  ["short environment", { ENV_NAME: "a" }, "managed-environment"],
  [
    "invalid backend app",
    { BACKEND_APP_NAME: "bad--backend" },
    "BACKEND_APP_NAME",
  ],
  ["short backend app", { BACKEND_APP_NAME: "b" }, "BACKEND_APP_NAME"],
  ["long UI app", { UI_APP_NAME: "u".repeat(33) }, "UI_APP_NAME"],
  ["uppercase UI app", { UI_APP_NAME: "Badui" }, "UI_APP_NAME"],
]) {
  test(`endpoint resolver rejects ${name} before Azure access`, async () => {
    const fixture = await createResolverFixture();
    try {
      const result = runResolver(resolverPath, fixture, { environment });
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(message));
      assert.deepEqual(await readResolverAzCalls(fixture), []);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

for (const [name, azStdout, message] of [
  [
    "non-Succeeded state",
    `${resolverEnvironmentId}\t${resolverDomain}\tProvisioning\n`,
    "Succeeded",
  ],
  [
    "empty default domain",
    `${resolverEnvironmentId}\t\tSucceeded\n`,
    "default domain",
  ],
  [
    "invalid default domain",
    `${resolverEnvironmentId}\tBad_Domain\tSucceeded\n`,
    "default domain",
  ],
  [
    "other ARM resource",
    `/subscriptions/${resolverSubscriptionId}/resourceGroups/${resolverResourceGroup}/providers/Microsoft.App/managedEnvironments/other\t${resolverDomain}\tSucceeded\n`,
    "does not match requested",
  ],
  [
    "malformed response",
    `${resolverEnvironmentId}\t${resolverDomain}\n`,
    "invalid response",
  ],
]) {
  test(`endpoint resolver rejects ${name} without mutating metadata`, async () => {
    const fixture = await createResolverFixture();
    try {
      const metadataPath = path.join(fixture.root, resolverMetadataName);
      const prior = Buffer.from("prior metadata bytes\n");
      await writeFile(metadataPath, prior);
      const result = runResolver(resolverPath, fixture, {
        args: ["--record"],
        azStdout,
      });
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, new RegExp(message, "i"));
      assert.deepEqual(await readFile(metadataPath), prior);
      assert.deepEqual(await readResolverAzCalls(fixture), [
        resolverExpectedAzCall.join(" "),
      ]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
}

test("endpoint resolver preserves Azure failure status and bytes", async () => {
  const fixture = await createResolverFixture();
  try {
    const metadataPath = path.join(fixture.root, resolverMetadataName);
    const prior = Buffer.from("prior metadata bytes\n");
    await writeFile(metadataPath, prior);
    const result = runResolver(resolverPath, fixture, {
      args: ["--record"],
      azStdout: "az stdout bytes\n",
      azStderr: "az stderr bytes\n",
      azStatus: 43,
    });
    assert.equal(result.status, 43);
    assert.equal(result.stdout, "az stdout bytes\n");
    assert.equal(result.stderr, "az stderr bytes\n");
    assert.deepEqual(await readFile(metadataPath), prior);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("endpoint resolver preserves metadata and failure bytes when atomic rename fails", async () => {
  const fixture = await createResolverFixture();
  try {
    const metadataPath = path.join(fixture.root, resolverMetadataName);
    const prior = Buffer.from(
      `${JSON.stringify({
        ...resolverExpectedMetadata,
        azure_environment_default_domain: "old.example.test",
      })}\n`
    );
    await writeFile(metadataPath, prior);
    await writeFile(
      path.join(fixture.bin, "mv"),
      "#!/bin/sh\nprintf 'rename failed bytes\\n' >&2\nexit 47\n"
    );
    await chmod(path.join(fixture.bin, "mv"), 0o700);
    const result = runResolver(resolverPath, fixture, { args: ["--record"] });
    assert.equal(result.status, 47);
    assert.equal(result.stderr, "rename failed bytes\n");
    assert.deepEqual(await readFile(metadataPath), prior);
    assert.equal(
      (await readdir(fixture.root)).some((name) =>
        name.startsWith(`${resolverMetadataName}.tmp.`)
      ),
      false
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("endpoint resolver handles valid parenthesized resource group with safe round trip", async () => {
  const fixture = await createResolverFixture();
  try {
    const resourceGroup = "test(resource-group)";
    const environmentId =
      `/subscriptions/${resolverSubscriptionId}/resourceGroups/${resourceGroup}` +
      `/providers/Microsoft.App/managedEnvironments/${resolverEnvironmentName}`;
    const result = runResolver(resolverPath, fixture, {
      environment: { RESOURCE_GROUP: resourceGroup },
      azStdout: `${environmentId}\t${resolverDomain}\tSucceeded\n`,
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = parseResolverAssignments(result.stdout);
    assert.equal(parsed.AZURE_ENVIRONMENT_ID, environmentId);
    assert.equal(parsed.BACKEND_URL, resolverBackendUrl);
    assert.equal(parsed.CHANGED, "true");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("endpoint resolver matches self-contained golden contract in isolated checkout", async () => {
  const source = await readFile(resolverPath);
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    resolverGoldenSha256
  );
});

test(
  "UI and backend endpoint resolvers retain explicit cross-repository parity",
  { skip: !process.env.BACKEND_ENDPOINT_RESOLVER_PATH },
  async () => {
    const backendResolver = process.env.BACKEND_ENDPOINT_RESOLVER_PATH;
    await access(backendResolver);
    const normalize = (source) =>
      source
        .replace(/^#!.*$/m, "#!bash")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .join("\n");
    assert.equal(
      normalize(await readFile(resolverPath, "utf8")),
      normalize(await readFile(backendResolver, "utf8"))
    );

    for (const scenario of [
      {},
      { args: ["--record"] },
      {
        azStdout: `${resolverEnvironmentId}\t${resolverDomain}\tProvisioning\n`,
      },
      {
        azStdout: "az stdout bytes\n",
        azStderr: "az stderr bytes\n",
        azStatus: 43,
      },
    ]) {
      const uiFixture = await createResolverFixture();
      const backendFixture = await createResolverFixture();
      try {
        const ui = runResolver(resolverPath, uiFixture, scenario);
        const backend = runResolver(backendResolver, backendFixture, scenario);
        assert.deepEqual(
          { status: ui.status, stdout: ui.stdout, stderr: ui.stderr },
          {
            status: backend.status,
            stdout: backend.stdout,
            stderr: backend.stderr,
          }
        );
        const uiMetadata = await readFile(
          path.join(uiFixture.root, resolverMetadataName)
        ).catch(() => null);
        const backendMetadata = await readFile(
          path.join(backendFixture.root, resolverMetadataName)
        ).catch(() => null);
        assert.deepEqual(uiMetadata, backendMetadata);
      } finally {
        await rm(uiFixture.root, { recursive: true, force: true });
        await rm(backendFixture.root, { recursive: true, force: true });
      }
    }
  }
);
