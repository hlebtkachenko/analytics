# HR Wave 4: Restricted Employee Dossier

**Superseded, 2026-09-21:** This is a deferred extension. Active Wave 4 is
employee self-service, defined in `2026-09-21-hr-wave-4-self-service.md`.

**Date:** 2026-09-20

## Problem

Statutory payroll needs restricted identity, payment, tax, insurer, dependant,
and fitness facts that cannot share ordinary HR permissions or plaintext
storage.

## Scope

After W4.0 approval, implement W4.1-W4.5 exactly. Use the contracted encrypted
payload, retention, legal-hold, and data-request models. Do not store diagnosis,
documents without a defined purpose, or any field absent from payload version 1.

## Security

AES-256-GCM, bound associated data, external key configuration, no-store browser
responses, separate sensitive permissions, redacted errors, and access audit are
mandatory. No plaintext restricted value reaches logs, audit metadata, URLs,
queue payloads, or analytics.

## Acceptance criteria

1. Missing W4.0 approval blocks activation.
2. Startup rejects invalid key configuration.
3. Tampering, wrong AAD, and unauthorized access fail closed.
4. Old-key reads and explicit rotation preserve the validated payload.
5. Retention cannot undercut the approved minimum and legal hold blocks action.
6. Data access/export isolates one employee and W4.5 gates pass.

## Compatibility and rollback

The feature is default closed. Rolling application code back leaves encrypted
rows unread by old code but does not expose or remove them.

## Remaining decisions

Only external approval evidence. Workers have no discretion to substitute it.
