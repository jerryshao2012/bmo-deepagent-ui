#!/bin/bash

XTRACE_WAS_ENABLED=false
case "$-" in
  *x*)
    XTRACE_WAS_ENABLED=true
    set +x
    ;;
esac

ALLEXPORT_WAS_ENABLED=false
case "$-" in
  *a*)
    ALLEXPORT_WAS_ENABLED=true
    set +a
    ;;
esac
export -n ALLEXPORT_WAS_ENABLED 2>/dev/null || :
unset LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE

set -eo pipefail

print_usage() {
  echo "Usage: ./build.sh [--container-cli RUNTIME|-c RUNTIME]"
  echo "       ./build.sh --container-cli=RUNTIME"
  echo "RUNTIME: container, podman, or docker"
}

unset CLI_CONTAINER_CLI CLI_CONTAINER_CLI_SEEN CLI_CONTAINER_CLI_PATH
CLI_CONTAINER_CLI=""
CLI_CONTAINER_CLI_SEEN=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      if [ "$#" -ne 1 ] || [ "$CLI_CONTAINER_CLI_SEEN" = true ]; then
        echo "Error: --help must be used alone." >&2
        exit 64
      fi
      print_usage
      exit 0
      ;;
    --container-cli|-c)
      if [ "$CLI_CONTAINER_CLI_SEEN" = true ]; then
        echo "Error: container runtime option may be supplied only once." >&2
        exit 64
      fi
      if [ "$#" -lt 2 ] || [ -z "$2" ]; then
        echo "Error: $1 requires a runtime value." >&2
        exit 64
      fi
      CLI_CONTAINER_CLI="$2"
      CLI_CONTAINER_CLI_SEEN=true
      shift 2
      ;;
    --container-cli=*)
      if [ "$CLI_CONTAINER_CLI_SEEN" = true ]; then
        echo "Error: container runtime option may be supplied only once." >&2
        exit 64
      fi
      CLI_CONTAINER_CLI="${1#--container-cli=}"
      if [ -z "$CLI_CONTAINER_CLI" ]; then
        echo "Error: --container-cli requires a runtime value." >&2
        exit 64
      fi
      CLI_CONTAINER_CLI_SEEN=true
      shift
      ;;
    *)
      echo "Error: unknown argument '$1'." >&2
      exit 64
      ;;
  esac
done

if [ "$CLI_CONTAINER_CLI_SEEN" = true ]; then
  case "$CLI_CONTAINER_CLI" in
    container|podman|docker) ;;
    *)
      echo "Error: container runtime must be one of: container, podman, docker." >&2
      exit 64
      ;;
  esac
  CLI_CONTAINER_CLI_PATH="$(type -P -- "$CLI_CONTAINER_CLI" 2>/dev/null)" || {
    echo "Error: requested container runtime '$CLI_CONTAINER_CLI' is not on PATH." >&2
    exit 64
  }
  if [ ! -f "$CLI_CONTAINER_CLI_PATH" ] || [ ! -x "$CLI_CONTAINER_CLI_PATH" ]; then
    echo "Error: requested container runtime '$CLI_CONTAINER_CLI' is not on PATH." >&2
    exit 64
  fi
  unset CLI_CONTAINER_CLI_PATH
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export -n EXPORTED_DOCKER_HUB_PAT_VALUE 2>/dev/null || :
EXPORTED_DOCKER_HUB_PAT_VALUE="${DOCKER_HUB_PAT-}"
CALLER_DOCKER_HUB_USERNAME="${DOCKER_HUB_USERNAME-}"
CALLER_CONTAINER_CLI_WAS_SET=false
if [ "${CONTAINER_CLI+x}" = x ]; then
  CALLER_CONTAINER_CLI_WAS_SET=true
  CALLER_CONTAINER_CLI="$CONTAINER_CLI"
fi

