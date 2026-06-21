source ./env.sh
# Overwrite with docker/production environment variables
if [ -f .env.docker ]; then
  echo "📖 Loading production environment variables from .env.docker..."
  # Use a more robust way to source variables that handles quotes and comments
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ $key =~ ^#.* ]] || [[ -z $key ]] && continue
    # Strip potential quotes from value
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    export "$key=$value"
  done < .env.docker
fi

echo "🚀 Starting deployment process for deepagent-ui..."

# Fetch secrets from Azure Key Vault if available (overrides env vars)
if [ -n "$KV_NAME" ]; then
  echo "🔐 Attempting to fetch secrets from Azure Key Vault: $KV_NAME"
  KV_LANGCHAIN_API_KEY=$(az keyvault secret show --vault-name $KV_NAME --name LANGCHAIN-API-KEY --query value -o tsv 2>/dev/null)
  KV_AUTH_SECRET=$(az keyvault secret show --vault-name $KV_NAME --name AUTH-SECRET --query value -o tsv 2>/dev/null)
  KV_AUTH_GITHUB_ID=$(az keyvault secret show --vault-name $KV_NAME --name AUTH-GITHUB-ID --query value -o tsv 2>/dev/null)
  KV_AUTH_GITHUB_SECRET=$(az keyvault secret show --vault-name $KV_NAME --name AUTH-GITHUB-SECRET --query value -o tsv 2>/dev/null)
  KV_AUTH_GOOGLE_ID=$(az keyvault secret show --vault-name $KV_NAME --name AUTH-GOOGLE-ID --query value -o tsv 2>/dev/null)
  KV_AUTH_GOOGLE_SECRET=$(az keyvault secret show --vault-name $KV_NAME --name AUTH-GOOGLE-SECRET --query value -o tsv 2>/dev/null)

  # Override env vars with Key Vault values if available
  [ -n "$KV_LANGCHAIN_API_KEY" ] && export LANGCHAIN_API_KEY="$KV_LANGCHAIN_API_KEY" && echo "  ✓ LANGCHAIN_API_KEY from Key Vault"
  [ -n "$KV_AUTH_SECRET" ] && export AUTH_SECRET="$KV_AUTH_SECRET" && echo "  ✓ AUTH_SECRET from Key Vault"
  [ -n "$KV_AUTH_GITHUB_ID" ] && export AUTH_GITHUB_ID="$KV_AUTH_GITHUB_ID" && echo "  ✓ AUTH_GITHUB_ID from Key Vault"
  [ -n "$KV_AUTH_GITHUB_SECRET" ] && export AUTH_GITHUB_SECRET="$KV_AUTH_GITHUB_SECRET" && echo "  ✓ AUTH_GITHUB_SECRET from Key Vault"
  [ -n "$KV_AUTH_GOOGLE_ID" ] && export AUTH_GOOGLE_ID="$KV_AUTH_GOOGLE_ID" && echo "  ✓ AUTH_GOOGLE_ID from Key Vault"
  [ -n "$KV_AUTH_GOOGLE_SECRET" ] && export AUTH_GOOGLE_SECRET="$KV_AUTH_GOOGLE_SECRET" && echo "  ✓ AUTH_GOOGLE_SECRET from Key Vault"

  if [ -z "$KV_LANGCHAIN_API_KEY" ] && [ -z "$KV_AUTH_SECRET" ]; then
    echo "  ⚠️  No secrets found in Key Vault, falling back to environment variables"
  fi
else
  echo "  ⚠️  KV_NAME not set, using environment variables for secrets"
fi

# Get ACR credentials
echo "🔑 Retrieving Azure Container Registry credentials..."
export ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username -o tsv)
export ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query 'passwords[0].value' -o tsv)
echo "✅ Credentials retrieved successfully."

# Get the agent's internal FQDN
echo "🔍 Fetching internal FQDN for deep-research-agent-$SEED..."
AGENT_FQDN=$(az containerapp show \
  --name deep-research-agent-$SEED \
  --resource-group $RESOURCE_GROUP \
  --query properties.configuration.ingress.fqdn \
  -o tsv)

if [ -z "$AGENT_FQDN" ]; then
  echo "❌ Failed to retrieve Agent FQDN. Ensure 'deep-research-agent-$SEED' is deployed."
  exit 1
fi
echo "✅ Agent FQDN: https://$AGENT_FQDN"

# Check if container app already exists
echo "📦 Checking Container App status..."
UI_FQDN=$(az containerapp show --name deepagent-ui --resource-group $RESOURCE_GROUP --query properties.configuration.ingress.fqdn -o tsv 2>/dev/null)

