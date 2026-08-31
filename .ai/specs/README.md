# Feature Specs

## Current specs

- [Admin HTTP gating](2026-08-31-admin-gating.md)
- [Account lifecycle](2026-08-31-account-lifecycle.md)
- [Public sign-up and activation](2026-08-31-public-sign-up-and-activation.md)

A spec is a short document describing one feature before it is built. Whoever is
about to implement the feature writes it, human or agent. Its purpose is to make
disagreement cheap: a reviewer reads a page instead of a diff.

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
  prompted it; a spec is disposable once the feature ships. When writing a spec
  surfaces a decision of that kind, the decision moves to an ADR and the spec
  links to it.
- `ARCHITECTURE.md` and `docs/security.md` describe the system as it is. A spec
  describes a system that does not exist yet. Once the feature ships, those
  documents are updated and the spec stops being the source of truth.

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

## What this folder is not

Specs are written before implementation, never after. Delivered work is
described by `ARCHITECTURE.md`, the ADRs, and the code, so nothing here is
written retroactively to document something that already exists.
