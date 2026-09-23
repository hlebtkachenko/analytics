# HR Wave 3: Time, Leave, and Absence

**Date:** 2026-09-20

## Problem

Payroll inputs lack versioned schedules, actual working time, timesheet
approval, leave balances, requests, and absence facts.

## Scope

Implement W3.1-W3.5 with the exact schema, endpoints, states, pages, indexes,
and tests in the execution contract. Record facts only; statutory entitlement
calculation stays disabled until Wave 5 validation.

## Security

Operational time and leave use HR access. Team-manager access is deferred;
ordinary members see nothing until self-service binding in Wave 7. Absence
records contain classifications and dates, never diagnosis or free medical text.

## Acceptance criteria

1. Schedules and actual time are distinct and DST-safe.
2. Approved timesheets are immutable; corrections create versions.
3. Leave decisions post append-only balance transactions and cancellation posts
   an inverse transaction.
4. DPP/DPČ uses the same time evidence boundary.
5. Pages and BFF routes cover all states and access failures.
6. W3.5 gates pass and facts are readable as payroll inputs.

## Compatibility and rollback

All schema is additive. No Wave 0-2 result is recalculated.

## Remaining decisions

None. Entitlement formulas require the Wave 5 approved rule artifact.
