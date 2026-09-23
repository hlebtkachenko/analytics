# HR Wave 6: Supplied-Input Payroll Calculation

**Date:** 2026-09-21

## Problem

Users need deterministic payroll arithmetic without a Czech-law engine.

## Scope

Create a new draft payroll run and results atomically from supplied gross wage,
employee and employer social/health base-rate-rounding lines, 1-4 tax lines,
credits, and deductions. A correction endpoint creates a new linked draft
version from a finalized or paid run without changing the source. Persist an
immutable canonical input snapshot, checksum, calculator version, and actor.

## Security and correctness

Use scaled integers and a pure function. Round every rate line from its explicit
unit/mode, subtract credits from the rounded tax-line sum without going below
zero, reject negative net pay, and calculate employer cost from gross plus
employer contributions. Infer no legal rate, eligibility, cap, or tax treatment.
Label results `calculated from supplied parameters`; tax bonuses, sickness,
annual reconciliation, and other unsupported cases use import/manual.

## Verification

Test arithmetic and rounding boundaries, 1,000-row and duplicate limits, atomic
rollback, replay checksum equality, correction creation, source immutability,
idempotency, and payroll state authorization.
