#!/usr/bin/env bash
set -euo pipefail

read_required_file() {
  local file_path=$1
  [[ -r "$file_path" ]] || return 1
  tr -d '\r\n' < "$file_path"
}

require_restic() {
  export RESTIC_PASSWORD_FILE=${RESTIC_PASSWORD_FILE:-/run/credentials/restic-password}
  [[ -r "$RESTIC_PASSWORD_FILE" ]]
  export RESTIC_REPOSITORY_FILE=${RESTIC_REPOSITORY_FILE:-/run/credentials/restic-repository}
  [[ -r "$RESTIC_REPOSITORY_FILE" ]]
}

require_database() {
  export PGPASSWORD
  PGPASSWORD=$(read_required_file "$1")
  export PGDATABASE=${BAP_DATABASE_NAME:-bap}
  export PGHOST=${BAP_DATABASE_HOST:-database}
  export PGPORT=${BAP_DATABASE_PORT:-5432}
  export PGUSER=$2
}

command_name=${1:-}
require_restic

case "$command_name" in
  init)
    restic init
    ;;
  backup)
    require_database "${BAP_DATABASE_PASSWORD_FILE:-/run/credentials/database-password}" bap_backup
    pg_dump --format=custom --no-owner --no-acl | restic backup --stdin --stdin-filename bap.dump
    ;;
  check)
    restic check
    ;;
  prune)
    restic forget --keep-daily 30 --prune
    ;;
  restore)
    require_database "${BAP_DATABASE_PASSWORD_FILE:-/run/credentials/database-password}" bap_migrator
    restic dump "${RESTIC_SNAPSHOT:-latest}" bap.dump | pg_restore --dbname "$PGDATABASE" --role bap_owner --no-owner --no-acl
    ;;
  *)
    printf '%s\n' 'Expected init, backup, check, prune, or restore.' >&2
    exit 64
    ;;
esac
