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

# Skip ACR provisioning and login since we are using Docker Hub.
# Expecting DOCKER_HUB_USERNAME to be set in the environment or .env
if [ -z "$DOCKER_HUB_USERNAME" ]; then
  echo "❌ Error: DOCKER_HUB_USERNAME is not set. Please set it in your .env file."
  exit 1
fi

echo "🔨 Building Docker image locally for linux/amd64..."
FULL_IMAGE_NAME="$DOCKER_HUB_USERNAME/deepagent-ui:latest"

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