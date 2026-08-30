# ADR 0004: Controlled Internet Egress

- Status: accepted
- Date: 2026-08-30

## Context

The `app` and `data` networks are internal, so the web application and both APIs
have no outbound path. Transactional mail and AI providers are external HTTPS
services, and the web application is the only runtime that has to call them.
Attaching every service to a routable network would remove that boundary for
runtimes that never need it.

## Decision

Add a dedicated non-internal `internet-egress` network and attach only services
with a justified provider dependency. Today that allowlist is exactly `web`.
`scripts/verify-compose.mjs` enforces the membership list, the non-internal
network flag, and the explicit exclusion of `api` and `reporting-api` in every
Compose mode, so any later attachment fails the contract check by name.

Declare `web` network membership in mapping form with explicit priorities.
Docker installs the default route from the network a container joins first, and
Compose orders attachments by descending `priority` and then by name. Without a
priority `app` would sort first, and its internal flag would leave `web` without
a default route despite the new network. `internet-egress` therefore carries
both the highest `priority` and the highest `gw_priority`, because attachment
order alone does not decide the gateway when another attached network is also
routable, as `data` is under the development overlay.

## Consequences

The web application reaches external providers directly, while `api` and
`reporting-api` deliberately keep no outbound path and can only be reached from
`app`. The container smoke job performs an HTTPS request from inside `web`, so a
regression in the priority ordering fails CI instead of surfacing as a provider
timeout in production. Egress remains unrestricted for the allowlisted service;
an allowlisting forward proxy that pins the accepted provider hostnames is the
next hardening step once the provider set is fixed.
