export SEED="0312"
# ACR names must be alphanumeric only and between 5 and 50 characters
export ACR_NAME="acrdeepagentsui$SEED"
# Create resource group
export RESOURCE_GROUP="resource-group-deep-agents-$SEED"
export LOCATION="canadacentral"
export ENV_NAME="env-name-deep-agents-$SEED"

source ./.env
