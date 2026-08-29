#!/bin/bash
set -euo pipefail
umask 077

fail_staging() {
  printf '%s\n' 'Credential staging failed.' >&2
  exit 78
}

stage_file() {
  local source_path=$1
  local target_path=$2

  [[ -f "$source_path" && ! -L "$source_path" && -s "$source_path" && -r "$source_path" ]] || fail_staging
  [[ ! -e "$target_path" && ! -L "$target_path" ]] || fail_staging
  /usr/bin/install -m 0400 -- "$source_path" "$target_path" 2>/dev/null || fail_staging
  /usr/bin/chown postgres:postgres -- "$target_path" 2>/dev/null || fail_staging
}

stage_pgpass() {
  local source_path=/run/credentials/database-password
  local target_path=$credential_directory/database.pgpass
  local database_role=$1
  local escaped_password
  local -a database_lines=()

  [[ -f "$source_path" && ! -L "$source_path" && -s "$source_path" && -r "$source_path" ]] || fail_staging
  [[ ! -e "$target_path" && ! -L "$target_path" ]] || fail_staging
  mapfile -t database_lines < "$source_path" || fail_staging
  [[ ${#database_lines[@]} -eq 1 && -n ${database_lines[0]} ]] || fail_staging
  escaped_password=${database_lines[0]//\\/\\\\}
  escaped_password=${escaped_password//:/\\:}
  printf '*:*:*:%s:%s\n' "$database_role" "$escaped_password" > "$target_path" || fail_staging
  unset database_lines escaped_password
  /usr/bin/chmod 0400 -- "$target_path" 2>/dev/null || fail_staging
  /usr/bin/chown postgres:postgres -- "$target_path" 2>/dev/null || fail_staging
}

[[ $# -eq 1 ]] || {
  printf '%s\n' 'Expected init, backup, check, prune, or restore.' >&2
  exit 64
}
command_name=${1:-}
case "$command_name" in
  init | check | prune)
    ;;
  backup | restore)
    if [[ $command_name == backup ]]; then
      database_role=bap_backup
    else
      database_role=bap_migrator
    fi
    ;;
  *)
    printf '%s\n' 'Expected init, backup, check, prune, or restore.' >&2
    exit 64
    ;;
esac

credential_directory=/run/bap-credentials
[[ -d "$credential_directory" && ! -L "$credential_directory" ]] || fail_staging
[[ $(/usr/bin/stat -f -c '%T' "$credential_directory") == tmpfs ]] || fail_staging
[[ $(/usr/bin/stat -c '%u:%g:%a' "$credential_directory") == '0:999:750' ]] || fail_staging
stage_file /run/credentials/restic-password "$credential_directory/restic-password"
stage_file /run/credentials/restic-repository "$credential_directory/restic-repository"

if [[ -n ${database_role:-} ]]; then
  stage_pgpass "$database_role"
fi

unset BAP_DATABASE_PASSWORD_FILE PGPASSWORD PGPASSFILE
if [[ -n ${database_role:-} ]]; then
  export PGPASSFILE=$credential_directory/database.pgpass
fi
export RESTIC_PASSWORD_FILE=$credential_directory/restic-password
export RESTIC_REPOSITORY_FILE=$credential_directory/restic-repository
exec /usr/local/bin/gosu postgres:postgres /usr/local/bin/backup-entrypoint "$@"
