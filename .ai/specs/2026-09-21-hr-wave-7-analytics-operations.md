# HR Wave 7: Analytics and Operational Closure

**Date:** 2026-09-21

## Problem

HR needs a focused operational overview and production evidence.

## Scope

Add `/employees/analytics` with headcount/FTE, time/absence, payroll
cost/liabilities, and accounting reconciliation, then complete accessibility,
recovery, worker, backup, and production-parity proof.

## Security

Require `readHr` for headcount/FTE and time/absence. Require `readPayroll` for
payroll cost/liabilities and accounting reconciliation. Hide unauthorized
panels, enforce the same split in the API, and apply legal-entity scope. Do not
create editable analytics facts or suppress authorized aggregates by default.

## Verification

Test every capability combination, scope, source-total reconciliation, empty
states, browser access, accessibility, recovery, and the full repository gate.
