#!/usr/bin/env bash
# Prepares a fresh workspace: pinned Node, dependencies, local development secrets.
set -euo pipefail

cd "$(dirname "$0")/.."

wanted_version=$(<.nvmrc)

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" || true
  nvm install || true
fi

# check-node-pins compares pin files, so the running version is asserted here.
active_version=$(node -p 'process.versions.node' 2>/dev/null || echo none)
if [[ $active_version != "$wanted_version" ]]; then
  echo "Node $wanted_version is required, found $active_version." >&2
  exit 1
fi

corepack pnpm install --frozen-lockfile

# Every workspace is a fresh worktree, so the ignored secret files start missing.
corepack pnpm secrets:local
