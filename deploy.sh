source ./env.sh

echo "🚀 Starting deployment process for deepagent-ui..."

# Get ACR credentials
echo "🔑 Retrieving Azure Container Registry credentials..."
export ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username -o tsv)
export ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query 'passwords[0].value' -o tsv)
echo "✅ Credentials retrieved successfully."

# Get the agent's internal FQDN
echo "🔍 Fetching internal FQDN for deep-research-agent..."
AGENT_FQDN=$(az containerapp show \
  --name deep-research-agent \
  --resource-group $RESOURCE_GROUP \
  --query properties.configuration.ingress.fqdn \
  -o tsv)

if [ -z "$AGENT_FQDN" ]; then
  echo "❌ Failed to retrieve Agent FQDN. Ensure 'deep-research-agent' is deployed."
  exit 1
fi
echo "✅ Agent FQDN: https://$AGENT_FQDN"

# Check if container app already exists
echo "📦 Checking Container App status..."
if az containerapp show --name deepagent-ui --resource-group $RESOURCE_GROUP &> /dev/null; then
  echo "📝 Container app 'deepagent-ui' already exists. Updating with new image..."
  
  # Update the container app with the new image
  az containerapp update \
    --name deepagent-ui \
    --resource-group $RESOURCE_GROUP \
    --image $ACR_NAME.azurecr.io/deepagent-ui:latest
  
  if [ $? -ne 0 ]; then
    echo "❌ Failed to update container app."
    exit 1
  fi

  # Restart the container to pick up the new image
  echo "🔄 Restarting container to apply new image..."
  az containerapp update \
    --name deepagent-ui \
    --resource-group $RESOURCE_GROUP \
    --set-env-vars RESTART_TRIGGER="$(date +%s)"
    
  if [ $? -ne 0 ]; then
    echo "❌ Failed to restart container app."
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
      NEXT_PUBLIC_LANGGRAPH_URL=https://$AGENT_FQDN \
      NEXT_PUBLIC_ASSISTANT_ID=research \
      NEXT_PUBLIC_LANGSMITH_API_KEY=$LANGCHAIN_API_KEY \
      NODE_ENV=production \
      PORT=3000
      
  if [ $? -ne 0 ]; then
    echo "❌ Failed to create container app."
    exit 1
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