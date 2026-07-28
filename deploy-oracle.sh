#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Usage: ./deploy-oracle.sh

Deploy existing linux/amd64 image to an Oracle AMD VM.

Required configuration:
  ORACLE_HOST             Oracle VM hostname or IP address
  ORACLE_SSH_KEY          Path to readable SSH private key
  DOCKER_HUB_USERNAME     Docker Hub username

Optional configuration:
  ORACLE_USER             SSH user (default: opc)
  ORACLE_SSH_PORT         SSH port (default: 22)
  ORACLE_HTTP_PORT        Public HTTP port (default: 80)
  ORACLE_CONTAINER_NAME   Container name (default: deepagent-ui)
  ORACLE_IMAGE            Image (default: docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest)
  ORACLE_PUBLIC_URL       Public URL (default: http://host or http://host:port)
  ORACLE_ENV_FILE         Environment file (default: .env.docker)

Configuration may be set in env-oracle.sh beside this script.
EOF
}

case "${1:-}" in
  --help|-h)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [ -f "$SCRIPT_DIR/env-oracle.sh" ]; then
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/env-oracle.sh"
fi

for command in ssh scp curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf '%s is required\n' "$command" >&2
    exit 1
  fi
done

require_variable() {
  local variable_name="$1"
  if [ -z "${!variable_name:-}" ]; then
    printf '%s is required\n' "$variable_name" >&2
    exit 1
  fi
}

require_variable ORACLE_HOST
require_variable ORACLE_SSH_KEY
require_variable DOCKER_HUB_USERNAME

ORACLE_USER="${ORACLE_USER:-opc}"
ORACLE_SSH_PORT="${ORACLE_SSH_PORT:-22}"
ORACLE_HTTP_PORT="${ORACLE_HTTP_PORT:-80}"
ORACLE_CONTAINER_NAME="${ORACLE_CONTAINER_NAME:-deepagent-ui}"
ORACLE_IMAGE="${ORACLE_IMAGE:-docker.io/$DOCKER_HUB_USERNAME/deepagent-ui:latest}"
ORACLE_ENV_FILE="${ORACLE_ENV_FILE:-$SCRIPT_DIR/.env.docker}"

if [ "$ORACLE_HTTP_PORT" = "80" ]; then
  ORACLE_PUBLIC_URL="${ORACLE_PUBLIC_URL:-http://$ORACLE_HOST}"
else
  ORACLE_PUBLIC_URL="${ORACLE_PUBLIC_URL:-http://$ORACLE_HOST:$ORACLE_HTTP_PORT}"
fi

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

if ! valid_port "$ORACLE_SSH_PORT"; then
  printf 'ORACLE_SSH_PORT must be between 1 and 65535\n' >&2
  exit 1
fi
if ! valid_port "$ORACLE_HTTP_PORT"; then
  printf 'ORACLE_HTTP_PORT must be between 1 and 65535\n' >&2
  exit 1
