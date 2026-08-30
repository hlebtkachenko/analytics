#!/usr/bin/env bash
# Prepares a fresh workspace: pinned Node, dependencies, local development secrets.
set -euo pipefail

cd "$(dirname "$0")/.."

wanted_major=$(cut -d. -f1 .nvmrc)

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" || true
  nvm install || true
fi

# check-node-pins compares the pin files to each other, so the running version is asserted here.
active_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
if [[ $active_major != "$wanted_major" ]]; then
  echo "Node $wanted_major is required, found $active_major." >&2
  exit 1
fi

corepack pnpm install --frozen-lockfile

# Every workspace is a fresh worktree, so the ignored secret files start missing.
corepack pnpm secrets:local
