#!/bin/bash

DEPLOY_XTRACE_WAS_ENABLED=false
case "$-" in
  *x*)
    DEPLOY_XTRACE_WAS_ENABLED=true
    set +x
    ;;
esac

set -eo pipefail

print_usage() {
  echo "Usage: ./deploy-azure-container-app.sh [--oauth-redirects-confirmed] [--help]"
}

CLI_OAUTH_REDIRECTS_CONFIRMED=false
CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN=false
DEPLOY_ORIGINAL_ARGUMENT_COUNT="$#"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      if [ "$DEPLOY_ORIGINAL_ARGUMENT_COUNT" -ne 1 ]; then
        echo "Error: --help must be used alone." >&2
        exit 64
      fi
      print_usage
      exit 0
      ;;
    --oauth-redirects-confirmed)
      if [ "$CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN" = true ]; then
        echo "Error: --oauth-redirects-confirmed may be supplied only once." >&2
        exit 64
      fi
      CLI_OAUTH_REDIRECTS_CONFIRMED=true
      CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN=true
      shift
      ;;
    *)
      echo "Error: unknown argument '$1'." >&2
      exit 64
      ;;
  esac
done

unset LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE
CALLER_OAUTH_REDIRECTS_CONFIRMED="${OAUTH_REDIRECTS_CONFIRMED-}"
unset OAUTH_REDIRECTS_CONFIRMED

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_SH_SKIP_DOCKER_SYNC_WAS_SET=false
if [ "${ENV_SH_SKIP_DOCKER_SYNC+x}" = x ]; then
  ENV_SH_SKIP_DOCKER_SYNC_WAS_SET=true
  ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS="$ENV_SH_SKIP_DOCKER_SYNC"
fi
ENV_SH_SKIP_DOCKER_SYNC=true
if source "$SCRIPT_DIR/env.sh" >/dev/null 2>/dev/null; then
  ENV_SH_SOURCE_STATUS=0
else
  ENV_SH_SOURCE_STATUS=$?
fi
set +x
if [ "$ENV_SH_SKIP_DOCKER_SYNC_WAS_SET" = true ]; then
  ENV_SH_SKIP_DOCKER_SYNC="$ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS"
else
  unset ENV_SH_SKIP_DOCKER_SYNC
fi
unset ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS ENV_SH_SKIP_DOCKER_SYNC_WAS_SET DEPLOY_XTRACE_WAS_ENABLED
if [ "$ENV_SH_SOURCE_STATUS" -ne 0 ]; then
  status="$ENV_SH_SOURCE_STATUS"
  unset ENV_SH_SOURCE_STATUS
  echo "Error: env.sh configuration failed." >&2
  exit "$status"
fi
unset ENV_SH_SOURCE_STATUS
unset LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE
if [ "$CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN" = true ]; then
  OAUTH_REDIRECTS_CONFIRMED="$CLI_OAUTH_REDIRECTS_CONFIRMED"
else
  OAUTH_REDIRECTS_CONFIRMED="$CALLER_OAUTH_REDIRECTS_CONFIRMED"
fi
unset CALLER_OAUTH_REDIRECTS_CONFIRMED CLI_OAUTH_REDIRECTS_CONFIRMED \
  CLI_OAUTH_REDIRECTS_CONFIRMED_SEEN DEPLOY_ORIGINAL_ARGUMENT_COUNT

source "$SCRIPT_DIR/scripts/azure-subscription.sh"

fail() {
  echo "Error: $*" >&2
  exit 1
}

decode_resolver_output() {
  local line key value
  local assignment_count=0
  local seen_keys="|"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=\'([^\']*)\'$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
    else
      fail "endpoint resolver returned invalid output."
    fi
    case "$seen_keys" in
      *"|$key|"*) fail "endpoint resolver returned duplicate key '$key'." ;;
    esac
    seen_keys="${seen_keys}${key}|"
    assignment_count=$((assignment_count + 1))
    case "$key" in
      AZURE_ENVIRONMENT_ID) AZURE_ENVIRONMENT_ID="$value" ;;
      AZURE_ENVIRONMENT_DEFAULT_DOMAIN) AZURE_ENVIRONMENT_DEFAULT_DOMAIN="$value" ;;
      BACKEND_APP_NAME) RESOLVED_BACKEND_APP_NAME="$value" ;;
      UI_APP_NAME) RESOLVED_UI_APP_NAME="$value" ;;
      BACKEND_URL) BACKEND_URL="$value" ;;
      AZURE_UI_URL) AZURE_UI_URL="$value" ;;
      FRONTEND_URLS) FRONTEND_URLS="$value" ;;
      GOOGLE_CALLBACK_URL) GOOGLE_CALLBACK_URL="$value" ;;
      GITHUB_CALLBACK_URL) GITHUB_CALLBACK_URL="$value" ;;
      GITHUB_HOMEPAGE_URL) GITHUB_HOMEPAGE_URL="$value" ;;
      CHANGED) RESOLVED_ENDPOINTS_CHANGED="$value" ;;
      *) fail "endpoint resolver returned unknown key '$key'." ;;
    esac
  done <<< "$RESOLVER_OUTPUT"
  [ "$assignment_count" -eq 11 ] || fail "endpoint resolver returned incomplete output."
  [ "$RESOLVED_BACKEND_APP_NAME" = "$BACKEND_APP_NAME" ] || fail "endpoint resolver backend app mismatch."
  [ "$RESOLVED_UI_APP_NAME" = "$UI_APP_NAME" ] || fail "endpoint resolver UI app mismatch."
  case "$RESOLVED_ENDPOINTS_CHANGED" in true|false) ;; *) fail "endpoint resolver returned invalid CHANGED value." ;; esac
  [ -n "$BACKEND_URL" ] && [ -n "$AZURE_UI_URL" ] || fail "endpoint resolver returned empty URLs."
}

