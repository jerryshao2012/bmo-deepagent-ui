#!/bin/bash
set -eo pipefail

source ./env.sh
source ./scripts/azure-subscription.sh

if [ -f .env.docker ]; then
  echo "📖 Loading production environment variables from .env.docker..."
  while IFS='=' read -r key value || [ -n "$key" ]; do
    [[ "$key" =~ ^#.*$ ]] || [ -z "$key" ] && continue
    value="${value%$'\r'}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    export "$key=$value"
  done < .env.docker
fi

for required_command in az yarn zip curl grep; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "❌ Required command not found: $required_command"
    exit 1
  fi
done

select_azure_subscription
echo "Azure subscription: $AZURE_SUBSCRIPTION_ID"

WEBAPP_NAME="${WEBAPP_NAME:-bmo-deepagent-ui-$SEED}"
ASSISTANT_ID="${NEXT_PUBLIC_ASSISTANT_ID:-research}"

fail_if_webapp_quota_exceeded() {
  local webapp_status
  local webapp_state
  local webapp_usage_state

  if ! webapp_status=$(az webapp show \
    --name "$WEBAPP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "join('|', [state, usageState])" \
    -o tsv); then
    echo "❌ Could not read App Service quota status."
    return 1
  fi

  webapp_state="${webapp_status%%|*}"
  webapp_usage_state="${webapp_status#*|}"
  if [ "$webapp_state" = "QuotaExceeded" ] || \
    [ "$webapp_usage_state" = "Exceeded" ]; then
    echo "❌ App Service F1 quota is exceeded; Azure has disabled both the site and deployment endpoint."
    echo "   Azure state: $webapp_state; usage state: $webapp_usage_state."
    echo "   Wait for the quota reset shown under App Service > Quotas, then rerun ./deploy.sh."
    echo "   To deploy immediately, scale the App Service plan above F1 (paid)."
    return 1
  fi
}

echo "🚀 Starting App Service F1 deployment for $WEBAPP_NAME..."
echo "🌐 Checking App Service status..."
if ! WEBAPP_HOST=$(az webapp show \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query defaultHostName \
  -o tsv); then
  echo "❌ App Service '$WEBAPP_NAME' was not found in '$RESOURCE_GROUP'."
  exit 1
fi

if [ -z "$WEBAPP_HOST" ]; then
  echo "❌ App Service '$WEBAPP_NAME' has no default hostname."
  exit 1
fi

fail_if_webapp_quota_exceeded || exit 1

WEBAPP_URL="https://$WEBAPP_HOST"
echo "✅ App Service: $WEBAPP_URL"

echo "🔍 Fetching backend Container App hostname..."
if ! AGENT_FQDN=$(az containerapp show \
  --name "deep-research-agent-$SEED" \
  --resource-group "$RESOURCE_GROUP" \
  --query properties.configuration.ingress.fqdn \
  -o tsv); then
  echo "❌ Backend Container App 'deep-research-agent-$SEED' was not found."
  exit 1
fi

if [ -z "$AGENT_FQDN" ]; then
  echo "❌ Backend Container App has no ingress hostname."
  exit 1
fi
BACKEND_URL="https://$AGENT_FQDN"
export NEXT_PUBLIC_LANGGRAPH_URL="$BACKEND_URL"
export NEXT_PUBLIC_ASSISTANT_ID="$ASSISTANT_ID"
echo "✅ Backend: $BACKEND_URL"

echo "🔐 Checking Key Vault upload secret..."
if ! az keyvault secret show \
  --vault-name "$KV_NAME" \
  --name UPLOAD-API-KEY \
  --query id \
  -o tsv >/dev/null; then
  echo "❌ Key Vault secret '$KV_NAME/UPLOAD-API-KEY' is unavailable."
  exit 1
fi

echo "⚙️ Configuring App Service runtime..."
current_runtime_config=$(az webapp config show \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "join('|', [linuxFxVersion, appCommandLine, to_string(alwaysOn), to_string(http20Enabled), minTlsVersion, ftpsState, to_string(webSocketsEnabled)])" \
  -o tsv)
expected_runtime_config="NODE|22-lts|node server.cjs|false|true|1.2|Disabled|true"

if [ "$current_runtime_config" != "$expected_runtime_config" ]; then
  az webapp config set \
    --name "$WEBAPP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --linux-fx-version "NODE|22-lts" \
    --startup-file "node server.cjs" \
    --always-on false \
    --http20-enabled true \
    --min-tls-version 1.2 \
    --ftps-state Disabled \
    --web-sockets-enabled true \
    -o none
else
  echo "✅ App Service runtime already configured; skipping restart."
fi

current_https_only=$(az webapp show \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query httpsOnly \
  -o tsv)
if [ "$current_https_only" != "true" ]; then
  az webapp update \
    --name "$WEBAPP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --https-only true \
    -o none
else
  echo "✅ HTTPS-only already enabled."
fi

desired_app_settings=(
  "SCM_DO_BUILD_DURING_DEPLOYMENT=false"
  "ENABLE_ORYX_BUILD=false"
  "NEXT_TELEMETRY_DISABLED=1"
  "NEXT_PUBLIC_LANGGRAPH_URL=$BACKEND_URL"
  "BACKEND_API_URL=$BACKEND_URL"
  "NEXT_PUBLIC_ASSISTANT_ID=$ASSISTANT_ID"
  "MARKDOWN_STORAGE_DIR=/home/data/markdown_threads"
  "AUTH_URL=$WEBAPP_URL"
  "NEXTAUTH_URL=$WEBAPP_URL"
  "AUTH_TRUST_HOST=true"
  "NODE_ENV=production"
  "UPLOAD_API_KEY=@Microsoft.KeyVault(VaultName=${KV_NAME};SecretName=UPLOAD-API-KEY)"
)
current_app_settings=$(az webapp config appsettings list \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "[].join('=', [name, value])" \
  -o tsv)
app_settings_changed=false
for desired_setting in "${desired_app_settings[@]}"; do
  if ! grep -Fqx -- "$desired_setting" <<< "$current_app_settings"; then
    app_settings_changed=true
    break
  fi
done

if $app_settings_changed; then
  az webapp config appsettings set \
    --name "$WEBAPP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --settings "${desired_app_settings[@]}" \
    -o none
else
  echo "✅ App settings already current; skipping restart."
fi

echo "📦 Installing dependencies and building production bundle..."
if [ -d node_modules ]; then
  echo "🧹 Removing stale installed dependencies..."
  rm -rf -- node_modules
fi
yarn install --immutable
yarn build

DEPLOY_TMP_ROOT="${TMPDIR:-/tmp}"
DEPLOY_WORK_DIR=$(mktemp -d "$DEPLOY_TMP_ROOT/bmo-deepagent-ui-deploy.XXXXXX")
PACKAGE_ROOT="$DEPLOY_WORK_DIR/package"
PACKAGE_PATH="$DEPLOY_WORK_DIR/app.zip"
DEPLOYMENT_MARKER="$(date -u +%Y%m%dT%H%M%SZ)-$$"
HEALTH_RESPONSE_PATH="$DEPLOY_WORK_DIR/health-response.txt"
trap 'rm -rf "$DEPLOY_WORK_DIR"' EXIT
mkdir -p "$PACKAGE_ROOT/.next" "$PACKAGE_ROOT/public"

cp -R .next/standalone/. "$PACKAGE_ROOT/"
mkdir -p "$PACKAGE_ROOT/node_modules/next"
cp -R node_modules/next/. "$PACKAGE_ROOT/node_modules/next/"
cp -R node_modules/ws "$PACKAGE_ROOT/node_modules/ws"
cp -R .next/static "$PACKAGE_ROOT/.next/static"
cp -R public/. "$PACKAGE_ROOT/public/"
cp server.cjs "$PACKAGE_ROOT/server.cjs"
cp -R runtime "$PACKAGE_ROOT/runtime"
printf '%s\n' "$DEPLOYMENT_MARKER" > "$PACKAGE_ROOT/public/deployment-version.txt"
find "$PACKAGE_ROOT" -maxdepth 1 -type f -name '.env*' -delete

echo "🗜️ Creating standalone deployment package..."
(
  cd "$PACKAGE_ROOT"
  zip -qry "$PACKAGE_PATH" .
)

fail_if_webapp_quota_exceeded || exit 1

echo "☁️ Deploying package to App Service..."
if ! az webapp deploy \
  --name "$WEBAPP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --src-path "$PACKAGE_PATH" \
  --type zip \
  --clean true \
  --restart true \
  --track-status false \
  --timeout 600000 \
  -o none; then
  fail_if_webapp_quota_exceeded || exit 1
  echo "❌ App Service package deployment failed."
  exit 1
fi

echo "🩺 Verifying deployed site..."
HTTP_STATUS=""
DEPLOYED_MARKER=""
for attempt in {1..36}; do
  HTTP_STATUS=$(curl -sS -o "$HEALTH_RESPONSE_PATH" -w "%{http_code}" \
    --connect-timeout 10 \
    --max-time 30 \
    "$WEBAPP_URL/deployment-version.txt" || true)
  if [ -f "$HEALTH_RESPONSE_PATH" ]; then
    DEPLOYED_MARKER=$(<"$HEALTH_RESPONSE_PATH")
  fi
  if [ "$HTTP_STATUS" = "200" ] && \
    [ "$DEPLOYED_MARKER" = "$DEPLOYMENT_MARKER" ]; then
    echo "✅ Deployment completed successfully (HTTP $HTTP_STATUS)."
    echo "🔗 Public URL: $WEBAPP_URL"
    exit 0
  fi
  fail_if_webapp_quota_exceeded || exit 1
  echo "   New deployment not ready (HTTP ${HTTP_STATUS:-000}); retrying ($attempt/36)..."
  sleep 5
done

echo "❌ Deployment finished, but health verification failed with HTTP ${HTTP_STATUS:-000}."
exit 1