if ENV_CONFIG_OUTPUT=$(BASH_ENV=/dev/null ENV=/dev/null DOCKER_HUB_PAT= DOCKER_HUB_PAT_VALUE= ENV_SH_SKIP_DOCKER_SYNC=true \
  /bin/bash --noprofile --norc -c '
set +x
if source "$1" >/dev/null 2>/dev/null; then
  :
else
  exit $?
fi
set +x
builtin trap - EXIT ERR DEBUG RETURN
builtin printf "SEED=%s\n" "${SEED-}"
builtin printf "AZURE_SUBSCRIPTION_ID=%s\n" "${AZURE_SUBSCRIPTION_ID-}"
builtin printf "RESOURCE_GROUP=%s\n" "${RESOURCE_GROUP-}"
builtin printf "LOCATION=%s\n" "${LOCATION-}"
builtin printf "KV_NAME=%s\n" "${KV_NAME-}"
builtin printf "ENV_NAME=%s\n" "${ENV_NAME-}"
builtin printf "BACKEND_APP_NAME=%s\n" "${BACKEND_APP_NAME-}"
builtin printf "UI_APP_NAME=%s\n" "${UI_APP_NAME-}"
builtin printf "CONTAINER_APP_NAME=%s\n" "${CONTAINER_APP_NAME-}"
builtin printf "NEXT_PUBLIC_ASSISTANT_ID=%s\n" "${NEXT_PUBLIC_ASSISTANT_ID-}"
' build-env "$SCRIPT_DIR/env.sh" 2>/dev/null); then
  :
else
  status=$?
  echo "Error: env.sh configuration failed." >&2
  exit "$status"
fi

CONFIG_LINE_COUNT=0
while IFS= read -r config_line || [ -n "$config_line" ]; do
  CONFIG_LINE_COUNT=$((CONFIG_LINE_COUNT + 1))
  case "$CONFIG_LINE_COUNT:$config_line" in
    1:SEED=*) SEED="${config_line#SEED=}" ;;
    2:AZURE_SUBSCRIPTION_ID=*) AZURE_SUBSCRIPTION_ID="${config_line#AZURE_SUBSCRIPTION_ID=}" ;;
    3:RESOURCE_GROUP=*) RESOURCE_GROUP="${config_line#RESOURCE_GROUP=}" ;;
    4:LOCATION=*) LOCATION="${config_line#LOCATION=}" ;;
    5:KV_NAME=*) KV_NAME="${config_line#KV_NAME=}" ;;
    6:ENV_NAME=*) ENV_NAME="${config_line#ENV_NAME=}" ;;
    7:BACKEND_APP_NAME=*) BACKEND_APP_NAME="${config_line#BACKEND_APP_NAME=}" ;;
    8:UI_APP_NAME=*) UI_APP_NAME="${config_line#UI_APP_NAME=}" ;;
    9:CONTAINER_APP_NAME=*) CONTAINER_APP_NAME="${config_line#CONTAINER_APP_NAME=}" ;;
    10:NEXT_PUBLIC_ASSISTANT_ID=*) NEXT_PUBLIC_ASSISTANT_ID="${config_line#NEXT_PUBLIC_ASSISTANT_ID=}" ;;
    *)
      echo "Error: env.sh returned invalid configuration." >&2
      exit 1
      ;;
  esac
done <<< "$ENV_CONFIG_OUTPUT"
[ "$CONFIG_LINE_COUNT" -eq 10 ] || {
  echo "Error: env.sh returned incomplete configuration." >&2
  exit 1
}

