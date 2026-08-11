#!/bin/bash

select_azure_subscription() {
  if [ -z "${AZURE_SUBSCRIPTION_ID:-}" ]; then
    echo "Error: AZURE_SUBSCRIPTION_ID is required." >&2
    return 1
  fi

  local current_subscription
  if current_subscription=$(az account show --query id -o tsv); then
    :
  else
    local status=$?
    echo "Error: Azure CLI is not authenticated; run 'az login'." >&2
    return "$status"
  fi

  if az account set --subscription "$AZURE_SUBSCRIPTION_ID"; then
    :
  else
    local status=$?
    echo "Error: could not select Azure subscription '$AZURE_SUBSCRIPTION_ID'." >&2
    return "$status"
  fi

  if current_subscription=$(az account show --query id -o tsv); then
    :
  else
    local status=$?
    echo "Error: could not confirm active Azure subscription." >&2
    return "$status"
  fi

  if [ "$current_subscription" != "$AZURE_SUBSCRIPTION_ID" ]; then
    echo "Error: active subscription '$current_subscription' does not match requested '$AZURE_SUBSCRIPTION_ID'." >&2
    return 1
  fi
}
