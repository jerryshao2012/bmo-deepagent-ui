#!/bin/bash
set -e

source ./env.sh
source ./scripts/azure-subscription.sh
source ./scripts/container-runtime.sh

if ! command -v az >/dev/null 2>&1; then
  echo "❌ Required command not found: az"
  exit 1
fi

select_azure_subscription
echo "Azure subscription: $AZURE_SUBSCRIPTION_ID"

select_container_cli
echo "📦 Using container runtime: $CONTAINER_CLI"

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
ensure_container_cli_build_ready

# Use the full Docker Hub registry host in the image name for pushing.
FULL_IMAGE_NAME="docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest"

# Stage regular build inputs into a clean, ignored directory to avoid filesystem metadata failures.
BUILD_CONTEXT_DIR=$(mktemp -d ".container-build-context.XXXXXX")
trap 'rm -rf "$BUILD_CONTEXT_DIR"' EXIT
rsync -a \
  --exclude-from=".dockerignore" \
  ./ "$BUILD_CONTEXT_DIR/"
cp Dockerfile "$BUILD_CONTEXT_DIR/Dockerfile"

if ! container_cli_build \
    --platform linux/amd64 \
    --build-arg NEXT_PUBLIC_LANGGRAPH_URL="$NEXT_PUBLIC_LANGGRAPH_URL" \
    --build-arg NEXT_PUBLIC_ASSISTANT_ID="${NEXT_PUBLIC_ASSISTANT_ID:-research}" \
    -t "$FULL_IMAGE_NAME" \
    "$BUILD_CONTEXT_DIR"; then
  echo "❌ Local container build failed."
  exit 1
fi
echo "✅ Local build completed successfully."

# Push with the selected container runtime.
echo "⬆️ Pushing image to Docker Hub..."
if ! container_cli_push "$FULL_IMAGE_NAME"; then
  echo "❌ Image push failed for '$FULL_IMAGE_NAME'."
  exit 1
fi

echo "✅ Image built and pushed successfully"
