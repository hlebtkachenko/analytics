# HR Wave 1: Employee Lifecycle

**Date:** 2026-09-20

## Problem

Wave 0 holds minimal employees and relationships but cannot preserve changing
employment terms, organization structure, lifecycle transitions, HR document
workflow, or onboarding/offboarding tasks.

## Scope

Implement W1.1-W1.8 from the
[mechanical task packets](../../docs/planning/hr-execution-tasks.md) using the
exact Wave 1 schemas, endpoints, routes, permissions, and transitions in the
[execution contract](../../docs/planning/hr-execution-contract.md). Do not add
compensation, payroll approvals, time, leave, or restricted personal data.

## Security

All rows remain organization RLS and legal-entity scoped. `readHr` reads
operational HR; `manageHr` mutates it. Document confidentiality is checked
before response serialization. Audit metadata contains identifiers only.

## Acceptance criteria

1. Reference data is entity-pinned, uniquely coded, retire-only, and paged.
2. Existing relationships receive an equivalent first employment-term version.
3. Term corrections insert one-successor versions, never rewrite prior terms,
   and current-term reads use the execution contract's deterministic resolution.
4. Every employee lifecycle transition follows the fixed state table and writes
   history in the same transaction.
5. HR documents use the existing register and enforce category confidentiality,
   approval, and supersession.
6. Checklist instances preserve template snapshots and terminal task history.
7. API, BFF, pages, RLS, audit, upgrade, and browser evidence pass W1.8.

## Compatibility and rollback

The migration is additive and keeps Wave 0 relationship columns as read-only
compatibility fields until all readers use `employment_term`. Rollback reverts
application readers; applied migrations remain.

## Remaining decisions

None. Missing contract compatibility is a stop condition, not worker discretion.
