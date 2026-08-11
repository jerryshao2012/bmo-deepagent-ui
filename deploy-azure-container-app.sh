#!/bin/bash
set -eo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_SH_SKIP_DOCKER_SYNC_WAS_SET=false
if [ "${ENV_SH_SKIP_DOCKER_SYNC+x}" = "x" ]; then
  ENV_SH_SKIP_DOCKER_SYNC_WAS_SET=true
  ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS="$ENV_SH_SKIP_DOCKER_SYNC"
fi
ENV_SH_SKIP_DOCKER_SYNC=true
if source "$SCRIPT_DIR/env.sh"; then
  ENV_SH_SOURCE_STATUS=0
else
  ENV_SH_SOURCE_STATUS=$?
fi
if [ "$ENV_SH_SKIP_DOCKER_SYNC_WAS_SET" = true ]; then
  ENV_SH_SKIP_DOCKER_SYNC="$ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS"
else
  unset ENV_SH_SKIP_DOCKER_SYNC
fi
unset ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS ENV_SH_SKIP_DOCKER_SYNC_WAS_SET
[ "$ENV_SH_SOURCE_STATUS" -eq 0 ] || exit "$ENV_SH_SOURCE_STATUS"
unset ENV_SH_SOURCE_STATUS

source "$SCRIPT_DIR/scripts/azure-subscription.sh"
source "$SCRIPT_DIR/scripts/container-runtime.sh"

fail() {
  echo "Error: $*" >&2
  exit 1
}

dotenv_fail() {
  local line_number="$1"
  local message="$2"
  fail "$SCRIPT_DIR/.env.docker line $line_number: $message"
}

if [ -f "$SCRIPT_DIR/.env.docker" ]; then
  docker_env_line_number=0
  while IFS= read -r docker_env_line || [ -n "$docker_env_line" ]; do
    docker_env_line_number=$((docker_env_line_number + 1))
    docker_env_line="${docker_env_line%$'\r'}"
    case "$docker_env_line" in
      ""|\#*) continue ;;
    esac

    case "$docker_env_line" in
      *=*) ;;
      *) dotenv_fail "$docker_env_line_number" "unsupported syntax; expected KEY=VALUE." ;;
    esac

    key="${docker_env_line%%=*}"
    value="${docker_env_line#*=}"
    if ! [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      dotenv_fail "$docker_env_line_number" "key must be a shell identifier without 'export' or leading whitespace."
    fi

    case "$key" in
      AZURE_SUBSCRIPTION_ID|RESOURCE_GROUP|ACR_NAME|KV_NAME|SEED|CONTAINER_APP_NAME|CONTAINER_CLI|PATH|IFS|CDPATH|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|HOME|PWD|OLDPWD|TMPDIR|LD_*|DYLD_*)
        dotenv_fail "$docker_env_line_number" "protected deployment or shell control '$key' cannot be overridden."
        ;;
    esac

    case "$value" in
      \"*)
        case "$value" in
          \"*\")
            value="${value#\"}"
            value="${value%\"}"
            ;;
          *) dotenv_fail "$docker_env_line_number" "unmatched quote." ;;
        esac
        ;;
      \'*)
        case "$value" in
          \'*\')
            value="${value#\'}"
            value="${value%\'}"
            ;;
          *) dotenv_fail "$docker_env_line_number" "unmatched quote." ;;
        esac
        ;;
      *\"*|*\'*) dotenv_fail "$docker_env_line_number" "unmatched quote." ;;
    esac
    export "$key=$value"
  done < "$SCRIPT_DIR/.env.docker"
  unset docker_env_line docker_env_line_number key value
fi

ASSISTANT_ID="${NEXT_PUBLIC_ASSISTANT_ID:-research}"
CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-bmo-deepagent-ui-$SEED}"

require_nonempty() {
  local variable_name="$1"
  local value="${!variable_name}"
  [ -n "$value" ] || fail "$variable_name is required."
}

for variable_name in SEED RESOURCE_GROUP ACR_NAME KV_NAME CONTAINER_APP_NAME; do
  require_nonempty "$variable_name"
done

for required_command in az curl rsync node; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    fail "required command not found: $required_command"
  fi
done

select_container_cli
echo "Container runtime: $CONTAINER_CLI"

select_azure_subscription
echo "Azure subscription: $AZURE_SUBSCRIPTION_ID"

if ! az group show \
  --name "$RESOURCE_GROUP" \
  --query name \
  -o tsv >/dev/null; then
  fail "resource group '$RESOURCE_GROUP' does not exist or is not readable."
fi

if ACR_LOGIN_SERVER=$(az acr show \
  --name "$ACR_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query loginServer \
  -o tsv); then
  :
else
  fail "Azure Container Registry '$ACR_NAME' does not exist or is not readable."
fi
[ -n "$ACR_LOGIN_SERVER" ] || \
  fail "Azure Container Registry '$ACR_NAME' has no login server."

if UI_DETAILS=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "join('|', [to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn), to_string(properties.configuration.ingress.targetPort), to_string(properties.configuration.activeRevisionsMode), to_string(identity.type), to_string(length(properties.template.containers)), to_string(properties.template.containers[0].name)])" \
  -o tsv); then
  :
