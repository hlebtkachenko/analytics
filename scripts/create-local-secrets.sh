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

# Placeholder provider credentials keep the local stack in log-only transports.
resend_path="$secret_directory/resend_api_key"
if [[ ! -f "$resend_path" ]]; then
  printf '%s\n' 'local-development-placeholder' > "$resend_path"
fi
chmod 0600 "$resend_path"

ai_provider_path="$secret_directory/ai_provider_config"
if [[ ! -f "$ai_provider_path" ]]; then
  printf '%s\n' '{"providers":{"anthropic":{"apiKey":"local-development-placeholder"},"openai":{"apiKey":"local-development-placeholder"}},"models":{"chat":{"provider":"anthropic","model":"claude-sonnet-5"},"embedding":{"provider":"openai","model":"text-embedding-3-small"},"summary":{"provider":"anthropic","model":"claude-sonnet-5"}}}' > "$ai_provider_path"
fi
chmod 0600 "$ai_provider_path"

repository_path="$secret_directory/restic_repository"
if [[ ! -f "$repository_path" ]]; then
  printf '%s\n' 'local:/repository' > "$repository_path"
fi
chmod 0600 "$repository_path"
