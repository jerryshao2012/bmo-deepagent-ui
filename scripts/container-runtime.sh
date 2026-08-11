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
