# Feature Implementation Records

## Delivered and historical records

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
