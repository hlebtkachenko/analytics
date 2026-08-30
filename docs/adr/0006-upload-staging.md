# ADR 0006: Upload Staging

- Status: accepted
- Date: 2026-08-30

## Context

Ingestion accepts a CSV or XLSX upload, parses it, and writes rows. Parsing
belongs in the worker: it is unbounded in time, it must not hold a request open,
and it already owns the queue. The upload itself arrives at the web BFF and is
forwarded to the application API, which owns the resource-token boundary.

That leaves a gap the platform batteries phase did not close. The API sits on
the `app` and `data` networks, the worker on `data` and `internet-egress`, and
neither shares a writable filesystem with the other. Production containers run
`read_only: true` with a memory-backed `/tmp` that is private per container. A
file received by the API therefore has nowhere to go that the worker can read.

Three options were considered. Staging the bytes in PostgreSQL contradicts the
decision that `app.upload` is metadata only, and would put arbitrary uploaded
content inside the tenant database. Parsing inside the API request path removes
the worker from the design, holds a request open for the length of a parse, and
puts an unbounded memory cost in the service that serves interactive traffic.
Object storage is deliberately deferred, and adding it here would introduce a
new credential, a new network dependency, and a new failure mode.

## Decision

Add a named volume mounted read-write into `api` and `worker`, and into no other
service. The API writes the received bytes there and enqueues a job; the worker
reads, parses, and deletes.

The staging file name is derived from the upload id, which the API generates.
The uploaded filename is recorded in `app.upload.filename` for display only and
never influences a path. An upload therefore cannot steer a write outside the
staging directory, whatever it claims to be called.

The queue payload carries the upload id and the tenant identifiers, never the
path and never file content, because `pgboss.job` has no row level security and
is cross-tenant readable by `bap_api`.

Caddy caps the request body, and the API compares the size it actually received
against the same limit rather than trusting the proxy.

`scripts/verify-compose.mjs` asserts the volume's exact member set, so a third
service cannot quietly gain access to other tenants' staged uploads.

## Consequences

The two services that need the file share exactly one writable surface, and
every other service keeps none. The blast radius of the volume is the pair that
already share the `bap_api` database role, so it grants no privilege they did
not already hold over the same tenant data.

A staged file outlives its request, so a crashed worker can leave one behind.
The worker deletes on both the success and the failure path, and the file name
is derived from the upload id, so a retry overwrites rather than accumulates. A
periodic sweep is not implemented and is not needed until uploads are frequent
enough to matter; the volume is bounded by the host, not by a tenant.

The volume is a host-local resource, so it ties ingestion to a single host until
object storage arrives. That is the same constraint the rest of the deployment
already has, and it is the reason object storage remains the documented next
step rather than a rejected option.