else
  fail "UI Container App '$CONTAINER_APP_NAME' does not exist or is not readable."
fi

IFS='|' read -r UI_EXTERNAL UI_FQDN UI_TARGET_PORT UI_REVISIONS_MODE \
  UI_IDENTITY_TYPE UI_CONTAINER_COUNT TARGET_CONTAINER_NAME <<< "$UI_DETAILS"

case "$UI_EXTERNAL" in
  true|True|TRUE) ;;
  *) fail "UI Container App '$CONTAINER_APP_NAME' must use external ingress." ;;
esac
case "$UI_FQDN" in
  ""|null|Null|NULL)
    fail "UI Container App '$CONTAINER_APP_NAME' must have a public FQDN."
    ;;
esac
[ "$UI_TARGET_PORT" = "3000" ] || \
  fail "UI Container App '$CONTAINER_APP_NAME' target port must be exactly 3000."
case "$UI_REVISIONS_MODE" in
  [Ss][Ii][Nn][Gg][Ll][Ee]) ;;
  *) fail "UI Container App '$CONTAINER_APP_NAME' must use single-revision mode." ;;
esac
case "$UI_IDENTITY_TYPE" in
  *SystemAssigned*|*systemassigned*|*SYSTEMASSIGNED*) ;;
  *) fail "UI Container App '$CONTAINER_APP_NAME' must have a system-assigned identity." ;;
esac
[ "$UI_CONTAINER_COUNT" = "1" ] && [ -n "$TARGET_CONTAINER_NAME" ] || \
  fail "UI Container App '$CONTAINER_APP_NAME' must have exactly one application container."

if UI_REGISTRIES=$(az containerapp registry list \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].join('|', [server, identity])" \
  -o tsv); then
  :
else
  fail "could not read ACR pull configuration for UI Container App '$CONTAINER_APP_NAME'."
fi

ACR_SERVER_CONFIGURED=false
ACR_SYSTEM_IDENTITY_CONFIGURED=false
while IFS='|' read -r registry_server registry_identity; do
  if [ "$registry_server" = "$ACR_LOGIN_SERVER" ]; then
    ACR_SERVER_CONFIGURED=true
    case "$registry_identity" in
      system|System|SYSTEM) ACR_SYSTEM_IDENTITY_CONFIGURED=true ;;
    esac
  fi
done <<EOF
$UI_REGISTRIES
EOF

[ "$ACR_SERVER_CONFIGURED" = true ] || \
  fail "UI Container App '$CONTAINER_APP_NAME' has no ACR pull configuration for '$ACR_LOGIN_SERVER'."
[ "$ACR_SYSTEM_IDENTITY_CONFIGURED" = true ] || \
  fail "UI Container App '$CONTAINER_APP_NAME' ACR pull configuration must use system identity."

BACKEND_APP_NAME="deep-research-agent-$SEED"
if BACKEND_DETAILS=$(az containerapp show \
  --name "$BACKEND_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "join('|', [to_string(properties.configuration.ingress.external), to_string(properties.configuration.ingress.fqdn)])" \
  -o tsv); then
  :
else
  fail "backend Container App '$BACKEND_APP_NAME' does not exist or is not readable."
fi

IFS='|' read -r BACKEND_EXTERNAL BACKEND_FQDN <<< "$BACKEND_DETAILS"
case "$BACKEND_EXTERNAL" in
  true|True|TRUE) ;;
  *) fail "backend Container App '$BACKEND_APP_NAME' must use external ingress." ;;
esac
case "$BACKEND_FQDN" in
  ""|null|Null|NULL)
    fail "backend Container App '$BACKEND_APP_NAME' must have a public FQDN."
    ;;
esac

UI_URL="https://$UI_FQDN"
BACKEND_URL="https://$BACKEND_FQDN"
NEXT_PUBLIC_LANGGRAPH_URL="$BACKEND_URL"
export NEXT_PUBLIC_LANGGRAPH_URL

if VAULT_URI=$(az keyvault show \
  --name "$KV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.vaultUri \
  -o tsv); then
  :
else
  fail "Key Vault '$KV_NAME' does not exist or is not readable."
fi
[ -n "$VAULT_URI" ] || fail "Key Vault '$KV_NAME' returned an empty vault URI."

if UPLOAD_SECRET_ID=$(az keyvault secret show \
  --vault-name "$KV_NAME" \
  --name UPLOAD-API-KEY \
  --query id \
  -o tsv); then
  :
else
  fail "Key Vault secret '$KV_NAME/UPLOAD-API-KEY' is unavailable."
fi
[ -n "$UPLOAD_SECRET_ID" ] || \
  fail "Key Vault secret '$KV_NAME/UPLOAD-API-KEY' returned an empty ID."

echo "Container App: $CONTAINER_APP_NAME (container: $TARGET_CONTAINER_NAME)"
echo "Registry: $ACR_LOGIN_SERVER"
echo "UI: $UI_URL"
echo "Backend: $BACKEND_URL"
echo "LangGraph URL: $NEXT_PUBLIC_LANGGRAPH_URL"
echo "Assistant ID: $ASSISTANT_ID"
echo "Key Vault: $VAULT_URI"
echo "Azure Container Apps preflight complete."
