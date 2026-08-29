#!/usr/bin/env bash
set -euo pipefail

secret_directory=${BAP_SECRET_DIRECTORY:-.secrets}
umask 077
mkdir -p "$secret_directory"

for secret_name in postgres_admin_password bap_migrator_password bap_auth_password bap_api_password bap_reporting_password bap_backup_password better_auth_secret restic_password; do
  secret_path="$secret_directory/$secret_name"
  if [[ ! -f "$secret_path" ]]; then
    if [[ $secret_name == bap_migrator_password || $secret_name == bap_backup_password ]]; then
      printf '%s:\\\n' "$(openssl rand -base64 48 | tr -d '\n')" > "$secret_path"
    else
      openssl rand -base64 48 > "$secret_path"
    fi
  fi
  chmod 0600 "$secret_path"
done

repository_path="$secret_directory/restic_repository"
if [[ ! -f "$repository_path" ]]; then
  printf '%s\n' 'local:/repository' > "$repository_path"
fi
chmod 0600 "$repository_path"
