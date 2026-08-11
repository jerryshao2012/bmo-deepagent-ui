#!/bin/bash

_container_cli_on_path() {
  type -P -- "$1" >/dev/null 2>&1
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