dotenv_fail() {
  local line_number="$1"
  local message="$2"
  fail "$SCRIPT_DIR/.env.docker line $line_number: $message"
}

if RESOLVER_OUTPUT=$(AZURE_SUBSCRIPTION_ID="$AZURE_SUBSCRIPTION_ID" \
  RESOURCE_GROUP="$RESOURCE_GROUP" ENV_NAME="$ENV_NAME" \
  BACKEND_APP_NAME="$BACKEND_APP_NAME" UI_APP_NAME="$UI_APP_NAME" \
  "$SCRIPT_DIR/scripts/resolve-azure-endpoints.sh"); then
  :
else
  status=$?
  echo "Error: endpoint resolver failed." >&2
  exit "$status"
fi
decode_resolver_output
INITIAL_RESOLVER_OUTPUT="$RESOLVER_OUTPUT"
unset RESOLVER_OUTPUT

if [ -f "$SCRIPT_DIR/.env.docker" ]; then
  command -v node >/dev/null 2>&1 || fail "required command not found: node"
  if node "$SCRIPT_DIR/scripts/sanitize-passkey-dotenv.mjs" \
    --input "$SCRIPT_DIR/.env.docker" --check; then
    :
  else
    status=$?
    echo "Error: private dotenv contains deployment-owned passkey configuration." >&2
    exit "$status"
  fi
  docker_env_line_number=0
  while IFS= read -r docker_env_line || [ -n "$docker_env_line" ]; do
    docker_env_line_number=$((docker_env_line_number + 1))
    docker_env_line="${docker_env_line%$'\r'}"
    case "$docker_env_line" in
      ""|\#*) continue ;;
      *=*) ;;
      *) dotenv_fail "$docker_env_line_number" "unsupported syntax; expected KEY=VALUE." ;;
    esac
    key="${docker_env_line%%=*}"
    value="${docker_env_line#*=}"
    if ! [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      dotenv_fail "$docker_env_line_number" "key must be a shell identifier without 'export' or leading whitespace."
    fi
    case "$key" in
      NEXT_PUBLIC_ASSISTANT_ID|NEXT_PUBLIC_LANGGRAPH_URL) ;;
      AZURE_SUBSCRIPTION_ID|RESOURCE_GROUP|ACR_NAME|KV_NAME|SEED|CONTAINER_APP_NAME|CONTAINER_CLI|DOCKER_HUB_USERNAME|DOCKER_HUB_PAT|CONTAINER_APP_REVISION_POLL_ATTEMPTS|CONTAINER_APP_HTTP_POLL_ATTEMPTS|CONTAINER_APP_POLL_INTERVAL_SECONDS|SCRIPT_DIR|ASSISTANT_ID|EXPECTED_IMAGE|MANIFEST_PATH|PATH|IFS|CDPATH|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|HOME|PWD|OLDPWD|TMPDIR|PS4|BASH_XTRACEFD|PROMPT_COMMAND|BASH_COMPAT|POSIXLY_CORRECT|GLOBIGNORE|NODE_OPTIONS|DOCKER_CONFIG|REGISTRY_AUTH_FILE|LD_*|DYLD_*)
        dotenv_fail "$docker_env_line_number" "protected deployment, credential, or shell control '$key' cannot be overridden."
        ;;
    esac
    case "$value" in
      \"*)
        case "$value" in
          \"*\") value="${value#\"}"; value="${value%\"}" ;;
          *) dotenv_fail "$docker_env_line_number" "unmatched quote." ;;
        esac
        ;;
      \'*)
        case "$value" in
          \'*\') value="${value#\'}"; value="${value%\'}" ;;
          *) dotenv_fail "$docker_env_line_number" "unmatched quote." ;;
        esac
        ;;
      *\"*|*\'*) dotenv_fail "$docker_env_line_number" "unmatched quote." ;;
    esac
    if [ "$key" = NEXT_PUBLIC_ASSISTANT_ID ]; then
      NEXT_PUBLIC_ASSISTANT_ID="$value"
    fi
  done < "$SCRIPT_DIR/.env.docker"
  unset docker_env_line docker_env_line_number key value
