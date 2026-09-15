#!/usr/bin/env bash
# One-command documents demo: the disposable tenancy stack, seeded synthetic documents, and the analytics browser proof.
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

printf '== 6/6 Seeding the documents and running the analytics browser proof\n'
demo_playwright_spec tests/operational/documents-analytics.spec.ts

analytics_url="$BAP_OPERATIONAL_BASE_URL/documents/analytics?organization=$organization_slug"

cat <<SUMMARY

The demo stack is still running. Explore it by hand:

  Analytics      $analytics_url
  Web            $BAP_OPERATIONAL_BASE_URL
  Mailpit        $BAP_OPERATIONAL_MAILPIT_URL
  Organization   $organization_name (/$organization_slug)

  Owner          $BAP_OPERATIONAL_EMAIL
  Admin          $BAP_OPERATIONAL_ADMIN_EMAIL
  Member         $BAP_OPERATIONAL_MEMBER_EMAIL
  Password       $BAP_OPERATIONAL_PASSWORD

The password is disposable and local. Stop everything with: pnpm demo:documents:down
SUMMARY

# Only macOS and a few desktops carry this opener, so the demo finishes normally without it.
if command -v open >/dev/null 2>&1; then
  open "$analytics_url"
fi
