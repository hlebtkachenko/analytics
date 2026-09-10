#!/usr/bin/env bash
# One-command two-level tenancy demo: a disposable local stack, three accounts, and the narrated browser proof.
set -euo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repository_root"

export BAP_OPERATIONAL_ADMIN_EMAIL=${BAP_OPERATIONAL_ADMIN_EMAIL:-admin@bap.invalid}
export BAP_OPERATIONAL_BASE_URL=${BAP_OPERATIONAL_BASE_URL:-http://localhost:39100}
export BAP_OPERATIONAL_EMAIL=${BAP_OPERATIONAL_EMAIL:-owner@bap.invalid}
export BAP_OPERATIONAL_MAILPIT_URL=${BAP_OPERATIONAL_MAILPIT_URL:-http://127.0.0.1:39825}
export BAP_OPERATIONAL_MEMBER_EMAIL=${BAP_OPERATIONAL_MEMBER_EMAIL:-member@bap.invalid}
export BAP_PUBLIC_HOST=${BAP_PUBLIC_HOST:-http://localhost}
export BAP_PUBLIC_ORIGIN=${BAP_PUBLIC_ORIGIN:-http://localhost:39100}
export MAILPIT_HTTP_PORT=${MAILPIT_HTTP_PORT:-39825}
export POSTGRES_PORT=${POSTGRES_PORT:-39432}
export WEB_PORT=${WEB_PORT:-39100}

organization_name='BAP Operational'
organization_slug='bap-operational'

compose_files=(-f compose.yaml -f compose.development.yaml -f compose.mailpit.yaml)

compose() {
  docker compose "${compose_files[@]}" "$@"
}

bootstrap_compose() {
  docker compose --profile bootstrap "${compose_files[@]}" "$@"
}

teardown() {
  docker compose --profile operations --profile bootstrap "${compose_files[@]}" \
    down --volumes --remove-orphans
}

if [[ ${1:-} == '--down' ]]; then
  printf 'Stopping the demo stack and removing its volumes.\n'
  bash scripts/create-local-secrets.sh
  teardown
  exit 0
fi

printf '== 1/6 Disposable local credentials\n'
umask 077
bash scripts/create-local-secrets.sh

# The containers run as uid 1001; a host with another uid cannot hand them the 0600 files, so the demo mounts disposable copies.
demo_secret_directory=$(mktemp -d)
for secret_name in postgres_admin_password bap_migrator_password bap_auth_password bap_api_password bap_reporting_password bap_backup_password better_auth_secret resend_api_key ai_provider_config restic_password restic_repository; do
  install -m 0444 ".secrets/$secret_name" "$demo_secret_directory/$secret_name"
done
export POSTGRES_ADMIN_PASSWORD_FILE="$demo_secret_directory/postgres_admin_password"
export BAP_MIGRATOR_PASSWORD_FILE="$demo_secret_directory/bap_migrator_password"
export BAP_AUTH_PASSWORD_FILE="$demo_secret_directory/bap_auth_password"
export BAP_API_PASSWORD_FILE="$demo_secret_directory/bap_api_password"
export BAP_REPORTING_PASSWORD_FILE="$demo_secret_directory/bap_reporting_password"
export BAP_BACKUP_PASSWORD_FILE="$demo_secret_directory/bap_backup_password"
export BETTER_AUTH_SECRET_FILE="$demo_secret_directory/better_auth_secret"
export BAP_RESEND_API_KEY_FILE="$demo_secret_directory/resend_api_key"
export BAP_AI_PROVIDER_CONFIG_FILE="$demo_secret_directory/ai_provider_config"
export RESTIC_PASSWORD_FILE="$demo_secret_directory/restic_password"
export RESTIC_REPOSITORY_FILE="$demo_secret_directory/restic_repository"

printf '== 2/6 Resetting any previous demo stack\n'
teardown

printf '== 3/6 Building and starting the stack on port %s\n' "$WEB_PORT"
compose up --build --detach --wait --wait-timeout 180
curl --fail --silent --show-error "$BAP_OPERATIONAL_BASE_URL/health" >/dev/null
printf 'The stack answers /health.\n'

# Disposable and local only: the password is printed at the end so the stack can be explored by hand.
BAP_OPERATIONAL_PASSWORD=$(openssl rand -base64 24 | tr -d '\n')
export BAP_OPERATIONAL_PASSWORD

printf '== 4/6 Creating the owner, admin, and member accounts\n'
bootstrap_compose build bootstrap-owner

create_account() {
  local input=$1
  printf '%s' "$input" | bootstrap_compose run --rm --no-deps -T \
    -e BAP_E2E_SETUP=true bootstrap-owner \
    node apps/web/dist-cli/cli/create-synthetic-account.js
}

owner_input=$(jq -cn \
  --arg email "$BAP_OPERATIONAL_EMAIL" \
  --arg name 'Operational Owner' \
  --arg organization_name "$organization_name" \
  --arg organization_slug "$organization_slug" \
  '{email: $email, password: env.BAP_OPERATIONAL_PASSWORD, name: $name, organizationName: $organization_name, organizationSlug: $organization_slug}')
owner_result=$(create_account "$owner_input")
BAP_OPERATIONAL_ORGANIZATION_ID=$(printf '%s' "$owner_result" |
  jq -er 'select(.status == "created") | .organizationId | select(type == "string" and test("^[A-Za-z0-9_-]{1,128}$"))')
export BAP_OPERATIONAL_ORGANIZATION_ID
export BAP_OPERATIONAL_ORGANIZATION_SLUG="$organization_slug"

for role in admin member; do
  if [[ $role == admin ]]; then
    role_email=$BAP_OPERATIONAL_ADMIN_EMAIL
    role_name='Operational Admin'
  else
    role_email=$BAP_OPERATIONAL_MEMBER_EMAIL
    role_name='Operational Member'
  fi
  member_input=$(jq -cn \
    --arg email "$role_email" \
    --arg name "$role_name" \
    --arg organization_slug "$organization_slug" \
    --arg role "$role" \
    '{email: $email, password: env.BAP_OPERATIONAL_PASSWORD, name: $name, organizationSlug: $organization_slug, role: $role}')
  create_account "$member_input" |
    jq -er 'select(.status == "created") | .userId | select(type == "string" and test("^[A-Za-z0-9_-]{1,128}$"))' >/dev/null
  printf 'Added %s as %s.\n' "$role_email" "$role"
done

printf '== 5/6 Granting the organization creation quota\n'
compose run --rm --no-deps migrator \
  node node_modules/@bap/db/dist/cli.js organization-quota \
  --email "$BAP_OPERATIONAL_EMAIL" --total 2 --note 'demo-tenancy: organization loop' |
  jq -e '.grantedTotal == 2' >/dev/null

printf '== 6/6 Running the legal entity browser proof\n'
pnpm exec playwright test --config playwright.operational.config.ts \
  --reporter=list tests/operational/legal-entities.spec.ts

cat <<SUMMARY

The demo stack is still running. Explore it by hand:

  Web            $BAP_OPERATIONAL_BASE_URL
  Mailpit        $BAP_OPERATIONAL_MAILPIT_URL
  Organization   $organization_name (/$organization_slug)

  Owner          $BAP_OPERATIONAL_EMAIL
  Admin          $BAP_OPERATIONAL_ADMIN_EMAIL
  Member         $BAP_OPERATIONAL_MEMBER_EMAIL
  Password       $BAP_OPERATIONAL_PASSWORD

The password is disposable and local. Stop everything with: pnpm demo:tenancy:down
SUMMARY