fi

ASSISTANT_ID="${NEXT_PUBLIC_ASSISTANT_ID:-research}"
CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-bmo-deepagent-ui-$SEED}"
[ "$UI_APP_NAME" = "$CONTAINER_APP_NAME" ] || fail "UI_APP_NAME must match CONTAINER_APP_NAME."
DOCKER_HUB_USERNAME="jerryshao2013"
EXPECTED_IMAGE="docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest"
MANIFEST_PATH="$SCRIPT_DIR/.deployment-build.json"

require_nonempty() {
  local variable_name="$1"
  local variable_value="${!variable_name}"
  [ -n "$variable_value" ] || fail "$variable_name is required."
}
for variable_name in SEED RESOURCE_GROUP KV_NAME CONTAINER_APP_NAME ASSISTANT_ID; do
  require_nonempty "$variable_name"
done
for required_command in az curl node; do
  command -v "$required_command" >/dev/null 2>&1 || fail "required command not found: $required_command"
done

TEMPLATE_BASELINE_JSON=""
UPDATE_PATCH_JSON=""
HEALTH_RESPONSE_PATH=""
cleanup() {
  [ -z "$TEMPLATE_BASELINE_JSON" ] || rm -f -- "$TEMPLATE_BASELINE_JSON"
  [ -z "$UPDATE_PATCH_JSON" ] || rm -f -- "$UPDATE_PATCH_JSON"
  [ -z "$HEALTH_RESPONSE_PATH" ] || rm -f -- "$HEALTH_RESPONSE_PATH"
}
trap cleanup EXIT

[ -f "$MANIFEST_PATH" ] || fail "deployment build manifest '$MANIFEST_PATH' is required; run ./build.sh first."
if MANIFEST_VALUES=$(node -e '
const fs = require("node:fs");
const file = process.argv[1];
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(2);
}
const keys = ["schemaVersion", "deploymentMarker", "image", "backendUrl", "assistantId"];
if (
  manifest === null ||
  Array.isArray(manifest) ||
  typeof manifest !== "object" ||
  Object.keys(manifest).length !== keys.length ||
  !keys.every((key) => Object.prototype.hasOwnProperty.call(manifest, key)) ||
  manifest.schemaVersion !== 1 ||
  !keys.slice(1).every((key) => typeof manifest[key] === "string" && manifest[key].length > 0) ||
  keys.slice(1).some((key) => /[\u0000-\u001f\u007f]/.test(manifest[key]))
) process.exit(3);
process.stdout.write(keys.map((key) => String(manifest[key])).join("\t"));
' "$MANIFEST_PATH"); then
  :
else
  status=$?
  if [ "$status" -eq 2 ]; then
    fail "deployment build manifest is malformed or invalid JSON."
  fi
  fail "deployment build manifest has an invalid schema or value."
fi
IFS=$'\t' read -r MANIFEST_SCHEMA MANIFEST_MARKER MANIFEST_IMAGE MANIFEST_BACKEND_URL MANIFEST_ASSISTANT_ID <<< "$MANIFEST_VALUES"
unset MANIFEST_VALUES
[ "$MANIFEST_SCHEMA" = 1 ] || fail "deployment build manifest schema is invalid."
[ "$MANIFEST_IMAGE" = "$EXPECTED_IMAGE" ] || fail "manifest image '$MANIFEST_IMAGE' does not match pinned image '$EXPECTED_IMAGE'."
[ "$MANIFEST_ASSISTANT_ID" = "$ASSISTANT_ID" ] || fail "manifest assistant ID drift: built '$MANIFEST_ASSISTANT_ID', configured '$ASSISTANT_ID'."
[ "$MANIFEST_BACKEND_URL" = "$BACKEND_URL" ] || fail "manifest backend URL drift: built '$MANIFEST_BACKEND_URL', canonical '$BACKEND_URL'."

if [ "$RESOLVED_ENDPOINTS_CHANGED" = true ] && [ "$OAUTH_REDIRECTS_CONFIRMED" != true ]; then
  fail "OAUTH_REDIRECTS_CONFIRMED=true is required for changed OAuth endpoints."
fi

REVISION_POLL_ATTEMPTS="${CONTAINER_APP_REVISION_POLL_ATTEMPTS:-60}"
HTTP_POLL_ATTEMPTS="${CONTAINER_APP_HTTP_POLL_ATTEMPTS:-36}"
POLL_INTERVAL_SECONDS="${CONTAINER_APP_POLL_INTERVAL_SECONDS:-5}"
for poll_value in REVISION_POLL_ATTEMPTS HTTP_POLL_ATTEMPTS POLL_INTERVAL_SECONDS; do
  case "${!poll_value}" in
    ""|*[!0-9]*) fail "$poll_value must be a positive integer." ;;
  esac
