source ./env.sh

echo "🚀 Starting build process for deepagent-ui..."

# 0. Ensure the resource group exists
echo "🌍 Checking Resource Group status..."
if az group show --name $RESOURCE_GROUP &> /dev/null; then
  echo "✅ Resource Group '$RESOURCE_GROUP' already exists. Skipping creation."
else
  echo "✨ Creating new Resource Group '$RESOURCE_GROUP' in location '$LOCATION'..."
  az group create --name $RESOURCE_GROUP --location $LOCATION
  if [ $? -ne 0 ]; then
    echo "❌ Failed to create Resource Group."
    exit 1
  fi
  echo "✅ Resource Group created successfully."
fi

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
if [ $? -ne 0 ]; then
  echo "❌ ACR login failed."
  exit 1
fi
echo "✅ Successfully logged in to ACR."

# 3. Build locally and push since ACR Tasks are blocked on this subscription
# Note: Since ACR Tasks (az acr build) is blocked by Azure for this subscription,
# we need to build it locally and push it.
echo "🔨 Building Docker image locally for linux/amd64..."
ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer --output tsv)
FULL_IMAGE_NAME="$ACR_LOGIN_SERVER/deepagent-ui:latest"

docker build --platform linux/amd64 -t $FULL_IMAGE_NAME .
if [ $? -ne 0 ]; then
  echo "❌ Local docker build failed."
  exit 1
fi
echo "✅ Local build completed successfully."

echo "⬆️ Pushing image to ACR..."
docker push $FULL_IMAGE_NAME
if [ $? -ne 0 ]; then
  echo "❌ Docker push failed."
  exit 1
fi

echo "🎉 Build and deployment to ACR completed successfully!"