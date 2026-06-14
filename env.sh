export SEED="0312"
# ACR names must be alphanumeric only and between 5 and 50 characters
export ACR_NAME="acrdeepagentsui$SEED"
# Create resource group
export RESOURCE_GROUP="resource-group-deep-agents-$SEED"
export LOCATION="canadacentral"
export ENV_NAME="env-name-deep-agents-$SEED"

# Source the deep research agent URL
source ../deepagents-demo/deep_research/env.sh
export NEXT_PUBLIC_LANGGRAPH_URL=$DEEP_RESEARCH_AGENT_URL

# Update .env.docker if it exists
if [ -f .env.docker ]; then
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
