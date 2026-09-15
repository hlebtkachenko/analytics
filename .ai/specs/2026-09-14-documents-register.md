# Documents Register and Derived Economic Events

**Date:** 2026-09-14

## Problem

Documents enter the platform from many places (invoices, receipts, bank
statements, contracts, HR and payroll papers, tax filings), yet nothing records
them. Analytics over accounting data needs every document registered once, its
structured content kept where it has structure, and a comparable debit/credit
view derived by explicit rules so a P&L, a payables view or a partner drill-down
reads the same across legal entities that use different accounting software. BAP
is not the book of record: documents were already booked elsewhere, so the
platform must not invent numbering, period closes or legal immutability.

## Scope

- A uniform register `app.document` for every kind, per legal entity, with
  lifecycle `registered`, `needs_review`, `verified`, `archived`, a version
  chain, and free attributes for kinds without dedicated content.
- Dedicated content for invoices: `app.invoice` and `app.invoice_line`.
- Derived `app.economic_event` and `app.economic_event_line`: one balanced
  debit/credit event per invoice, produced by a versioned rule set, rebuildable.
  Imbalance and total mismatches land in `app.data_issue`, never block a write.
- Organization-wide `app.partner` with optional link to an own legal entity.
- Generic `app.document_link` between any two documents.
- Shared reference `app.directive_account` seeded with the Czech synthetic chart
  of accounts.
- Application API routes for documents, links, partners and the reference chart,
  with capabilities `readDocuments` and `manageDocuments`.
- Product pages `/documents`, `/documents/new`, `/documents/[documentId]` inside
  the product shell, registered in the rail through `railDestinations`, and the
  shell refactored to render the rail from that array.
- Not in scope: source adapters (Money S3, Pohoda, ISDOC), table-driven rule
  overrides, a re-versioning endpoint, bank matching, reporting API reads,
  content tables for non-invoice kinds.

## Design

Three layers. The register is uniform. Content is per kind. Events are uniform
again and only some kinds produce them. Exact DDL, contracts and page behaviour
are in `docs/documents.md` after implementation; the builder contract used
during implementation is not committed.

Tenancy follows ADR 0011: every table carries `organization_id` for row level
security and `legal_entity_id` pinned by the composite foreign key to
`app.legal_entity(id, organization_id)`. Children pin to parents the same way.
Entity scope stays an application filter through `readEntityScope`.

Migration `20260914.0002_documents.sql` creates the tables, per-command policies
gated by `app.role_can_write()`, grants for `bap_api`, `bap_reporting`,
`bap_backup`, eraser column grants, extends `app.erase_user` for the new
`created_by` columns, and reserves the `documents` organization slug.
`DATABASE_MIGRATION_COMPATIBILITY` becomes `20260914.0002`.

Derivation runs in `apps/api/src/documents/derivation.ts`, pure, with money as
scaled integers and Czech default rules `cz-default-2026-09`: issued invoices
debit 311 and credit 6xx plus 343, received invoices debit 5xx plus 343 and
credit 321, reverse charge self-assesses 343 on both sides. Every write of an
invoice re-derives its event inside the same tenant transaction.

Validation boundaries: Zod at the API controllers, Zod mirrors in the web BFF
and client, check constraints in the database.

## Security

Resource JWTs stay inside the fixed BFF route set, which grows by the documents,
links, partners and directive-accounts shapes. No document content reaches the
model provider. Audit entries record identifiers and kinds, never titles, notes
or amounts. `bap_reporting` gains read only; `bap_backup` gains read. Erasure
tombstones `created_by` on documents, partners and links.

## Verification

- `packages/db` and `apps/api` integration suites: migration applies, cross
  tenant reads are empty, restricted members see only allowed entities, member
  role cannot insert, derived events balance with exact account codes, cascade
  delete, erasure tombstones, reserved slug rejected.
- `apps/api` unit tests: contracts, derivation, decimal math, controller matrix
  and OpenAPI publication.
- `apps/web` unit tests: list, new and detail pages, shell rail from
  `railDestinations`, icon contract, reserved slug corpus.
- Gate: `pnpm check` locally, `pnpm test:integration` in CI.

## Open questions

- Whether rule overrides become a table per organization or per legal entity
  once a second country or a customer chart mapping is needed.
- Whether credit notes reuse `app.invoice` with negative lines or get their own
  content table.