done
[ "$REVISION_POLL_ATTEMPTS" -gt 0 ] || fail "REVISION_POLL_ATTEMPTS must be greater than zero."
[ "$HTTP_POLL_ATTEMPTS" -gt 0 ] || fail "HTTP_POLL_ATTEMPTS must be greater than zero."
[ "$POLL_INTERVAL_SECONDS" -gt 0 ] || fail "POLL_INTERVAL_SECONDS must be greater than zero."

select_azure_subscription
echo "Azure subscription: $AZURE_SUBSCRIPTION_ID"

if ! az group show --name "$RESOURCE_GROUP" --query name -o tsv >/dev/null; then
  fail "resource group '$RESOURCE_GROUP' does not exist or is not readable."
fi

if UI_DETAILS=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "join('|', [to_string(properties.managedEnvironmentId), to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn), to_string(properties.configuration.ingress.targetPort), to_string(properties.configuration.activeRevisionsMode), to_string(identity.type), to_string(identity.principalId), to_string(identity.userAssignedIdentities), to_string(length(properties.template.containers)), to_string(properties.template.containers[0].name)])" \
  -o tsv); then :; else
  fail "UI Container App '$CONTAINER_APP_NAME' does not exist or is not readable."
fi
IFS='|' read -r UI_ENVIRONMENT_ID UI_EXTERNAL UI_FQDN UI_TARGET_PORT UI_REVISIONS_MODE UI_IDENTITY_TYPE UI_SYSTEM_PRINCIPAL_ID UI_USER_IDENTITIES_JSON UI_CONTAINER_COUNT TARGET_CONTAINER_NAME <<< "$UI_DETAILS"
[ "$UI_ENVIRONMENT_ID" = "$AZURE_ENVIRONMENT_ID" ] || fail "UI Container App must use the resolved managed environment."
case "$UI_EXTERNAL" in true|True|TRUE) ;; *) fail "UI Container App '$CONTAINER_APP_NAME' must use external ingress." ;; esac
case "$UI_FQDN" in ""|null|Null|NULL) fail "UI Container App '$CONTAINER_APP_NAME' must have a public FQDN." ;; esac
[ "https://$UI_FQDN" = "$AZURE_UI_URL" ] || fail "UI Container App FQDN must match the resolved Azure UI URL."
[ "$UI_TARGET_PORT" = 3000 ] || fail "UI Container App '$CONTAINER_APP_NAME' target port must be exactly 3000."
case "$UI_REVISIONS_MODE" in [Ss][Ii][Nn][Gg][Ll][Ee]) ;; *) fail "UI Container App '$CONTAINER_APP_NAME' must use single-revision mode." ;; esac
case "$UI_IDENTITY_TYPE" in
  *[Ss]ystem[Aa]ssigned*)
    case "$UI_SYSTEM_PRINCIPAL_ID" in ""|null|Null|NULL) fail "UI Container App '$CONTAINER_APP_NAME' system-assigned identity principal is missing." ;; esac
    UI_PRINCIPAL_ID="$UI_SYSTEM_PRINCIPAL_ID"
    MANAGED_IDENTITY_REF=system
    ;;
  *[Uu]ser[Aa]ssigned*)
    if USER_IDENTITY_VALUES=$(printf '%s' "$UI_USER_IDENTITIES_JSON" | node -e '
const fs = require("node:fs");
let identities;
try {
  identities = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  process.exit(2);
}
if (identities === null || Array.isArray(identities) || typeof identities !== "object") process.exit(2);
const entries = Object.entries(identities);
if (entries.length !== 1) process.exit(3);
const [resourceId, metadata] = entries[0];
if (
  typeof resourceId !== "string" ||
  !/^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.managedidentity\/userassignedidentities\/[^/]+$/i.test(resourceId)
) process.exit(2);
if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") process.exit(2);
const principalId = metadata.principalId;
if (typeof principalId !== "string" || principalId.length === 0 || /[\u0000-\u001f\u007f]/.test(principalId)) process.exit(4);
process.stdout.write(`${resourceId}\t${principalId}`);
'); then
      :
    else
      status=$?
      case "$status" in
        3) fail "UI Container App '$CONTAINER_APP_NAME' must have exactly one user-assigned identity when no system-assigned identity exists." ;;
        4) fail "UI Container App '$CONTAINER_APP_NAME' user-assigned identity principal is missing." ;;
        *) fail "UI Container App '$CONTAINER_APP_NAME' returned invalid user-assigned identity metadata." ;;
      esac
    fi
    IFS=$'\t' read -r MANAGED_IDENTITY_REF UI_PRINCIPAL_ID <<< "$USER_IDENTITY_VALUES"
    unset USER_IDENTITY_VALUES
    ;;
  *) fail "UI Container App '$CONTAINER_APP_NAME' must have an existing managed identity." ;;
