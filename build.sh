#!/bin/bash
set -e

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

echo "🔨 Building container image locally for linux/amd64..."
# Ensure container service is started
if ! container system status &>/dev/null; then
  echo "🚀 Container system is not running. Auto-starting..."
  container system start --disable-kernel-install
fi
# The container tool requires the full registry host in the image name for pushing.
FULL_IMAGE_NAME="docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest"

container build --platform linux/amd64 -t $FULL_IMAGE_NAME .
if [ $? -ne 0 ]; then
  echo "❌ Local container build failed."
  exit 1
fi
echo "✅ Local build completed successfully."

# Use Container for build and push image
# brew install container
# container registry login docker.io
echo "⬆️ Pushing image to Docker Hub..."
container image push "$FULL_IMAGE_NAME"
if [ $? -ne 0 ]; then
  echo "❌ Container push failed for '$FULL_IMAGE_NAME'."
  exit 1
fi

echo "✅ Image built and pushed successfully"