set +x
trap - EXIT ERR DEBUG RETURN
unset ENV_CONFIG_OUTPUT CONFIG_LINE_COUNT config_line
ENTRY_XTRACE_WAS_ENABLED="$XTRACE_WAS_ENABLED"
unset XTRACE_WAS_ENABLED XTRACE_RESTORED ALLEXPORT_RESTORED SCRIPT_DIR BUILD_CONTEXT_DIR MANIFEST_TEMP
unset DOCKER_HUB_PAT_VALUE ENV_SH_SKIP_DOCKER_SYNC ENV_SH_SKIP_DOCKER_SYNC_WAS_SET
unset ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS ENV_SH_SOURCE_STATUS
unset APPROVED_DOCKER_HUB_USERNAME ASSISTANT_ID IMAGE_NAME DEPLOYMENT_MARKER LOGIN_STATUS
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
XTRACE_WAS_ENABLED="$ENTRY_XTRACE_WAS_ENABLED"
unset ENTRY_XTRACE_WAS_ENABLED
BUILD_CONTEXT_DIR=""
MANIFEST_TEMP=""
XTRACE_RESTORED=false
ALLEXPORT_RESTORED=false
DOCKER_HUB_PAT_VALUE="$EXPORTED_DOCKER_HUB_PAT_VALUE"
DOCKER_HUB_USERNAME="$CALLER_DOCKER_HUB_USERNAME"
if [ "$CLI_CONTAINER_CLI_SEEN" = true ]; then
  CONTAINER_CLI="$CLI_CONTAINER_CLI"
elif [ "$CALLER_CONTAINER_CLI_WAS_SET" = true ]; then
  CONTAINER_CLI="$CALLER_CONTAINER_CLI"
else
  unset CONTAINER_CLI
fi
unset DOCKER_HUB_PAT EXPORTED_DOCKER_HUB_PAT_VALUE CALLER_DOCKER_HUB_USERNAME
unset CALLER_CONTAINER_CLI CALLER_CONTAINER_CLI_WAS_SET
unset CLI_CONTAINER_CLI CLI_CONTAINER_CLI_SEEN

restore_xtrace() {
  if [ "$XTRACE_WAS_ENABLED" = true ] && [ "$XTRACE_RESTORED" = false ]; then
    XTRACE_RESTORED=true
    set -x
  fi
}

restore_allexport() {
  if [ "$ALLEXPORT_WAS_ENABLED" = true ] && [ "$ALLEXPORT_RESTORED" = false ]; then
    ALLEXPORT_RESTORED=true
    set -a
  fi
}

cleanup() {
  local status=$?
  set +x +e
  unset DOCKER_HUB_PAT DOCKER_HUB_PAT_VALUE
  if [ -n "$BUILD_CONTEXT_DIR" ]; then
    rm -rf -- "$BUILD_CONTEXT_DIR" || :
  fi
  if [ -n "$MANIFEST_TEMP" ]; then
    rm -f -- "$MANIFEST_TEMP" || :
  fi
  restore_allexport
  restore_xtrace
  return "$status"
}
trap cleanup EXIT

fail() {
  echo "Error: $*" >&2
  exit 1
}

dotenv_fail() {
  local file="$1"
  local line_number="$2"
  local message="$3"
  fail "$file line $line_number: $message"
}