if [ -n "$UI_FQDN" ]; then
  echo "📝 Container app 'deepagent-ui' already exists. Updating with new image..."
  echo "✅ UI FQDN: https://$UI_FQDN"
  
  # Ensure the container app has registry credentials configured for the current ACR
  echo "🔑 Setting registry credentials for $ACR_NAME.azurecr.io..."
  az containerapp registry set \
    --name deepagent-ui \
    --resource-group $RESOURCE_GROUP \
    --server $ACR_NAME.azurecr.io \
    --username $ACR_USERNAME \
    --password $ACR_PASSWORD
  
  # Update the container app with the new image and ensure all environment variables are set
  az containerapp update \
    --name deepagent-ui \
    --resource-group $RESOURCE_GROUP \
    --image $ACR_NAME.azurecr.io/deepagent-ui:latest \
    --set-env-vars \
      NEXT_PUBLIC_LANGGRAPH_URL=${NEXT_PUBLIC_LANGGRAPH_URL:-https://$AGENT_FQDN} \
      NEXT_PUBLIC_ASSISTANT_ID=${NEXT_PUBLIC_ASSISTANT_ID:-research} \
      NEXT_PUBLIC_LANGSMITH_API_KEY=$LANGCHAIN_API_KEY \
      AUTH_SECRET=$AUTH_SECRET \
      AUTH_GITHUB_ID=$AUTH_GITHUB_ID \
      AUTH_GITHUB_SECRET=$AUTH_GITHUB_SECRET \
      AUTH_GOOGLE_ID=$AUTH_GOOGLE_ID \
      AUTH_GOOGLE_SECRET=$AUTH_GOOGLE_SECRET \
      AUTH_TRUST_HOST=true \
      AUTH_URL=https://$UI_FQDN \
      NEXTAUTH_URL=https://$UI_FQDN \
      NODE_ENV=production \
      PORT=3000 \
      RESTART_TRIGGER="$(date +%s)"
    
  if [ $? -ne 0 ]; then
    echo "❌ Failed to update container app."
    exit 1
  fi
else
  echo "✨ Creating new container app 'deepagent-ui'..."
  az containerapp create \
    --name deepagent-ui \
    --resource-group $RESOURCE_GROUP \
    --environment $ENV_NAME \
    --image $ACR_NAME.azurecr.io/deepagent-ui:latest \
    --registry-server $ACR_NAME.azurecr.io \
    --registry-username $ACR_USERNAME \
    --registry-password $ACR_PASSWORD \
    --target-port 3000 \
    --ingress external \
    --min-replicas 1 \
    --cpu 1.0 \
    --memory 2Gi \
    --env-vars \
      NEXT_PUBLIC_LANGGRAPH_URL=${NEXT_PUBLIC_LANGGRAPH_URL:-https://$AGENT_FQDN} \
      NEXT_PUBLIC_ASSISTANT_ID=${NEXT_PUBLIC_ASSISTANT_ID:-research} \
      NEXT_PUBLIC_LANGSMITH_API_KEY=$LANGCHAIN_API_KEY \
      AUTH_SECRET=$AUTH_SECRET \
      AUTH_GITHUB_ID=$AUTH_GITHUB_ID \
      AUTH_GITHUB_SECRET=$AUTH_GITHUB_SECRET \
      AUTH_GOOGLE_ID=$AUTH_GOOGLE_ID \
      AUTH_GOOGLE_SECRET=$AUTH_GOOGLE_SECRET \
      AUTH_TRUST_HOST=true \
      NODE_ENV=production \
      PORT=3000
      
  if [ $? -ne 0 ]; then
    echo "❌ Failed to create container app."
    exit 1
  fi

  # After creation, we need to set AUTH_URL since we now have the FQDN
  echo "🌐 Retrieving public URL to set AUTH_URL..."
  UI_FQDN=$(az containerapp show \
    --name deepagent-ui \
    --resource-group $RESOURCE_GROUP \
    --query properties.configuration.ingress.fqdn \
    -o tsv)
  
  if [ -n "$UI_FQDN" ]; then
    echo "📝 Setting AUTH_URL to https://$UI_FQDN..."
    az containerapp update \
      --name deepagent-ui \
      --resource-group $RESOURCE_GROUP \
      --set-env-vars \
        AUTH_URL=https://$UI_FQDN \
        NEXTAUTH_URL=https://$UI_FQDN
  fi
fi

# Retrieve and display the public URL
echo "🌐 Retrieving public URL for deepagent-ui..."
PUBLIC_URL=$(az containerapp show \
  --name deepagent-ui \
  --resource-group $RESOURCE_GROUP \
  --query properties.configuration.ingress.fqdn \
  -o tsv)

if [ -n "$PUBLIC_URL" ]; then
  echo "🎉 Deployment completed successfully!"
  echo "🔗 Public URL: https://$PUBLIC_URL"
else
  echo "⚠️ Deployment finished, but could not retrieve the public URL immediately. Please check the Azure Portal."
fi