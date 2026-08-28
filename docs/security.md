# Security Baseline

This repository is public. Source, tests, documentation, issues, and build
artifacts must contain no real personal, customer, company, financial,
credential, or analytics data.

## Repository rules

- Commit only synthetic, clearly non-production examples.
- Keep environment files, credentials, certificates, keys, dumps, exports, local
  databases, logs, and test artifacts ignored.
- Never copy environment files into container build contexts.
- Keep PostgreSQL unpublished in production.
- Run applications as non-root container users with dropped capabilities.
- Pin toolchain and container patch versions.
- Validate external input at its first trusted boundary.
- Do not enable wildcard production CORS.

Phase 3 adds automated secret scanning and dependency checks. Automated scans do
not replace manual review of configuration, workflows, fixtures, container
files, and generated artifacts before every push.

Do not publish a vulnerability report containing secrets or personal data. Use
GitHub's private vulnerability reporting channel once repository security
settings enable it.
