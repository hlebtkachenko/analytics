#!/usr/bin/env bash
# One-command two-level tenancy demo: a disposable local stack, three accounts, and the narrated browser proof.
set -euo pipefail

# shellcheck source=scripts/demo-lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/demo-lib.sh"

if [[ ${1:-} == '--down' ]]; then
  demo_down
  exit 0
fi

demo_local_secrets
demo_reset_stack
demo_start_stack
demo_create_accounts
demo_grant_quota

printf '== 6/6 Running the legal entity browser proof\n'
demo_playwright_spec tests/operational/legal-entities.spec.ts

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
