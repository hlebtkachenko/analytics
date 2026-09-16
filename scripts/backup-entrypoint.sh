#!/usr/bin/env bash
set -euo pipefail

fail_runtime_boundary() {
  printf '%s\n' 'Backup runtime boundary validation failed.' >&2
  exit 78
}

verify_runtime_boundary() {
  local capability_mask

  [[ $(id -u) == "$(id -u postgres)" && $(id -g) == "$(id -g postgres)" ]] || fail_runtime_boundary
  capability_mask=$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/self/status)
  [[ -n "$capability_mask" && "$capability_mask" =~ ^0+$ ]] || fail_runtime_boundary
}

verify_staged_file() {
  local file_path=$1

  [[ -f "$file_path" && ! -L "$file_path" && -s "$file_path" && -r "$file_path" ]] || fail_runtime_boundary
  [[ $(stat -c '%u:%g:%a' "$file_path") == '999:999:400' ]] || fail_runtime_boundary
}

require_restic() {
  export RESTIC_PASSWORD_FILE=/run/bap-credentials/restic-password
  export RESTIC_REPOSITORY_FILE=/run/bap-credentials/restic-repository
  verify_staged_file "$RESTIC_PASSWORD_FILE"
  verify_staged_file "$RESTIC_REPOSITORY_FILE"
}

require_database() {
  unset PGPASSWORD BAP_DATABASE_PASSWORD_FILE
  export PGPASSFILE=/run/bap-credentials/database.pgpass
  verify_staged_file "$PGPASSFILE"
  export PGDATABASE=${BAP_DATABASE_NAME:-bap}
  export PGHOST=${BAP_DATABASE_HOST:-database}
  export PGPORT=${BAP_DATABASE_PORT:-5432}
  export PGUSER=$1
}

verify_blob_storage() {
  [[ -d "$blob_storage_directory" && ! -L "$blob_storage_directory" ]] || fail_runtime_boundary
}

command_name=${1:-}
# The blob volume mount; backup reads it, restore writes into it.
blob_storage_directory=/var/lib/bap/blobs
verify_runtime_boundary
require_restic

case "$command_name" in
  init)
    restic init
    ;;
  backup)
    require_database bap_backup
    verify_blob_storage
    # pgvector is untrusted, so only role bootstrap can install it and only the superuser owns it.
    # Dumping it would make pg_restore try to comment on an extension bap_owner does not own.
    pg_dump --format=custom --no-owner --no-acl --exclude-extension=vector | env -u PGPASSFILE restic backup --tag database --stdin --stdin-filename bap.dump
    # Blobs are a second snapshot in the same run; the tag lets each restore pick its own latest.
    env -u PGPASSFILE restic backup --tag blobs "$blob_storage_directory"
    ;;
  check)
    restic check
    ;;
  prune)
    restic forget --keep-daily 30 --prune
    ;;
  restore)
    require_database bap_migrator
    verify_blob_storage
    env -u PGPASSFILE restic dump --tag database "${RESTIC_SNAPSHOT:-latest}" bap.dump | pg_restore --dbname "$PGDATABASE" --role bap_owner --no-owner --no-acl
    # Blob keys are content hashes, so a file already present is identical and left in place.
    env -u PGPASSFILE restic restore --tag blobs "${RESTIC_BLOB_SNAPSHOT:-latest}:$blob_storage_directory" --target "$blob_storage_directory"
    ;;
  *)
    printf '%s\n' 'Expected init, backup, check, prune, or restore.' >&2
    exit 64
    ;;
esac
