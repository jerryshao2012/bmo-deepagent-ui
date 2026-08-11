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
      AZURE_SUBSCRIPTION_ID|RESOURCE_GROUP|ACR_NAME|KV_NAME|SEED|CONTAINER_APP_NAME|CONTAINER_CLI|CONTAINER_APP_REVISION_POLL_ATTEMPTS|CONTAINER_APP_HTTP_POLL_ATTEMPTS|CONTAINER_APP_POLL_INTERVAL_SECONDS|PATH|IFS|CDPATH|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|HOME|PWD|OLDPWD|TMPDIR|LD_*|DYLD_*)
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

ensure_container_cli_build_ready

IMAGE_NAME="$ACR_LOGIN_SERVER/deepagent-ui:latest"
BUILD_CONTEXT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/bmo-deepagent-ui-container-app.XXXXXX")
trap 'rm -rf "$BUILD_CONTEXT_DIR"' EXIT

rsync -a \
  --exclude-from="$SCRIPT_DIR/.dockerignore" \
  --exclude="Dockerfile" \
  "$SCRIPT_DIR/" \
  "$BUILD_CONTEXT_DIR/"
cp "$SCRIPT_DIR/Dockerfile" "$BUILD_CONTEXT_DIR/Dockerfile"
mkdir -p "$BUILD_CONTEXT_DIR/public"
DEPLOYMENT_MARKER="$(date -u +%Y%m%dT%H%M%SZ)-$$"
printf '%s\n' "$DEPLOYMENT_MARKER" > "$BUILD_CONTEXT_DIR/public/deployment-version.txt"

echo "Building $IMAGE_NAME..."
if container_cli_build \
  --platform linux/amd64 \
  --progress plain \
  --build-arg "NEXT_PUBLIC_LANGGRAPH_URL=$BACKEND_URL" \
  --build-arg "NEXT_PUBLIC_ASSISTANT_ID=$ASSISTANT_ID" \
  --tag "$IMAGE_NAME" \
  "$BUILD_CONTEXT_DIR"; then
  :
else
  status=$?
  echo "Error: container image build failed." >&2
  exit "$status"
fi

if ACR_ACCESS_TOKEN=$(az acr login \
  --name "$ACR_NAME" \
  --expose-token \
  --query accessToken \
  -o tsv); then
  :
else
  status=$?
  echo "Error: could not acquire an Azure Container Registry access token." >&2
  exit "$status"
fi
[ -n "$ACR_ACCESS_TOKEN" ] || fail "Azure Container Registry returned an empty access token."

if printf '%s\n' "$ACR_ACCESS_TOKEN" | container_cli_login \
  --username 00000000-0000-0000-0000-000000000000 \
  --password-stdin \
  "$ACR_LOGIN_SERVER"; then
  unset ACR_ACCESS_TOKEN
else
  status=$?
  unset ACR_ACCESS_TOKEN
  echo "Error: container registry login failed." >&2
  exit "$status"
fi

if container_cli_push "$IMAGE_NAME"; then
  :
else
  status=$?
  echo "Error: container image push failed." >&2
  exit "$status"
fi

if PREVIOUS_REVISION=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.latestReadyRevisionName \
  -o tsv); then
  :
else
  status=$?
  echo "Error: could not read the previous ready Container App revision." >&2
  exit "$status"
fi
[ -n "$PREVIOUS_REVISION" ] || fail "previous ready Container App revision is empty."

UPLOAD_SECRET_URI="${VAULT_URI%/}/secrets/UPLOAD-API-KEY"
if az containerapp secret set \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --secrets "upload-api-key=keyvaultref:$UPLOAD_SECRET_URI,identityref:system" \
  -o none; then
  :
else
  status=$?
  echo "Error: Container App Key Vault secret configuration failed." >&2
  exit "$status"
fi

REVISION_SUFFIX="ui-$(date -u +%Y%m%dt%H%M%S)-$$"
if az containerapp update \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --container-name "$TARGET_CONTAINER_NAME" \
  --image "$IMAGE_NAME" \
  --revision-suffix "$REVISION_SUFFIX" \
  --set-env-vars \
  "NEXT_TELEMETRY_DISABLED=1" \
  "NEXT_PUBLIC_LANGGRAPH_URL=$BACKEND_URL" \
  "BACKEND_API_URL=$BACKEND_URL" \
  "NEXT_PUBLIC_ASSISTANT_ID=$ASSISTANT_ID" \
  "AUTH_URL=$UI_URL" \
  "NEXTAUTH_URL=$UI_URL" \
  "AUTH_TRUST_HOST=true" \
  "NODE_ENV=production" \
  "UPLOAD_API_KEY=secretref:upload-api-key" \
  -o none; then
  :
