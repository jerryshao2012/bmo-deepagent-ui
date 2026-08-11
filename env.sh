export SEED="0312"
# ACR names must be alphanumeric only and between 5 and 50 characters
export ACR_NAME="acrdeepagentsui$SEED"
export AZURE_SUBSCRIPTION_ID="31fcb880-f153-4bac-b91c-c694854c65ce"
# Create resource group
export RESOURCE_GROUP="resource-group-deep-agents-$SEED"
export LOCATION="canadacentral"
export ENV_NAME="env-name-deep-agents-$SEED"
export CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-bmo-deepagent-ui-$SEED}"

# Source the deep research agent URL
source ../deep-research/env.sh
export NEXT_PUBLIC_LANGGRAPH_URL=$DEEP_RESEARCH_AGENT_URL

# Key Vault name (fallback if deep-research env.sh is not available)
export KV_NAME="${KV_NAME:-kv-deep-agents-ui-$SEED}"

# Update .env.docker if it exists. Read-only deployment checks opt out explicitly.
if [ "${ENV_SH_SKIP_DOCKER_SYNC:-false}" != "true" ] && [ -f .env.docker ]; then
  # Use a temporary file to avoid issues with read/write on the same file
  tmp_file=$(mktemp)

  # Ensure NEXT_PUBLIC_LANGGRAPH_URL is set, even if it's not in the file yet
  found=false

  # Read line by line and update if necessary
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line == NEXT_PUBLIC_LANGGRAPH_URL=* ]]; then
      echo "NEXT_PUBLIC_LANGGRAPH_URL=\"$NEXT_PUBLIC_LANGGRAPH_URL\"" >> "$tmp_file"
      found=true
    else
      echo "$line" >> "$tmp_file"
    fi
  done < .env.docker

  # If the variable was not found, append it
  if ! $found; then
    echo "\nNEXT_PUBLIC_LANGGRAPH_URL=\"$NEXT_PUBLIC_LANGGRAPH_URL\"" >> "$tmp_file"
  fi

  # Replace the original file with the updated one
  mv "$tmp_file" .env.docker
  echo "✅ .env.docker updated with new NEXT_PUBLIC_LANGGRAPH_URL."
fi

source ./.env
