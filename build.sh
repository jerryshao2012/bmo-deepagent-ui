source ./env.sh

echo "🚀 Starting build process for deepagent-ui..."

# 1. Ensure the registry exists
echo "📦 Checking Container Registry status..."
if az acr show --name $ACR_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
  echo "✅ Container Registry '$ACR_NAME' already exists. Skipping creation."
else
  echo "✨ Creating new Container Registry '$ACR_NAME' in resource group '$RESOURCE_GROUP'..."
  az acr create --resource-group $RESOURCE_GROUP --name $ACR_NAME --sku Standard --admin-enabled true
  if [ $? -ne 0 ]; then
    echo "❌ Failed to create Container Registry."
    exit 1
  fi
  echo "✅ Container Registry created successfully."
fi

# 2. Ensure you are logged in to ACR
echo "🔑 Logging in to Azure Container Registry '$ACR_NAME'..."
az acr login --name $ACR_NAME
echo "✅ Successfully logged in to ACR."

# 3. Build the image in ACR to avoid local amd64/QEMU build crashes on Apple Silicon
echo "🔨 Building Docker image in ACR for linux/amd64..."
az acr build \
  --registry "$ACR_NAME" \
  --image deepagent-ui:latest \
  --platform linux/amd64 \
  .
if [ $? -ne 0 ]; then
  echo "❌ ACR build failed."
  exit 1
fi
echo "✅ ACR build completed successfully."

echo "🎉 Build and deployment to ACR completed successfully!"
