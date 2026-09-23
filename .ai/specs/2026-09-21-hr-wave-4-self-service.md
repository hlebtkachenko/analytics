# HR Wave 4: Employee Self-Service

**Date:** 2026-09-21

## Problem

Employees need safe access to their own employment records without HR grants.

## Scope

Create a verified active employee-user binding and fixed `/my-hr` routes for own
operational profile, registered documents, finalized payslips, timesheets, and
leave requests. The employee ID derives only from the binding. Employees may
create, edit, and submit their own draft timesheets, and create or cancel their
own eligible leave requests. They cannot approve, decide, or correct another
record.

## Security

No route accepts an employee selector. Private, bank, tax, dependant, and
medical values, plus all profile change requests, are excluded.

## Verification

Test binding uniqueness, activation, revocation, own-versus-other isolation,
every allowed/forbidden own state transition, strict response fields, and the
primary browser flows.
