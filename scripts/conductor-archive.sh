#!/usr/bin/env bash
# Removes the Docker resources the stack run script creates outside the workspace directory.
# Archiving deletes the workspace itself, so anything left here leaks for the life of the machine.
set -uo pipefail

if ! script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd); then
  echo "Cannot resolve the Conductor script directory, so no Docker resources were changed." >&2
  exit 0
fi

if ! cd -- "$script_directory/.."; then
  echo "Cannot enter the repository, so no Docker resources were changed." >&2
  exit 0
fi

# Archiving must never be blocked, so a missing or stopped Docker is reported and accepted.
if ! command -v docker >/dev/null 2>&1; then
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running, so this workspace keeps its volumes." >&2
  exit 0
fi

# The same identifier the stack run script names its Compose project with.
if [[ -z ${CONDUCTOR_WORKSPACE_ID:-} ]]; then
  echo "CONDUCTOR_WORKSPACE_ID is unset, so no Compose project can be identified." >&2
  exit 0
fi

# Both profiles own volumes of their own, and down removes only the volumes its configuration declares.
docker compose \
  --profile bootstrap \
  --profile operations \
  --file compose.yaml \
  --file compose.development.yaml \
  --file compose.mailpit.yaml \
  --project-name "bap-$CONDUCTOR_WORKSPACE_ID" \
  down --volumes --remove-orphans || true
