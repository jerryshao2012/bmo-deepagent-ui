#!/bin/bash

_container_cli_on_path() {
  local resolved_path
  resolved_path="$(type -P -- "$1" 2>/dev/null)" || return 1
  [ -f "$resolved_path" ] && [ -x "$resolved_path" ]
}

select_container_cli() {
  if [ "${CONTAINER_CLI+x}" = "x" ]; then
    case "$CONTAINER_CLI" in
      container|podman|docker) ;;
      *)
        echo "Error: CONTAINER_CLI must be one of: container, podman, docker." >&2
        return 1
        ;;
    esac

    if ! _container_cli_on_path "$CONTAINER_CLI"; then
      echo "Error: requested container runtime '$CONTAINER_CLI' is not on PATH." >&2
      return 1
    fi
    return 0
  fi

  local candidate
  for candidate in container podman docker; do
    if _container_cli_on_path "$candidate"; then
      CONTAINER_CLI="$candidate"
      return 0
    fi
  done

  echo "Error: no supported container runtime found; install container, podman, or docker, or set CONTAINER_CLI." >&2
  return 1
}

_container_cli_selection_error() {
  echo "Error: select_container_cli must select one of: container, podman, docker." >&2
  return 1
}

ensure_container_cli_ready() {
  case "${CONTAINER_CLI-}" in
    container)
      if ! command container system status >/dev/null 2>&1; then
        echo "Container system is not running. Starting it..."
        command container system start --disable-kernel-install
      fi
      ;;
    podman)
      if ! command podman info >/dev/null 2>&1; then
        echo "Error: Podman is installed but unavailable; this script will not start a Podman service or machine." >&2
        return 1
      fi
      ;;
    docker)
      if ! command docker info >/dev/null 2>&1; then
        echo "Error: Docker daemon is unavailable; start it and retry." >&2
        return 1
      fi
      ;;
    *)
      _container_cli_selection_error
      ;;
  esac
}

ensure_container_cli_build_ready() {
  ensure_container_cli_ready || return $?

  case "${CONTAINER_CLI-}" in
    podman|docker)
      return 0
      ;;
    container) ;;
    *)
      _container_cli_selection_error
      return $?
      ;;
  esac

  # Yarn installs both build and runtime dependencies during this multi-stage build.
  # Apple Container's 2 GiB default builder is too small for those concurrent steps.
  local MIN_CONTAINER_BUILDER_MEMORY_BYTES=8589934592
  local BUILDER_STATUS_JSON
  local BUILDER_DETAILS
  local BUILDER_MEMORY_BYTES
  local BUILDER_STATE
  if BUILDER_STATUS_JSON=$(command container builder status --format json 2>/dev/null); then
    if BUILDER_DETAILS=$(printf '%s' "$BUILDER_STATUS_JSON" | node -e '
const input = require("fs").readFileSync(0, "utf8");
let builders;
try {
  builders = JSON.parse(input);
} catch {
  process.exit(1);
}
if (!Array.isArray(builders)) process.exit(1);
const [builder] = builders;
let output;
if (builder === undefined) {
  output = "0\tmissing";
} else {
  const memory = builder?.configuration?.resources?.memoryInBytes;
  const state = builder?.status?.state;
  if (
    !Number.isSafeInteger(memory) ||
    memory < 0 ||
    typeof state !== "string" ||
    state.trim().length === 0 ||
    /[\u0000-\u001f\u007f]/.test(state)
  ) {
    process.exit(1);
  }
  output = `${memory}\t${state}`;
}
process.stdout.write(output);
'); then
      case "$BUILDER_DETAILS" in
        *$'\t'*) ;;
        *)
          echo "Error: invalid Apple Container builder status; cannot confirm build readiness." >&2
          return 1
          ;;
      esac
      IFS=$'\t' read -r BUILDER_MEMORY_BYTES BUILDER_STATE <<< "$BUILDER_DETAILS"
      if [ -z "$BUILDER_MEMORY_BYTES" ] || [ -z "$BUILDER_STATE" ]; then
        echo "Error: invalid Apple Container builder status; cannot confirm build readiness." >&2
        return 1
      fi
    else
      local parse_status=$?
      echo "Error: invalid Apple Container builder status; cannot confirm build readiness." >&2
      return "$parse_status"
    fi
  else
    BUILDER_MEMORY_BYTES=0
    BUILDER_STATE=missing
  fi

  if [ "$BUILDER_MEMORY_BYTES" -lt "$MIN_CONTAINER_BUILDER_MEMORY_BYTES" ]; then
    echo "🧠 Configuring Apple Container builder with 8 GiB of memory..."
    if [ "$BUILDER_STATE" = "running" ]; then
      command container builder stop || return $?
    fi
    if [ "$BUILDER_STATE" != "missing" ]; then
      command container builder delete || return $?
    fi
    command container builder start --memory 8g || return $?
  elif [ "$BUILDER_STATE" != "running" ]; then
    command container builder start || return $?
  fi
}

container_cli_build() {
  case "${CONTAINER_CLI-}" in
    container|docker)
      command "$CONTAINER_CLI" build "$@"
      ;;
    podman)
      local podman_args=()
      while [ "$#" -gt 0 ]; do
        if [ "$1" = "--progress" ] && [ "${2-}" = "plain" ]; then
          shift 2
        else
          podman_args[${#podman_args[@]}]="$1"
          shift
        fi
      done
      command podman build "${podman_args[@]}"
      ;;
    *)
      _container_cli_selection_error
      ;;
  esac
}

container_cli_login() {
  case "${CONTAINER_CLI-}" in
    container)
      command container registry login "$@"
      ;;
    podman|docker)
      command "$CONTAINER_CLI" login "$@"
      ;;
    *)
      _container_cli_selection_error
      ;;
  esac
}

container_cli_push() {
  case "${CONTAINER_CLI-}" in
    container)
      command container image push "$@"
      ;;
    podman|docker)
      command "$CONTAINER_CLI" push "$@"
      ;;
    *)
      _container_cli_selection_error
      ;;
  esac
}
