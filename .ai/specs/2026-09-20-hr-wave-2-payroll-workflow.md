# HR Wave 2: Payroll Workflow and Accounting

**Date:** 2026-09-20

## Problem

Wave 0 records an already-final payroll snapshot immediately. It lacks separate
payroll permissions, draft/review/approval/finalization, imports, compensation
components, liabilities, payslips, corrections, and account overrides.

## Scope

Implement W2.1-W2.7 exactly. Existing runs are backfilled as finalized imported
runs. New run creation produces a draft; only finalization creates the document
and economic event. Do not calculate Czech payroll rates or contact a bank or
authority.

## Security

Payroll access uses the fixed assignment/capability matrix. Generic admins lose
payroll access unless assigned. Approval and finalization use separation of
duties. Imports and queue payloads expose identifiers only.

## Acceptance criteria

1. Existing runs retain their document/event and become finalized without
   duplication.
2. Every state transition, actor rule, idempotency replay, correction, and
   concurrent-finalization branch is tested.
3. Imports are bounded, staged, validated, and consumed all-or-nothing.
4. Finalization atomically writes approval history, documents, liabilities,
   immutable results, and a balanced versioned accounting event.
5. Payroll and compensation pages enforce capability and state visibility.
6. RLS, API, BFF, browser, integration, and full gates pass W2.7.

## Compatibility and rollback

The intentional API change is documented: `POST /payroll-runs` no longer
finalizes. Existing clients must use command endpoints. Applied data remains
readable if application code rolls back.

## Remaining decisions

None. Organization account values are entered through the contracted mapping UI,
not invented by a worker.
