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

`backup` streams
`pg_dump --format=custom --no-owner --no-acl --exclude-extension=vector`
directly into restic stdin as `bap.dump`, then takes a second snapshot of the
`blob_storage` volume mounted read-only at `/var/lib/bap/blobs`, in the same
run, excluding its `tmp` directory, which holds uploads still being hashed and
never a stored blob. The database snapshot carries the tag `database` and the
blob snapshot the tag `blobs`, so `latest` resolves per source. It connects only
as `bap_backup`. Repository checks and retention pruning receive no database
credential. `backup-prune` groups snapshots by path, so each source keeps its
own daily history.

pgvector is excluded from the dump on purpose. It is an untrusted extension, so
only the superuser can install it and only the superuser owns it. A dumped
extension makes `pg_restore` attempt `COMMENT ON EXTENSION`, which fails because
the restoring role is `bap_owner`. Role bootstrap installs the extension on both
the live and the restore database, so the restore target always has it before
any data arrives. Restoring into a database that has not been through role
bootstrap is therefore unsupported.

Restore starts a separate PostgreSQL 18 database and runs isolated role
bootstrap. It then streams the selected restic snapshot to `pg_restore` while
connected as `bap_migrator` with `--role=bap_owner`. It never targets the live
database service. In the same run it restores the `blobs` snapshot into the
`blob_storage` volume, which it mounts read-write at `/var/lib/bap/blobs`: there
is one blob volume, so restore writes into the live one. Blob keys are content
hashes, so a file that is already present is identical and left in place, and
only missing files come back. The `clamav_signatures` volume is never backed up:
`freshclam` rebuilds it from the public mirror. `RESTIC_SNAPSHOT` selects the
database snapshot and `RESTIC_BLOB_SNAPSHOT` the blob snapshot; both default to
`latest`. The two `latest` tags resolve independently, so an operator restoring
to a point in time should pick both snapshots from the same backup run; a shared
run id is a later improvement.

The restore one-shot runs as UID 999 with zero capabilities and cannot change
ownership, so the blob volume root is owned by the API user with group 999 and
the setgid bit, and the API writes directories with mode `0770` and files with
mode `0660`. Backup reads every original through that group and the API keeps
write access to a restored prefix through the same group.

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

The blob proof in the same workflow writes a file into the volume as the API
user before `backup`, deletes it after `backup-check`, and reads it back through
the API container after `restore`. To repeat it by hand against a local stack:

```sh
docker compose -f compose.yaml -f compose.development.yaml exec -T api sh -c 'umask 007 && mkdir -p /var/lib/bap/blobs/org/proof && printf blob-proof > /var/lib/bap/blobs/org/proof/backup-proof'
docker compose --profile operations -f compose.yaml -f compose.development.yaml run --rm backup
docker compose -f compose.yaml -f compose.development.yaml exec -T api rm -r /var/lib/bap/blobs/org/proof
docker compose --profile operations -f compose.yaml -f compose.development.yaml run --rm --no-deps restore
docker compose -f compose.yaml -f compose.development.yaml exec -T api cat /var/lib/bap/blobs/org/proof/backup-proof
docker compose -f compose.yaml -f compose.development.yaml exec -T api rm -r /var/lib/bap/blobs/org/proof
```

The last `cat` prints `blob-proof`. The `restore` run needs the restore database
and its role bootstrap from the command list above.

Authenticated off-host storage, TLS or host-key trust, scheduling, retention,
alerts, off-host durability, Caddy state backup, RPO, RTO, and monthly restore
evidence require owner-provided infrastructure and are not claimed by this
repository.
