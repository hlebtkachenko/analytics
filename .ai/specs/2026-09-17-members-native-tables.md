# Native Carbon Members Tables

**Date:** 2026-09-17

## Problem

The members and invitations tabs use the analytics-oriented `DataGrid` block.
Its fixed column layout and minimal container treatment do not match Carbon's
resource-list examples, and the page cannot progressively disclose useful member
access details.

## Scope

- Replace both grids with native Carbon `DataTable` compositions on the members
  page. Members use expandable rows; invitations use standard rows.
- Give both tables a title with a live count, persistent search, a role filter,
  sortable columns, a separate CSV export action, refresh, density settings, the
  existing invite action, and the existing permission-gated row actions.
- Add a legal-entity filter to the members table when scope data is available.
- Expanded member details contain only supplementary role-permission guidance
  and the fully explained entity scope. Do not repeat email, role, or join date.
- Keep the existing empty states, tabs, mutation contracts, and access checks.
  Use compact Carbon modals, and render entity selection in the modal flow so
  the action footer never covers it.

Out of scope: bulk member mutation, pagination, a new activity endpoint, and
changes to shared table blocks. The current API lists at most 100 members and
has no paginated contract. `app.audit_log` records selected data operations but
does not represent sign-in or general user activity, so the page must not label
it as a member's last activity.

## Design

The client view owns table search, role and entity filters, CSV generation,
expansion, density, and the existing modal state. The server component and every
read/write boundary remain unchanged. CSV export and refresh are visible toolbar
actions. The settings wheel changes row density. Row overflow menus retain
change role, edit entity scope, remove, resend, and cancel according to existing
capabilities.

## Security

CSV export contains only data already rendered to the authorized caller and is
created entirely in the browser. No identifiers beyond existing visible member
and invitation fields are added. Existing server-side tenancy and permission
checks remain authoritative.

## Verification

Update the members page tests for titles, counts, filters, expansion, export,
and existing mutations. Run web formatting, lint, type checking, tests, and the
production build, then inspect the running demo at desktop and narrow widths.

## Open questions

None. A truthful activity panel requires a separately specified activity
contract with defined event coverage.