load_docker_env() {
  local docker_env_path="$SCRIPT_DIR/.env.docker"
  [ -f "$docker_env_path" ] || return 0

  local line_number=0
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line_number=$((line_number + 1))
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*) continue ;;
      *=*) ;;
      *) dotenv_fail "$docker_env_path" "$line_number" "unsupported syntax; expected KEY=VALUE." ;;
    esac

    key="${line%%=*}"
    value="${line#*=}"
    if ! [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      dotenv_fail "$docker_env_path" "$line_number" "key must be a shell identifier without 'export' or leading whitespace."
    fi
    case "$key" in
      NEXT_PUBLIC_ASSISTANT_ID|NEXT_PUBLIC_LANGGRAPH_URL) ;;
      AZURE_SUBSCRIPTION_ID|RESOURCE_GROUP|ACR_NAME|KV_NAME|SEED|CONTAINER_APP_NAME|CONTAINER_CLI|DOCKER_HUB_USERNAME|DOCKER_HUB_PAT|XTRACE_WAS_ENABLED|XTRACE_RESTORED|ALLEXPORT_WAS_ENABLED|ALLEXPORT_RESTORED|SCRIPT_DIR|BUILD_CONTEXT_DIR|MANIFEST_TEMP|DOCKER_HUB_PAT_VALUE|EXPORTED_DOCKER_HUB_PAT_VALUE|CALLER_DOCKER_HUB_USERNAME|CALLER_CONTAINER_CLI_WAS_SET|CALLER_CONTAINER_CLI|CLI_CONTAINER_CLI|CLI_CONTAINER_CLI_SEEN|CLI_CONTAINER_CLI_PATH|ENTRY_XTRACE_WAS_ENABLED|ENV_CONFIG_OUTPUT|CONFIG_LINE_COUNT|ENV_SH_SKIP_DOCKER_SYNC|ENV_SH_SKIP_DOCKER_SYNC_WAS_SET|ENV_SH_SKIP_DOCKER_SYNC_PREVIOUS|ENV_SH_SOURCE_STATUS|APPROVED_DOCKER_HUB_USERNAME|ASSISTANT_ID|IMAGE_NAME|DEPLOYMENT_MARKER|LOGIN_STATUS|PATH|IFS|CDPATH|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|HOME|PWD|OLDPWD|TMPDIR|PS4|BASH_XTRACEFD|PROMPT_COMMAND|BASH_COMPAT|POSIXLY_CORRECT|GLOBIGNORE|NODE_OPTIONS|DOCKER_CONFIG|REGISTRY_AUTH_FILE|LD_*|DYLD_*)
        dotenv_fail "$docker_env_path" "$line_number" "protected deployment, credential, or shell control '$key' cannot be overridden."
        ;;
    esac
    case "$value" in
      \"*)
        case "$value" in
          \"*\") value="${value#\"}"; value="${value%\"}" ;;
          *) dotenv_fail "$docker_env_path" "$line_number" "unmatched quote." ;;
        esac
        ;;
      \'*)
        case "$value" in
          \'*\') value="${value#\'}"; value="${value%\'}" ;;
          *) dotenv_fail "$docker_env_path" "$line_number" "unmatched quote." ;;
        esac
        ;;
      *\"*|*\'*) dotenv_fail "$docker_env_path" "$line_number" "unmatched quote." ;;
    esac
    if [ "$key" = NEXT_PUBLIC_ASSISTANT_ID ]; then
      NEXT_PUBLIC_ASSISTANT_ID="$value"
    fi
  done < "$docker_env_path"
}

load_sibling_docker_hub_pat() {
  local backend_env_path="$SCRIPT_DIR/../deep-research/.env"
  [ -f "$backend_env_path" ] || return 0

  local line_number=0
  local line value
  local found=false
  while IFS= read -r line || [ -n "$line" ]; do
    line_number=$((line_number + 1))
    line="${line%$'\r'}"
    case "$line" in
      DOCKER_HUB_PAT=*)
        [ "$found" = false ] || dotenv_fail "$backend_env_path" "$line_number" "duplicate DOCKER_HUB_PAT."
        found=true
        value="${line#*=}"
        case "$value" in
          \"*)
            case "$value" in
              \"*\") value="${value#\"}"; value="${value%\"}" ;;
              *) dotenv_fail "$backend_env_path" "$line_number" "unmatched DOCKER_HUB_PAT quote." ;;
            esac
            ;;
          \'*)
            case "$value" in
              \'*\') value="${value#\'}"; value="${value%\'}" ;;
              *) dotenv_fail "$backend_env_path" "$line_number" "unmatched DOCKER_HUB_PAT quote." ;;
            esac
            ;;
          *\"*|*\'*) dotenv_fail "$backend_env_path" "$line_number" "unmatched DOCKER_HUB_PAT quote." ;;
        esac
        DOCKER_HUB_PAT_VALUE="$value"
        ;;
    esac
  done < "$backend_env_path"
}

