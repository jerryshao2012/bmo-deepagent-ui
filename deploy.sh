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