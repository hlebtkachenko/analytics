# Feature Implementation Records

## Delivered and historical records

- [Inbox settings fold into the Rules page](2026-09-23-inbox-settings-fold.md)
- [Inbox scan of direct uploads and API-channel blobs](2026-09-22-inbox-scan-uploads.md)
- [Inbox sender authentication](2026-09-22-inbox-sender-authentication.md)
- [Create workspace wizard](2026-09-21-create-workspace-wizard.md)
- [Notification inbox (v1)](2026-09-21-notification-inbox.md)
- [Notification panel v2 (Carbon notification pattern)](2026-09-21-notification-panel-v2.md)
- [Workspaces home page](2026-09-21-workspaces-home.md)
- [Members table: Carbon parity, batch filtering, and member status](2026-09-20-members-filtering-and-status.md)
- [Inbox actions (Phase 1b-actions)](2026-09-17-inbox-actions.md)
- [Inbox rules (Phase 1b-rules)](2026-09-17-inbox-rules.md)
- [Inbox runtime (Phase 1b-runtime)](2026-09-17-inbox-runtime.md)
- [Inbox email channel (Phase 1a-email)](2026-09-17-inbox-email-channel.md)
- [Inbox channels (Phase 1a)](2026-09-17-inbox-channels.md)
- [Header panels: real search, trimmed help, real account panel, placeholders removed](2026-09-17-header-panels.md)
- [Native Carbon members tables](2026-09-17-members-native-tables.md)
- [Account pages in Carbon](2026-09-16-account-pages.md)
- [Inbox foundation (Phase 0)](2026-09-16-inbox-foundation.md)
- [Legal entities page in Carbon](2026-09-16-workspace-entities-page.md)
- [Workspace landing page in Carbon](2026-09-16-workspace-landing-page.md)
- [Workspace list and create pages in Carbon, plus reserved-slug fix](2026-09-16-workspace-list-and-slug-reservation.md)
- [Members page in Carbon](2026-09-16-workspace-members-page.md)
- [Workspace settings page in Carbon](2026-09-16-workspace-settings-page.md)
- [Document analytics page and documents demo](2026-09-15-document-analytics-page.md)
- [Invoice line periods, advance deductions and rounding](2026-09-15-invoice-periods-advances.md)
- [Documents register and derived economic events](2026-09-14-documents-register.md)
- [Pivot row groups (tree pivot)](2026-09-15-pivot-row-groups.md)
- [Table component blocks](2026-09-15-table-component-blocks.md)
- [Product application layout](2026-09-14-product-application-layout.md)
- [Account issuer column removal](2026-09-14-account-issuer-removal.md)
- [Workspace legal entities](2026-09-10-workspace-legal-entities.md)
- [Authenticated navigation and invitation onboarding](2026-09-01-authenticated-navigation-and-invitation-onboarding.md)
- [Conductor and CI source-of-truth reconciliation](2026-09-01-conductor-ci-source-truth.md)
- [Identity and organization integration closure](2026-09-01-identity-organization-integration-closure.md)
- [Carbon application icons](2026-09-01-carbon-application-icons.md)
- [Organization throwaway UI](2026-08-31-organization-throwaway-ui.md)
- [Organization routing](2026-08-31-organization-routing.md)
- [Organization creation path](2026-08-31-organization-creation-path.md)
- [Organization schema and slugs](2026-08-31-organization-schema-and-slugs.md)
- [Public sign-up operational proof](2026-08-31-public-sign-up-operational-proof.md)
- [Admin HTTP gating](2026-08-31-admin-gating.md)
- [Account lifecycle](2026-08-31-account-lifecycle.md)
- [Public sign-up and activation](2026-08-31-public-sign-up-and-activation.md)

A spec is a short implementation record that starts before a feature is built.
Whoever is about to implement the feature writes it, human or agent. Its purpose
is to make disagreement cheap: a reviewer reads a page instead of a diff. This
index retains both delivered and superseded records as history; runtime code,
`ARCHITECTURE.md`, `DESIGN.md`, and the documents under `docs/` describe the
current system.

## File convention

One file per feature, named `YYYY-MM-DD-short-slug.md`, dated the day it was
written. Specs are not renamed or backdated. A spec that turns out wrong is
corrected in place with a line saying what changed and why.

## What a spec contains

- Problem: what is missing or broken today, in the terms a user would use.
- Scope: what the change does, and an explicit list of what it does not do.
- Design: modules touched, contracts added or altered, database columns, and the
  boundary at which each piece of external input is validated.
- Security: what data the change moves, which boundary it crosses, and what must
  never be logged, stored, or sent to a provider.
- Verification: the tests that will prove it works, and the gate to run.
- Open questions: anything the implementer cannot settle alone.

Keep it to one page. A spec longer than the diff it describes is a planning
document in the wrong folder.

## How it relates to the other documents

- `docs/planning/` covers a phase or a subsystem: several features and the
  research behind them. One planning document is the input to several specs.
- `docs/adr/` records a decision that constrains later work, such as a topology
  change, a boundary, or a technology choice. An ADR outlives the feature that
  prompted it. When writing a spec surfaces a decision of that kind, the
  decision moves to an ADR and the spec links to it.
- Runtime code, `ARCHITECTURE.md`, `DESIGN.md`, and the runtime documents under
  `docs/` describe the system as it is. A spec captures design intent and
  delivery history, but stops being the source of truth once implementation
  lands.

## When a change needs one

Write a spec when the change does any of the following.

- Adds or alters a contract another application or a browser depends on.
- Touches authentication, authorization, tenancy, or the model provider
  boundary.
- Changes the database schema or a row level security policy.
- Changes Compose topology, networks, or secrets.
- Spans more than one application or package.
- Has more than one reasonable design, and the choice is not obvious from the
  code.

Skip it for a bug fix with an obvious cause, a dependency bump, a test, a
rename, a formatting pass, or a documentation edit. Skip it whenever writing the
spec would cost more than writing the change and reading the diff.

## Historical status

Specs are written before implementation, never created retroactively to explain
already-delivered work. A delivered record remains indexed here, including its
dated corrections, but it must not be used instead of current code,
`ARCHITECTURE.md`, `DESIGN.md`, ADRs, or runtime documentation.