esac
[ "$UI_CONTAINER_COUNT" = 1 ] && [ -n "$TARGET_CONTAINER_NAME" ] || fail "UI Container App '$CONTAINER_APP_NAME' must have exactly one application container."
UI_URL="$AZURE_UI_URL"

if BACKEND_DETAILS=$(az containerapp show \
  --name "$BACKEND_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "join('|', [to_string(properties.managedEnvironmentId), to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn)])" \
  -o tsv); then :; else
  fail "backend Container App '$BACKEND_APP_NAME' does not exist or is not readable."
fi
IFS='|' read -r BACKEND_ENVIRONMENT_ID BACKEND_EXTERNAL BACKEND_FQDN <<< "$BACKEND_DETAILS"
[ "$BACKEND_ENVIRONMENT_ID" = "$AZURE_ENVIRONMENT_ID" ] || fail "backend Container App must use the resolved managed environment."
case "$BACKEND_EXTERNAL" in true|True|TRUE) ;; *) fail "backend Container App '$BACKEND_APP_NAME' must use external ingress." ;; esac
case "$BACKEND_FQDN" in ""|null|Null|NULL) fail "backend Container App '$BACKEND_APP_NAME' must have a public FQDN." ;; esac
[ "https://$BACKEND_FQDN" = "$BACKEND_URL" ] || fail "backend Container App FQDN must match the resolved backend URL."

if VAULT_DETAILS=$(az keyvault show --name "$KV_NAME" --resource-group "$RESOURCE_GROUP" --query "join('|', [properties.vaultUri, id, to_string(properties.enableRbacAuthorization), to_string(length(properties.accessPolicies[?objectId=='$UI_PRINCIPAL_ID' && (contains(permissions.secrets, 'get') || contains(permissions.secrets, 'all'))]))])" -o tsv); then :; else
  fail "Key Vault '$KV_NAME' does not exist or is not readable."
fi
IFS='|' read -r VAULT_URI VAULT_ID VAULT_RBAC_ENABLED VAULT_POLICY_ACCESS_COUNT <<< "$VAULT_DETAILS"
[ -n "$VAULT_URI" ] || fail "Key Vault '$KV_NAME' returned an empty vault URI."
[ -n "$VAULT_ID" ] || fail "Key Vault '$KV_NAME' returned an empty resource ID."
VAULT_URI="${VAULT_URI%/}/"

KEY_VAULT_ACCESS=false
case "$VAULT_RBAC_ENABLED" in
  false|False|FALSE)
    case "$VAULT_POLICY_ACCESS_COUNT" in ""|*[!0-9]*) fail "Key Vault access policy response is invalid." ;; esac
    [ "$VAULT_POLICY_ACCESS_COUNT" -gt 0 ] && KEY_VAULT_ACCESS=true
    ;;
  true|True|TRUE)
    if ROLE_DEFINITION_IDS=$(az role assignment list \
      --assignee-object-id "$UI_PRINCIPAL_ID" --scope "$VAULT_ID" --include-inherited \
      --query "[].roleDefinitionId" -o tsv); then :; else
      status=$?; echo "Error: could not validate managed identity Key Vault access." >&2; exit "$status"
    fi
    while IFS= read -r role_definition_id; do
      [ -n "$role_definition_id" ] || continue
      if ROLE_DEFINITION_JSON=$(az role definition list --name "$role_definition_id" -o json); then :; else
        status=$?; echo "Error: could not inspect Key Vault role capabilities." >&2; exit "$status"
      fi
      if ROLE_HAS_SECRET_READ=$(printf '%s' "$ROLE_DEFINITION_JSON" | \
        node "$SCRIPT_DIR/scripts/evaluate-keyvault-rbac.mjs"); then :; else
        status=$?; exit "$status"
      fi
      [ "$ROLE_HAS_SECRET_READ" = true ] && KEY_VAULT_ACCESS=true
    done <<EOF
$ROLE_DEFINITION_IDS
EOF
    ;;
  *) fail "Key Vault authorization mode is invalid." ;;
esac
[ "$KEY_VAULT_ACCESS" = true ] || fail "existing managed identity Key Vault secret read access is a deployment prerequisite; this deployment does not grant permissions."

if APP_SECRETS=$(az containerapp secret list \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].[name, keyVaultUrl, identity]" \
  -o json 2>/dev/null); then :; else
  status=$?; echo "Error: could not read Container App secrets for '$CONTAINER_APP_NAME'." >&2; exit "$status"
