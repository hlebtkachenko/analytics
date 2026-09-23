# HR Wave 7: Self-Service, Analytics, and Operations

**Superseded, 2026-09-21:** This broad closure plan is split across active Waves
4, 5, and 7. Restricted change requests remain deferred.

**Date:** 2026-09-20

## Problem

Employees cannot access their own records, HR lacks privacy-safe analytics, and
the module lacks notification, retention, recovery, and production runbooks.

## Scope

Implement W7.1-W7.5 exactly. Bind one authenticated user to one employee, expose
only own-record flows, add contracted aggregates, and close notifications,
retention, accessibility, recovery, and production verification.

## Security

Own-record repositories derive employee ID from the binding, never a browser
parameter. Analytics preserve normal permissions and suppress groups below 5.
Outbox and queue payloads contain identifiers only.

## Acceptance criteria

1. Binding verification, revocation, and cross-entity denial pass.
2. Self-service cannot enumerate or request another employee.
3. Restricted change requests reuse Wave 4 encryption.
4. Analytics reconcile to payroll/accounting and apply suppression.
5. Notification retries and retention review are idempotent and auditable.
6. Accessibility, browser, backup/restore, worker recovery, and full repository
   gates pass with synthetic data.

## Compatibility and rollback

Self-service and analytics are additive. Revoking a binding or the underlying
organization membership hides the routes while leaving authoritative HR/payroll
facts unchanged.

## Remaining decisions

None.