fi
if ! [[ "$ORACLE_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf 'ORACLE_USER is invalid\n' >&2
  exit 1
fi
if ! [[ "$ORACLE_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  printf 'ORACLE_HOST is invalid\n' >&2
  exit 1
fi
if ! [[ "$ORACLE_CONTAINER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  printf 'ORACLE_CONTAINER_NAME is invalid\n' >&2
  exit 1
fi
if ! [[ "$ORACLE_IMAGE" =~ ^[A-Za-z0-9._/@:-]+$ ]]; then
  printf 'ORACLE_IMAGE is invalid\n' >&2
  exit 1
fi
if [ ! -r "$ORACLE_SSH_KEY" ]; then
  printf 'ORACLE_SSH_KEY must be readable\n' >&2
  exit 1
fi
if [ ! -r "$ORACLE_ENV_FILE" ]; then
  printf 'ORACLE_ENV_FILE must be readable\n' >&2
  exit 1
fi

REMOTE="$ORACLE_USER@$ORACLE_HOST"
SSH_ARGS=(-i "$ORACLE_SSH_KEY" -p "$ORACLE_SSH_PORT" -o BatchMode=yes)
SCP_ARGS=(-i "$ORACLE_SSH_KEY" -P "$ORACLE_SSH_PORT" -o BatchMode=yes)

remote_bash() {
  local remote_command="bash -s --"
  local argument quoted_argument
  for argument in "$@"; do
    printf -v quoted_argument '%q' "$argument"
    remote_command+=" $quoted_argument"
  done
  ssh "${SSH_ARGS[@]}" "$REMOTE" "$remote_command"
}

DOCKER_MODE="$(remote_bash <<'REMOTE_SCRIPT'
set -euo pipefail
if docker info >/dev/null 2>&1; then
  printf 'direct'
elif sudo -n docker info >/dev/null 2>&1; then
  printf 'sudo'
else
  exit 1
fi
REMOTE_SCRIPT
)" || {
  printf 'Docker is unavailable to remote user\n' >&2
  exit 1
}

if [ "$DOCKER_MODE" != "direct" ] && [ "$DOCKER_MODE" != "sudo" ]; then
  printf 'Docker detection returned invalid result\n' >&2
  exit 1
fi

remote_bash <<'REMOTE_SCRIPT'
set -euo pipefail
export FAKE_REMOTE_HOME="${FAKE_REMOTE_HOME:-$HOME}"
remote_root="$HOME/deepagent-ui"
mkdir -p "$remote_root/data"
chmod 0700 "$remote_root"
REMOTE_SCRIPT

scp "${SCP_ARGS[@]}" "$ORACLE_ENV_FILE" "$REMOTE:deepagent-ui/.env.docker"

remote_bash <<'REMOTE_SCRIPT'
set -euo pipefail
chmod 0600 "$HOME/deepagent-ui/.env.docker"
REMOTE_SCRIPT

remote_bash "$DOCKER_MODE" "$ORACLE_CONTAINER_NAME" "$ORACLE_IMAGE" "$ORACLE_HTTP_PORT" "$ORACLE_PUBLIC_URL" <<'REMOTE_SCRIPT'
set -euo pipefail
docker_mode="$1"
container_name="$2"
image="$3"
http_port="$4"
public_url="$5"
remote_root="$HOME/deepagent-ui"
export FAKE_REMOTE_HOME="${FAKE_REMOTE_HOME:-$HOME}"

case "$docker_mode" in
  direct) docker_cmd=(docker) ;;
  sudo) docker_cmd=(sudo docker) ;;
  *) exit 1 ;;
esac

"${docker_cmd[@]}" pull "$image"
if "${docker_cmd[@]}" container inspect "$container_name" >/dev/null 2>&1; then
  "${docker_cmd[@]}" rm -f "$container_name"
fi
"${docker_cmd[@]}" run -d \
  --name "$container_name" \
  --restart unless-stopped \
  -p "$http_port:3000" \
  --env-file "$remote_root/.env.docker" \
  -e "AUTH_URL=$public_url" \
  -e "NEXTAUTH_URL=$public_url" \
  -e AUTH_TRUST_HOST=true \
  -v "$remote_root/data:/app/data/markdown_threads" \
  "$image"
REMOTE_SCRIPT

for attempt in {1..12}; do
  http_status="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "$ORACLE_PUBLIC_URL" || true)"
  case "$http_status" in
    200|301|302|303|307|308)
      printf 'Deployment available at %s\n' "$ORACLE_PUBLIC_URL"
      exit 0
      ;;
  esac
  if [ "$attempt" -lt 12 ]; then
    sleep 5
  fi
done

printf 'Health verification failed for %s\n' "$ORACLE_PUBLIC_URL" >&2
remote_bash "$DOCKER_MODE" "$ORACLE_CONTAINER_NAME" <<'REMOTE_SCRIPT'
set -euo pipefail
docker_mode="$1"
container_name="$2"
case "$docker_mode" in
  direct) docker_cmd=(docker) ;;
  sudo) docker_cmd=(sudo docker) ;;
  *) exit 1 ;;
esac
"${docker_cmd[@]}" logs --tail 100 "$container_name"
REMOTE_SCRIPT
exit 1
