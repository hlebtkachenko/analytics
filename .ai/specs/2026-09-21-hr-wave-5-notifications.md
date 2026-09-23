# HR Wave 5: Notifications and Deadlines

**Date:** 2026-09-21

## Problem

Authorized users need actionable deadlines without email or personal-data leaks.

## Scope

Add identifier-only outbox events, per-user in-app inbox records at
`/notifications`, checklist and relationship deadlines, liabilities, timesheet
and leave events, payroll state, and payslip availability. Checklist triggers
run on the due day and once overdue; relationship endings trigger 30 and 7 days
before; liabilities trigger 7 days before, on the due day, and once overdue.

## Security

Outbox payloads contain IDs and event names only. An event/resource/trigger-date
dedupe key prevents duplicates. Delivery is idempotent, bounded, and rechecks
membership or active binding. HR and payroll users can receive notifications
without an employee binding.

## Verification

Test duplicate prevention, exact deadline dates, retries, revocation,
unread/read ownership, role access, and the daily deadline worker.
