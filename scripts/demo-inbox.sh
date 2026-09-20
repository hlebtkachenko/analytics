#!/usr/bin/env bash
# One-command inbox demo: the disposable tenancy stack, an API channel fed with synthetic files, and the routing browser proof.
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

printf '== 6/6 Seeding the channel and running the inbox browser proof\n'
demo_playwright_spec tests/operational/inbox.spec.ts

inbox_url="$BAP_OPERATIONAL_BASE_URL/inbox?organization=$organization_slug"

cat <<SUMMARY

The demo stack is still running. Explore it by hand:

  Inbox          $inbox_url
  Web            $BAP_OPERATIONAL_BASE_URL
  Mailpit        $BAP_OPERATIONAL_MAILPIT_URL
  Organization   $organization_name (/$organization_slug)

  Owner          $BAP_OPERATIONAL_EMAIL
  Admin          $BAP_OPERATIONAL_ADMIN_EMAIL
  Member         $BAP_OPERATIONAL_MEMBER_EMAIL
  Password       $BAP_OPERATIONAL_PASSWORD

The password is disposable and local. Stop everything with: pnpm demo:inbox:down
SUMMARY

# Only macOS and a few desktops carry this opener, so the demo finishes normally without it.
if command -v open >/dev/null 2>&1; then
  open "$inbox_url"
fi