fi
if printf '%s' "$APP_SECRETS" | node -e '
const fs = require("node:fs");
const [vaultUri, identity] = process.argv.slice(1);
const safe = (value) => typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
let rows;
try { rows = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(2); }
if (!Array.isArray(rows) || rows.some((row) =>
  !Array.isArray(row) || row.length !== 3 || !safe(row[0]) ||
  !(row[1] === null || safe(row[1])) || !(row[2] === null || safe(row[2]))
)) process.exit(2);
const required = new Map([
  ["upload-api-key", [`${vaultUri}secrets/UPLOAD-API-KEY`, identity]],
  ["passkey-proxy-secret", [`${vaultUri}secrets/PASSKEY-PROXY-SECRET`, identity]],
  ["docker-hub-pat", [`${vaultUri}secrets/DOCKER-HUB-PAT`, identity]],
]);
for (const [name, [url, expectedIdentity]] of required) {
  const matches = rows.filter((row) => row[0] === name);
  if (matches.length !== 1) process.exit(2);
  if (matches[0][1] !== url) process.exit(2);
  if (typeof matches[0][2] !== "string" || matches[0][2].toLowerCase() !== expectedIdentity.toLowerCase()) process.exit(2);
}
' "$VAULT_URI" "$MANAGED_IDENTITY_REF"; then :; else
  fail "required Container App secret reference metadata is invalid."
fi
unset APP_SECRETS

if REGISTRIES=$(az containerapp registry list \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].[server, username, passwordSecretRef]" \
  -o json 2>/dev/null); then :; else
  status=$?; echo "Error: could not read Docker Hub registry configuration for '$CONTAINER_APP_NAME'." >&2; exit "$status"
fi
if printf '%s' "$REGISTRIES" | node -e '
const fs = require("node:fs");
const expectedUsername = process.argv[1];
const safe = (value) => typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
let rows;
try { rows = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(2); }
if (!Array.isArray(rows) || rows.some((row) =>
  !Array.isArray(row) || row.length !== 3 || row.some((value) => !safe(value))
)) process.exit(2);
const matches = rows.filter((row) => row[0] === "docker.io");
if (matches.length !== 1 || matches[0][1] !== expectedUsername || matches[0][2] !== "docker-hub-pat") process.exit(2);
' "$DOCKER_HUB_USERNAME"; then :; else
  fail "required Docker Hub registry metadata is invalid."
fi
unset REGISTRIES

echo "Container App: $CONTAINER_APP_NAME (container: $TARGET_CONTAINER_NAME)"
echo "Registry: docker.io"
echo "UI: $UI_URL"
echo "Backend: $BACKEND_URL"
echo "Assistant ID: $ASSISTANT_ID"
echo "Azure Container Apps preflight complete."

APP_RESOURCE_ID="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.App/containerApps/$CONTAINER_APP_NAME"
if INITIAL_DEPLOYMENT_METADATA=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[id,location,properties.latestReadyRevisionName]" \
  -o json 2>/dev/null); then :; else
  status=$?; echo "Error: could not read initial Container App deployment metadata." >&2; exit "$status"
fi
if INITIAL_DEPLOYMENT_VALUES=$(printf '%s' "$INITIAL_DEPLOYMENT_METADATA" | node -e '
const fs = require("node:fs");
const expectedId = process.argv[1];
const safe = (value) => typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
let value;
try { value = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(2); }
if (!Array.isArray(value) || value.length !== 3 || !safe(value[0]) || value[0].toLowerCase() !== expectedId.toLowerCase() || !safe(value[1]) || !safe(value[2])) process.exit(2);
process.stdout.write(`${value[1]}\t${value[2]}`);
' "$APP_RESOURCE_ID" 2>/dev/null); then :; else
  fail "initial Container App deployment metadata is invalid."
fi
unset INITIAL_DEPLOYMENT_METADATA
IFS=$'\t' read -r APP_LOCATION PREVIOUS_REVISION <<< "$INITIAL_DEPLOYMENT_VALUES"
unset INITIAL_DEPLOYMENT_VALUES
[ -n "$PREVIOUS_REVISION" ] || fail "previous ready Container App revision is empty."

TEMPLATE_BASELINE_JSON=$(umask 077; mktemp "${TMPDIR:-/tmp}/ui-containerapp-template.XXXXXX")
if READY_REVISION_TEMPLATE=$(az containerapp revision show \
  --name "$CONTAINER_APP_NAME" \
  --revision "$PREVIOUS_REVISION" \
  --resource-group "$RESOURCE_GROUP" \
  --query "{name:name,template:properties.template}" \
  -o json 2>/dev/null); then :; else
  status=$?; echo "Error: could not read ready revision template." >&2; exit "$status"
fi
if printf '%s' "$READY_REVISION_TEMPLATE" | node "$SCRIPT_DIR/scripts/containerapp-template-patch.mjs" \
  capture "$TEMPLATE_BASELINE_JSON" "$APP_LOCATION" "$PREVIOUS_REVISION" "$TARGET_CONTAINER_NAME" \
  >/dev/null 2>/dev/null; then :; else
  fail "ready revision template is invalid."
fi
unset READY_REVISION_TEMPLATE

REVISION_SUFFIX="ui-$(date -u +%Y%m%dt%H%M%S)-$$"
NEW_REVISION="${UI_APP_NAME}--${REVISION_SUFFIX}"
[ "$NEW_REVISION" != "$PREVIOUS_REVISION" ] || fail "new revision must be different from previous ready revision '$PREVIOUS_REVISION'."
UPDATE_PATCH_JSON=$(umask 077; mktemp "${TMPDIR:-/tmp}/ui-containerapp-update.XXXXXX")
if node "$SCRIPT_DIR/scripts/containerapp-template-patch.mjs" patch \
  "$TEMPLATE_BASELINE_JSON" "$UPDATE_PATCH_JSON" "$TARGET_CONTAINER_NAME" \
  "$REVISION_SUFFIX" "$EXPECTED_IMAGE" "$BACKEND_URL" "$ASSISTANT_ID" "$UI_URL" \
  >/dev/null 2>/dev/null; then :; else
  fail "could not prepare the Container App template update."
fi
if GUARDED_READY_REVISION=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.latestReadyRevisionName \
  -o tsv 2>/dev/null); then :; else
  status=$?; echo "Error: could not recheck latest ready revision." >&2; exit "$status"