decode_resolver_output() {
  local line key value
  local assignment_count=0
  local seen_keys="|"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=\'([^\']*)\'$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
    else
      fail "endpoint resolver returned invalid output."
    fi
    case "$seen_keys" in
      *"|$key|"*) fail "endpoint resolver returned duplicate key '$key'." ;;
    esac
    seen_keys="${seen_keys}${key}|"
    assignment_count=$((assignment_count + 1))
    case "$key" in
      AZURE_ENVIRONMENT_ID) AZURE_ENVIRONMENT_ID="$value" ;;
      AZURE_ENVIRONMENT_DEFAULT_DOMAIN) AZURE_ENVIRONMENT_DEFAULT_DOMAIN="$value" ;;
      BACKEND_APP_NAME) RESOLVED_BACKEND_APP_NAME="$value" ;;
      UI_APP_NAME) RESOLVED_UI_APP_NAME="$value" ;;
      BACKEND_URL) NEXT_PUBLIC_LANGGRAPH_URL="$value" ;;
      AZURE_UI_URL) AZURE_UI_URL="$value" ;;
      FRONTEND_URLS) FRONTEND_URLS="$value" ;;
      GOOGLE_CALLBACK_URL) GOOGLE_CALLBACK_URL="$value" ;;
      GITHUB_CALLBACK_URL) GITHUB_CALLBACK_URL="$value" ;;
      GITHUB_HOMEPAGE_URL) GITHUB_HOMEPAGE_URL="$value" ;;
      CHANGED) RESOLVED_ENDPOINTS_CHANGED="$value" ;;
      *) fail "endpoint resolver returned unknown key '$key'." ;;
    esac
  done <<< "$RESOLVER_OUTPUT"
  [ "$assignment_count" -eq 11 ] || fail "endpoint resolver returned incomplete output."
  [ "$RESOLVED_BACKEND_APP_NAME" = "$BACKEND_APP_NAME" ] || fail "endpoint resolver backend app mismatch."
  [ "$RESOLVED_UI_APP_NAME" = "$UI_APP_NAME" ] || fail "endpoint resolver UI app mismatch."
  case "$RESOLVED_ENDPOINTS_CHANGED" in true|false) ;; *) fail "endpoint resolver returned invalid CHANGED value." ;; esac
  [ -n "$NEXT_PUBLIC_LANGGRAPH_URL" ] || fail "endpoint resolver returned an empty BACKEND_URL."
}

if RESOLVER_OUTPUT=$(AZURE_SUBSCRIPTION_ID="$AZURE_SUBSCRIPTION_ID" \
  RESOURCE_GROUP="$RESOURCE_GROUP" ENV_NAME="$ENV_NAME" \
  BACKEND_APP_NAME="$BACKEND_APP_NAME" UI_APP_NAME="$UI_APP_NAME" \
  "$SCRIPT_DIR/scripts/resolve-azure-endpoints.sh"); then
  :
else
  status=$?
  echo "Error: endpoint resolver failed." >&2
  exit "$status"
fi
decode_resolver_output
unset RESOLVER_OUTPUT

if [ -f "$SCRIPT_DIR/.env.docker" ]; then
  command -v node >/dev/null 2>&1 || fail "required command not found: node"
  if node "$SCRIPT_DIR/scripts/sanitize-passkey-dotenv.mjs" \
    --input "$SCRIPT_DIR/.env.docker" --check; then
    :
  else
    status=$?
    echo "Error: private dotenv contains deployment-owned passkey configuration." >&2
    exit "$status"
  fi
fi

load_docker_env
unset LANGCHAIN_API_KEY UPLOAD_API_KEY PASSKEY_PROXY_SECRET NODE_OPTIONS DOCKER_CONFIG REGISTRY_AUTH_FILE

APPROVED_DOCKER_HUB_USERNAME="jerryshao2013"
if [ -n "${DOCKER_HUB_USERNAME-}" ] && [ "$DOCKER_HUB_USERNAME" != "$APPROVED_DOCKER_HUB_USERNAME" ]; then
  fail "DOCKER_HUB_USERNAME must be exactly '$APPROVED_DOCKER_HUB_USERNAME'."
