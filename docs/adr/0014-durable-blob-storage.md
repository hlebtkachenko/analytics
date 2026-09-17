# ADR 0014: Durable Blob Storage

- Status: accepted, supersedes [ADR 0006](0006-upload-staging.md)
- Date: 2026-09-16

## Context

ADR 0006 made uploaded bytes transient. The API writes a CSV or XLSX file to a
staging volume shared with the worker, the worker parses it and deletes it on
both the success and the failure path, and `app.upload` keeps metadata only.
That was the right shape for a tabular import whose only value is the rows it
produces.

The Inbox ([ADR 0015](0015-inbox-intake-model.md)) changes what a file is. An
invoice PDF, an ISDOC export, a contract or a bank statement is evidence: the
register must be able to show the original behind every document, every economic
event line and every analytics figure, for as long as the organization keeps the
document. Bytes that are deleted after parse cannot do that.

The staging volume is also outside the backup. `scripts/backup-entrypoint.sh`
runs `pg_dump` into restic and nothing else (line 53), so even a file that
survived on the volume would not survive a host loss. Nothing bounds the volume
per organization, and nothing sweeps a file whose owning row is gone.

Two durable options were weighed. A filesystem volume already exists, is already
mounted read-write by the api and worker services, and needs no new credential
or network dependency. MinIO would add an S3 API, presigned downloads and
lifecycle rules at the cost of one more service to run, secure, back up and
verify in Compose. The deployment has one host, so the property MinIO is best
at, serving bytes to several hosts, buys nothing today. Storing bytes in
PostgreSQL was rejected again for the reasons ADR 0006 gave: it puts arbitrary
uploaded content inside the tenant database and inflates every dump.

## Decision

Uploaded bytes are durable, content-addressed and owned per organization.

- A `BlobStore` interface in `apps/api` (api and worker share the image) is the
  only way to read or write bytes. Its first and only implementation is the
  filesystem volume already mounted into `api` and `worker`, with the key
  `org/<organization_id>/<sha256>`. The key is derived from the tenant id and
  the content hash, never from a filename, so no upload can steer a path.
- `app.blob` records every stored object: `organization_id`, `sha256`,
  `byte_size`, `media_type`, `storage_key`, `scan_status`, `created_by`, with
  `unique(organization_id, sha256)` and the same row level security policies as
  every other `app` table. The same bytes uploaded twice by one organization are
  one blob; the same bytes uploaded by two organizations are two blobs.
- Blobs are never global across organizations. A global table keyed by hash
  alone would answer "does another tenant hold this file", would block
  per-organization erasure and retention, and would save nothing, because
  invoices are unique per recipient.
- The volume is part of the restic backup. The `backup` service mounts it
  read-only and `restore` mounts it read-write, so the volume member set is api
  (rw), worker (rw), backup (ro), restore (rw). `scripts/backup-entrypoint.sh`
  backs up `pg_dump` only today; its `backup` command adds `restic backup` of
  the mounted volume path in the same run, and the restore proof covers both.
- Phase 0 avoids orphans by ordering, not by a sweep: bytes are written to a
  temporary path, the `app.blob` row and the `app.inbox_item` row are inserted
  in one transaction, then the file is renamed into its content-addressed path;
  on any failure the temporary file is deleted. An orphan sweep (a stored object
  with no `app.blob` row, a blob row with no `inbox_item_file` or
  `document_file` row after a grace period) is a Phase 1 worker job, because it
  needs a non-human principal: `apps/api/src/worker/job-context.ts` fails any
  job without a live write-role `userId`.
- Amended 2026-09-17 (1b-runtime): the row orphan cannot occur, because a `blob`
  row and its `inbox_item_file` row commit in one transaction and both blob
  foreign keys are `ON DELETE RESTRICT`. The untracked file left on the volume
  after a failed commit is the only orphan kind, and the 1b-runtime tick removes
  it after a 60 minute grace period. Retention of a discarded item's bytes stays
  with the retention PR on the connections and setup track. The blob quota is
  now `least(organization setting, BAP_BLOB_QUOTA_BYTES_PER_ORGANIZATION)`: the
  environment value stays the platform default and the cap, and an owner can
  only tighten it per organization.
- Every organization has a byte quota. An upload that would exceed it is refused
  at the API with the reason, before the blob is committed; temporary bytes are
  deleted.
- No bytes in PostgreSQL. MinIO, or any object store, is adopted only when a
  second host appears, behind the same `BlobStore` interface, and gets its own
  ADR.

## Consequences

`scripts/backup-entrypoint.sh` changes from a database-only dump to a database
dump plus the blob volume, and `docs/backup-and-restore.md` and its proof must
show a file coming back. Backup size now grows with uploaded bytes, not only
with rows.

The Compose files declare the volume as durable data rather than scratch space,
and `scripts/verify-compose.mjs` asserts the four-member set with the mode of
each service (api rw, worker rw, backup ro, restore rw) so no other service can
gain access to every organization's originals. A production `read_only`
container still needs the volume mounted read-write.

Two routes serve a blob. The download route sends
`Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` for any
media type. The inline route answers only when the sniffed media type is
`application/pdf`, `image/png`, `image/jpeg` or `image/webp`, with
`Content-Disposition: inline`, `nosniff` and `Content-Security-Policy: sandbox`,
and the web app renders it inside an `<iframe sandbox>` with no scripts and no
same-origin. A PDF is the exception: it is served inline without the sandbox
header and framed without `sandbox`, because a sandboxed browsing context
disables plugins, Chromium's PDF viewer is one, and the preview would render
blank. Anything else gets a download link only, because an any-type upload plus
inline display would execute an SVG or HTML file under the session cookie.

Blobs join the erasure path of [ADR 0008](0008-account-erasure.md): erasing an
account tombstones `created_by` on its blobs, and deleting an organization
removes its `org/<organization_id>/` prefix along with its rows. Retention is a
per-organization policy that decides when a discarded item's bytes go, and there
is no fixed purge window.

The tabular upload path of ADR 0006 keeps working, but its staged file becomes a
blob referenced by an inbox item, and the worker stops deleting after parse. A
crashed worker can no longer leave an untracked file behind; it can leave an
item still `processing`, which the item retry handles.

The volume remains a host-local resource, so the deployment stays tied to one
host. That is the constraint the rest of the deployment already has, and the
`BlobStore` interface is the seam at which it will be lifted.
