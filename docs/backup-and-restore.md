# Backup and Restore Proof

The operations image combines restic 0.19.1 with PostgreSQL 18.6 client tools,
both pinned by digest. It never writes a plaintext database dump to a persistent
path.

## Commands

```sh
docker compose --profile operations -f compose.yaml -f compose.development.yaml run --rm backup-init
docker compose --profile operations -f compose.yaml -f compose.development.yaml run --rm backup
docker compose --profile operations -f compose.yaml -f compose.development.yaml run --rm backup-check
docker compose --profile operations -f compose.yaml -f compose.development.yaml up --detach --wait restore-database
docker compose --profile operations -f compose.yaml -f compose.development.yaml run --rm restore-role-bootstrap
docker compose --profile operations -f compose.yaml -f compose.development.yaml run --rm --no-deps restore
```

Run `backup-prune` separately when an owner-defined retention policy is in
place.

`backup` streams `pg_dump --format=custom --no-owner --no-acl` directly into
restic stdin as `bap.dump`. It connects only as `bap_backup`. Repository checks
and retention pruning receive no database credential.

Restore starts a separate PostgreSQL 18 database and runs isolated role
bootstrap. It then streams the selected restic snapshot to `pg_restore` while
connected as `bap_migrator` with `--role=bap_owner`. It never targets the live
database service.

## Credential isolation

- Backup mounts only the backup database password and restic files.
- Check and prune mount only restic files.
- Restore mounts only the migrator password and restic files.
- The isolated role-bootstrap service alone receives its target administrator
  credential and the role credential set.

All operations fail before database work when a required file is unreadable.
Compose file-backed secrets remain host-owned mode `0600`. The operations image
uses a fixed root entry wrapper with only `CHOWN`, `DAC_READ_SEARCH`, `SETGID`,
and `SETUID` to copy its allowlisted credentials into a 64 KiB, mode `0750`
tmpfs. Copies are owned by UID/GID `999:999` with mode `0400`. Database
passwords become escaped PostgreSQL passfiles and never enter a process
environment. The wrapper immediately executes the operation as PostgreSQL UID
999; the backend rejects startup unless its effective capability mask is zero.

The delivered proof uses only `restic_repository` and `restic_password` with a
local encrypted repository. One-shot restic clients have a dedicated,
non-internal `operations-egress` network for a future off-host repository. This
is unrestricted outbound connectivity while those containers run, not a
destination allowlist. Authenticated off-host storage needs fixed,
backend-specific credential and TLS or host-key trust mounts after the owner
selects a backend. The entrypoint never sources or evaluates a generic
credential file.

## What this proves

The scheduled/manual workflow creates a temporary local repository, backs up
disposable PostgreSQL state, runs `restic check`, restores into the isolated
target, and verifies one restored owner membership plus the current migration
identifier. Disposable backup and migrator passwords contain both `:` and `\` so
the proof also exercises PostgreSQL passfile escaping. This proves the commands
and role boundaries only.

Authenticated off-host storage, TLS or host-key trust, scheduling, retention,
alerts, off-host durability, Caddy state backup, RPO, RTO, and monthly restore
evidence require owner-provided infrastructure and are not claimed by this
repository.
