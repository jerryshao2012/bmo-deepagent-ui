# Source the deep research agent URL first to get DEEP_RESEARCH_AGENT_URL
source ../deep-research/env-aws.sh
export NEXT_PUBLIC_LANGGRAPH_URL=$DEEP_RESEARCH_AGENT_URL

export SEED="0312"
export APP_NAME="deepagent-ui-$SEED"

# AWS Configuration
export AWS_REGION="us-east-1"
export AWS_PAGER=""

# 1. Build and push Docker image (ECR)
export ECR_REPO_NAME="deepagent-ui-$SEED"

# Secrets Management (Secrets Manager)
export SECRETS_MANAGER_NAME="kv-deepagent-ui-$SEED"


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
    echo "" >> "$tmp_file"
    echo "NEXT_PUBLIC_LANGGRAPH_URL=\"$NEXT_PUBLIC_LANGGRAPH_URL\"" >> "$tmp_file"
  fi

  # Replace the original file with the updated one
  mv "$tmp_file" .env.docker
  echo "✅ .env.docker updated with new NEXT_PUBLIC_LANGGRAPH_URL."
fi

if [ -f .env ]; then
  source ./.env
fi