fi
if node -e '
const [actual, expected] = process.argv.slice(1);
const safe = (value) => typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
if (!safe(actual)) process.exit(2);
if (actual !== expected) process.exit(3);
' "$GUARDED_READY_REVISION" "$PREVIOUS_REVISION" >/dev/null 2>/dev/null; then :; else
  status=$?
  [ "$status" -eq 3 ] && fail "latest ready revision changed during deployment; rerun after reviewing the concurrent deployment."
  fail "latest ready revision metadata is invalid."
fi
unset GUARDED_READY_REVISION
if az rest --method patch \
  --uri "${APP_RESOURCE_ID}?api-version=2025-07-01" \
  --headers Content-Type=application/merge-patch+json \
  --body "@$UPDATE_PATCH_JSON" \
  --output none >/dev/null 2>/dev/null; then :; else
  status=$?; echo "Error: Container App template update failed." >&2; exit "$status"
fi

LAST_PROVISIONING_STATE=""
LAST_RUNNING_STATE=""
LAST_HEALTH_STATE=""
revision_ready=false
attempt=1
while [ "$attempt" -le "$REVISION_POLL_ATTEMPTS" ]; do
  if APP_PROVISIONING_STATE=$(az containerapp show \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.provisioningState \
    -o tsv 2>/dev/null); then :; else
    status=$?; echo "Error: could not read Container App provisioning state." >&2; exit "$status"
  fi
  if ! [[ "$APP_PROVISIONING_STATE" =~ ^[A-Za-z]+$ ]]; then
    fail "Container App provisioning state is invalid."
  fi
  case "$APP_PROVISIONING_STATE" in
    [Ff][Aa][Ii][Ll][Ee][Dd]|[Cc][Aa][Nn][Cc][Ee][Ll][Ee][Dd])
      fail "Container App provisioning reached terminal state '$APP_PROVISIONING_STATE'."
      ;;
  esac
  if REVISION_STATUS=$(az containerapp revision show \
    --name "$CONTAINER_APP_NAME" \
    --revision "$NEW_REVISION" \
    --resource-group "$RESOURCE_GROUP" \
    --query "join('|', [properties.provisioningState, properties.runningState, properties.healthState])" \
    -o tsv 2>/dev/null); then
    IFS='|' read -r LAST_PROVISIONING_STATE LAST_RUNNING_STATE LAST_HEALTH_STATE <<< "$REVISION_STATUS"
  else
    status=$?
    if [ "$status" -eq 3 ] || [ "$status" -eq 4 ]; then
      LAST_PROVISIONING_STATE=NotFound
      LAST_RUNNING_STATE=NotFound
      LAST_HEALTH_STATE=NotFound
    else
      echo "Error: could not read revision '$NEW_REVISION' readiness." >&2
      exit "$status"
    fi
  fi
  case "$LAST_PROVISIONING_STATE|$LAST_RUNNING_STATE|$LAST_HEALTH_STATE" in
    *Failed*|*failed*|*FAILED*|*Degraded*|*degraded*|*DEGRADED*|*ActivationFailed*|*activationfailed*|*ACTIVATIONFAILED*|*Unhealthy*|*unhealthy*|*UNHEALTHY*)
      fail "revision '$NEW_REVISION' failed readiness: provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE health=$LAST_HEALTH_STATE."
      ;;
    [Pp][Rr][Oo][Vv][Ii][Ss][Ii][Oo][Nn][Ee][Dd]'|'[Rr][Uu][Nn][Nn][Ii][Nn][Gg]'|'[Hh][Ee][Aa][Ll][Tt][Hh][Yy])
      revision_ready=true; break ;;
    [Pp][Rr][Oo][Vv][Ii][Ss][Ii][Oo][Nn][Ee][Dd]'|'[Rr][Uu][Nn][Nn][Ii][Nn][Gg][Aa][Tt][Mm][Aa][Xx][Ss][Cc][Aa][Ll][Ee]'|'[Hh][Ee][Aa][Ll][Tt][Hh][Yy])
      revision_ready=true; break ;;
  esac
  [ "$attempt" -ge "$REVISION_POLL_ATTEMPTS" ] || sleep "$POLL_INTERVAL_SECONDS"
  attempt=$((attempt + 1))
