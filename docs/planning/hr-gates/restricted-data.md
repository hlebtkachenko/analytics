# Restricted HR Data Activation Gate

**Status:** deferred extension **Applies to:** restricted dossier extension, not
active Waves 4-7

No restricted-data implementation may be activated while status is not
`approved`. The approved version must retain this file path and replace each
pending field with the reviewer name, review date, and evidence reference.

## Fixed payload

A future approved extension spec must fix its field catalog before coding.
Diagnosis, unrestricted medical notes, identity-document images, biometrics,
criminal records, and fields without a documented purpose remain excluded. The
active Wave 4 self-service scope contains no restricted-data payload.

## Required approval evidence

| Check                                           | Status  | Evidence |
| ----------------------------------------------- | ------- | -------- |
| Purpose and legal basis per field               | pending | pending  |
| Minimum retention per field/document category   | pending | pending  |
| Data-subject access/correction/erasure handling | pending | pending  |
| Encryption/key custody and incident procedure   | pending | pending  |
| Product owner approval                          | pending | pending  |
| Czech privacy/payroll reviewer approval         | pending | pending  |

## Activation rule

Change the document status to `approved` only when all rows are approved. The
primary agent verifies the evidence. A coding worker cannot approve this gate.