fi
DOCKER_HUB_USERNAME="$APPROVED_DOCKER_HUB_USERNAME"
ASSISTANT_ID="${NEXT_PUBLIC_ASSISTANT_ID:-research}"
[ -n "$ASSISTANT_ID" ] || fail "NEXT_PUBLIC_ASSISTANT_ID is required."

source "$SCRIPT_DIR/scripts/container-runtime.sh"
for required_command in node rsync; do
  command -v "$required_command" >/dev/null 2>&1 || fail "required command not found: $required_command"
done

select_container_cli
ensure_container_cli_build_ready
echo "Container runtime: $CONTAINER_CLI"

IMAGE_NAME="docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest"
BUILD_CONTEXT_DIR=$(mktemp -d ".container-build-context.XXXXXX")
rsync -a \
  --exclude-from=".dockerignore" \
  --exclude=".deployment-build.json" \
  --exclude=".deployment-build.json.tmp.*" \
  ./ "$BUILD_CONTEXT_DIR/"
cp Dockerfile "$BUILD_CONTEXT_DIR/Dockerfile"
mkdir -p "$BUILD_CONTEXT_DIR/public"
DEPLOYMENT_MARKER="$(date -u +%Y%m%dT%H%M%SZ)-$$"
printf '%s\n' "$DEPLOYMENT_MARKER" > "$BUILD_CONTEXT_DIR/public/deployment-version.txt"

echo "Building $IMAGE_NAME..."
if container_cli_build \
  --platform linux/amd64 \
  --build-arg "NEXT_PUBLIC_LANGGRAPH_URL=$NEXT_PUBLIC_LANGGRAPH_URL" \
  --build-arg "NEXT_PUBLIC_ASSISTANT_ID=$ASSISTANT_ID" \
  -t "$IMAGE_NAME" \
  "$BUILD_CONTEXT_DIR"; then
  :
else
  status=$?
  echo "Error: container image build failed." >&2
  exit "$status"
fi

if [ -z "$DOCKER_HUB_PAT_VALUE" ]; then
  load_sibling_docker_hub_pat
fi
[ -n "$DOCKER_HUB_PAT_VALUE" ] || fail "DOCKER_HUB_PAT is required (export it or add only that key to ../deep-research/.env)."

if printf '%s\n' "$DOCKER_HUB_PAT_VALUE" | container_cli_login \
  --username "$DOCKER_HUB_USERNAME" \
  --password-stdin \
  docker.io; then
  LOGIN_STATUS=0
else
  LOGIN_STATUS=$?
fi
unset DOCKER_HUB_PAT_VALUE
restore_allexport
restore_xtrace
if [ "$LOGIN_STATUS" -ne 0 ]; then
  echo "Error: Docker Hub login failed." >&2
  exit "$LOGIN_STATUS"
fi
unset LOGIN_STATUS

if container_cli_push "$IMAGE_NAME"; then
  :
else
  status=$?
  echo "Error: container image push failed." >&2
  exit "$status"
fi

MANIFEST_TEMP=$(mktemp "$SCRIPT_DIR/.deployment-build.json.tmp.XXXXXX")
if node -e '
const fs = require("node:fs");
const [file, deploymentMarker, image, backendUrl, assistantId] = process.argv.slice(1);
fs.writeFileSync(
  file,
  `${JSON.stringify({ schemaVersion: 1, deploymentMarker, image, backendUrl, assistantId }, null, 2)}\n`,
  { encoding: "utf8", flag: "w" }
);
' "$MANIFEST_TEMP" "$DEPLOYMENT_MARKER" "$IMAGE_NAME" "$NEXT_PUBLIC_LANGGRAPH_URL" "$ASSISTANT_ID"; then
  :
else
  status=$?
  echo "Error: could not write deployment build manifest." >&2
  exit "$status"
fi
if mv -- "$MANIFEST_TEMP" "$SCRIPT_DIR/.deployment-build.json"; then
  MANIFEST_TEMP=""
else
  status=$?
  echo "Error: could not publish deployment build manifest." >&2
  exit "$status"
fi

echo "Image built and pushed: $IMAGE_NAME"
