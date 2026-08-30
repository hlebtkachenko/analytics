# Master Plan Execution Report

The foundation-to-AI-native plan was delivered in five phases across pull
requests 8 to 16. This report records the decisions and corrections that the
code alone does not explain, so the reasoning survives the working copy it was
made in.

## What shipped

Phase 0 aligned the two Nest applications, hardened the migration version
machinery, added the shared Dockerfile dependency stage, moved PostgreSQL to a
digest-pinned pgvector image, introduced the controlled egress network, and
added the pg-boss queue with its worker, the Resend mail module, and the
provider-agnostic AI credential.

Phase 1 completed authentication: magic link, TOTP second factor, password
reset, invitations, capability flags in the access contract, and the data grant
and audit tables.

Phase 2 added the generic tenant data foundation: the dataset tables with their
row level security policies, and the upload and ingestion pipeline.

Phase 3 added `@bap/ai`, chat streaming, and the background summarization and
embedding agents.

Phase 4 added the vertical slice UI and its operational Playwright coverage.

Phase 5 designed the MCP server and completed the independent chores.

## Decisions worth keeping

Row level security policies on `app.dataset` are written per command rather than
as one `ALL` policy. A single policy would let its `USING` clause govern
`DELETE` and `UPDATE`, so a read grant would confer deletion. A grant widens
reading only; writing stays with the creator.

`app.record_audit` takes no organization or user argument. Tenant identity is
derived from the transaction context, so a caller cannot attribute an entry to
another tenant by passing a different value.

A failed background job stores only a curated error name. `pgboss.job` has no
row level security and is readable across tenants by `bap_api`, while provider
errors carry the request body and database errors carry the offending row, so
the handler boundary replaces the error before pg-boss can serialize it.

The model provider registry resolves each role to its own provider. Qualifying
every role to a single provider made the embedding role unresolvable, because
Anthropic publishes no embedding model.

Backup verification excludes the `vector` extension from its dump. pgvector is
untrusted, so only the superuser owns it, while the restore runs as `bap_owner`.

Both `priority` and `gw_priority` are set on the egress network. Docker selects
the default gateway by `gw_priority`, so `priority` alone does not decide which
network carries outbound traffic.

## Corrections made during execution

A local backup drill reported success while its restore step had failed, because
`set -e` inside a brace group under zsh does not abort. Every later drill uses a
script with `set -euo pipefail` and explicit per-step markers.

The magic link endpoint was described as immune to account enumeration. It was
not: response latency differed between a known and an unknown address. It now
sends detached and returns after a fixed floor.

A formula-injection guard on CSV export was applied to the stringified value, so
a negative number was exported as text and disagreed with the XLSX output. The
guard is typed rather than textual.

An investigation concluded that Dependabot was not opening npm pull requests and
blamed `minimumReleaseAge`. Both halves were wrong. It does open them, and the
real cause was peer conflicts under `strictPeerDependencies`.

## Accepted residual risks

Dataset names reach the model as prompt context. The chat route registers no
tools and the context carries only metadata the caller can already see, so the
impact is bounded. Revisit if untrusted parties can ever name a dataset.

The second factor is enforced when a magic link is sent, not when it is
verified, because the plugin matcher covers only the password sign-in paths.

## Open by choice

Analysis agent jobs, paging for dataset listing beyond its current cap, in-page
surfacing of export refusals, and ingestion retries were not requirements of the
plan and are not implemented.