else
  status=$?
  echo "Error: Container App update failed." >&2
  exit "$status"
fi

if NEW_REVISION=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.latestRevisionName \
  -o tsv); then
  :
else
  status=$?
  echo "Error: could not discover the new Container App revision." >&2
  exit "$status"
fi
[ -n "$NEW_REVISION" ] || fail "new Container App revision is empty."
[ "$NEW_REVISION" != "$PREVIOUS_REVISION" ] || \
  fail "new revision must be different from previous ready revision '$PREVIOUS_REVISION'."

LAST_PROVISIONING_STATE=""
LAST_RUNNING_STATE=""
revision_ready=false
attempt=1
while [ "$attempt" -le "$REVISION_POLL_ATTEMPTS" ]; do
  if REVISION_STATUS=$(az containerapp revision show \
    --name "$CONTAINER_APP_NAME" \
    --revision "$NEW_REVISION" \
    --resource-group "$RESOURCE_GROUP" \
    --query "join('|', [properties.provisioningState, properties.runningState])" \
    -o tsv); then
    :
  else
    status=$?
    echo "Error: could not read revision '$NEW_REVISION' readiness." >&2
    exit "$status"
  fi
  IFS='|' read -r LAST_PROVISIONING_STATE LAST_RUNNING_STATE <<< "$REVISION_STATUS"
  case "$LAST_PROVISIONING_STATE|$LAST_RUNNING_STATE" in
    *Failed*|*failed*|*FAILED*|*Degraded*|*degraded*|*DEGRADED*|*ActivationFailed*|*activationfailed*|*ACTIVATIONFAILED*)
      echo "Error: revision '$NEW_REVISION' failed readiness: provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE." >&2
      exit 1
      ;;
  esac
  case "$LAST_PROVISIONING_STATE|$LAST_RUNNING_STATE" in
    [Pp][Rr][Oo][Vv][Ii][Ss][Ii][Oo][Nn][Ee][Dd]'|'[Rr][Uu][Nn][Nn][Ii][Nn][Gg])
      revision_ready=true
      break
      ;;
  esac
  if [ "$attempt" -lt "$REVISION_POLL_ATTEMPTS" ]; then
    sleep "$POLL_INTERVAL_SECONDS"
  fi
  attempt=$((attempt + 1))
done

if [ "$revision_ready" != true ]; then
  echo "Error: timed out waiting for revision '$NEW_REVISION': provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE." >&2
  exit 1
fi

HEALTH_RESPONSE_PATH="$BUILD_CONTEXT_DIR/deployment-version-response.txt"
HTTP_STATUS=""
HTTP_RESPONSE_BODY=""
EXPECTED_HTTP_BODY="${DEPLOYMENT_MARKER}"$'\n'
LAST_CURL_STATUS=0
attempt=1
while [ "$attempt" -le "$HTTP_POLL_ATTEMPTS" ]; do
  : > "$HEALTH_RESPONSE_PATH"
  if HTTP_STATUS=$(curl \
    --silent \
    --show-error \
    --connect-timeout 10 \
    --max-time 30 \
    --output "$HEALTH_RESPONSE_PATH" \
    --write-out "%{http_code}" \
    "$UI_URL/deployment-version.txt"); then
    LAST_CURL_STATUS=0
  else
    LAST_CURL_STATUS=$?
    HTTP_STATUS=""
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

  if [ "$LAST_CURL_STATUS" -eq 0 ] && \
    [ "$HTTP_STATUS" = "200" ] && \
    [ "$HTTP_RESPONSE_BODY" = "$EXPECTED_HTTP_BODY" ]; then
    echo "Azure Container Apps deployment complete: $UI_URL"
    exit 0
  fi
  if [ "$attempt" -lt "$HTTP_POLL_ATTEMPTS" ]; then
    sleep "$POLL_INTERVAL_SECONDS"
  fi
  attempt=$((attempt + 1))
done

if [ "$LAST_CURL_STATUS" -ne 0 ]; then
  echo "Error: HTTP verification failed after $HTTP_POLL_ATTEMPTS attempts for '$UI_URL/deployment-version.txt' (curl=$LAST_CURL_STATUS previous=$PREVIOUS_REVISION new=$NEW_REVISION provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE)." >&2
  exit "$LAST_CURL_STATUS"
fi

echo "Error: deployment marker verification timed out for '$UI_URL' (previous=$PREVIOUS_REVISION new=$NEW_REVISION provisioning=$LAST_PROVISIONING_STATE running=$LAST_RUNNING_STATE http=$HTTP_STATUS)." >&2
exit 1