done
[ "$revision_ready" = true ] || fail "timed out waiting for revision '$NEW_REVISION': provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE health=$LAST_HEALTH_STATE."

HEALTH_RESPONSE_PATH=$(mktemp "${TMPDIR:-/tmp}/deployment-version-response.XXXXXX")
HTTP_STATUS=""
HTTP_RESPONSE_BODY=""
EXPECTED_HTTP_BODY="${MANIFEST_MARKER}"$'\n'
LAST_CURL_STATUS=0
attempt=1
while [ "$attempt" -le "$HTTP_POLL_ATTEMPTS" ]; do
  : > "$HEALTH_RESPONSE_PATH"
  if HTTP_STATUS=$(curl \
    --silent --show-error --connect-timeout 10 --max-time 30 \
    --output "$HEALTH_RESPONSE_PATH" --write-out "%{http_code}" \
    "$UI_URL/deployment-version.txt"); then
    LAST_CURL_STATUS=0
  else
    LAST_CURL_STATUS=$?; HTTP_STATUS=""
  fi
  HTTP_RESPONSE_BODY=""
  while true; do
    response_line=""
    if IFS= read -r response_line; then
      HTTP_RESPONSE_BODY="${HTTP_RESPONSE_BODY}${response_line}"$'\n'
    else
      [ -z "$response_line" ] || HTTP_RESPONSE_BODY="${HTTP_RESPONSE_BODY}${response_line}"
      break
    fi
  done < "$HEALTH_RESPONSE_PATH"
  if [ "$LAST_CURL_STATUS" -eq 0 ] && [ "$HTTP_STATUS" = 200 ] && [ "$HTTP_RESPONSE_BODY" = "$EXPECTED_HTTP_BODY" ]; then
    if RESOLVER_OUTPUT=$(AZURE_SUBSCRIPTION_ID="$AZURE_SUBSCRIPTION_ID" \
      RESOURCE_GROUP="$RESOURCE_GROUP" ENV_NAME="$ENV_NAME" \
      BACKEND_APP_NAME="$BACKEND_APP_NAME" UI_APP_NAME="$UI_APP_NAME" \
      "$SCRIPT_DIR/scripts/resolve-azure-endpoints.sh"); then :; else
      status=$?; echo "Error: final endpoint comparison failed." >&2; exit "$status"
    fi
    [ "$RESOLVER_OUTPUT" = "$INITIAL_RESOLVER_OUTPUT" ] || fail "endpoint resolver changed during deployment."
    RESOLVER_EXPECTED_PATH=$(umask 077; mktemp "${TMPDIR:-/tmp}/resolved-endpoints-expected.XXXXXX")
    printf '%s\n' "$INITIAL_RESOLVER_OUTPUT" > "$RESOLVER_EXPECTED_PATH"
    if RESOLVER_OUTPUT=$(AZURE_SUBSCRIPTION_ID="$AZURE_SUBSCRIPTION_ID" \
      RESOURCE_GROUP="$RESOURCE_GROUP" ENV_NAME="$ENV_NAME" \
      BACKEND_APP_NAME="$BACKEND_APP_NAME" UI_APP_NAME="$UI_APP_NAME" \
      "$SCRIPT_DIR/scripts/resolve-azure-endpoints.sh" --record-if-current "$RESOLVER_EXPECTED_PATH"); then
      :
    else
      status=$?
      rm -f -- "$RESOLVER_EXPECTED_PATH"
      echo "Error: endpoint metadata recording failed." >&2
      exit "$status"
    fi
    rm -f -- "$RESOLVER_EXPECTED_PATH"
    [ "$RESOLVER_OUTPUT" = "$INITIAL_RESOLVER_OUTPUT" ] || fail "endpoint resolver changed during deployment."
    decode_resolver_output
    unset RESOLVER_OUTPUT INITIAL_RESOLVER_OUTPUT
    echo "Azure Container Apps deployment complete: $UI_URL"
    exit 0
  fi
  [ "$attempt" -ge "$HTTP_POLL_ATTEMPTS" ] || sleep "$POLL_INTERVAL_SECONDS"
  attempt=$((attempt + 1))
done
if [ "$LAST_CURL_STATUS" -ne 0 ]; then
  echo "Error: HTTP verification failed after $HTTP_POLL_ATTEMPTS attempts for '$UI_URL/deployment-version.txt' (curl=$LAST_CURL_STATUS previous=$PREVIOUS_REVISION new=$NEW_REVISION provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE)." >&2
  exit "$LAST_CURL_STATUS"
fi
fail "deployment marker verification timed out for '$UI_URL' (previous=$PREVIOUS_REVISION new=$NEW_REVISION provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE http=$HTTP_STATUS)."
