# Conductor and CI Source-of-Truth Reconciliation

**Date:** 2026-09-01

## Problem

Repository automation overstates workspace isolation: Conductor allows
concurrent run scripts even though the native development command and Docker
stack use fixed or workspace-external resources. Setup checks only the Node.js
major, CI does not lint the Conductor lifecycle scripts, and Dependabot does not
track the root Compose manifests.

## Scope

- Mark Conductor run scripts nonconcurrent and keep only effective stack port
  overrides.
- Require the exact repository-pinned Node.js version during workspace setup.
- Make archive cleanup stop safely when it cannot enter the repository.
- Syntax-check and shellcheck both Conductor scripts in CI.
- Track root Compose image references with Dependabot's `docker-compose`
  ecosystem.
- Align the development and getting-started documentation with those contracts.

This change does not alter application behavior, Compose topology, secret
handling, production deployment, or the resources removed during archive.

## Design and security

The shared settings use Conductor's `nonconcurrent` mode because the repository
cannot guarantee isolated ports and Docker state across simultaneous run
scripts. Setup compares `process.versions.node` with `.nvmrc` after attempting
the normal nvm activation. Archive resolves and enters its repository before
running Docker, otherwise it reports the condition and exits without cleanup. No
credential values enter version control or logs.

## Verification

- Parse the repository TOML and Dependabot YAML, then assert their changed
  contracts.
- Run `bash -n` and `shellcheck` for both Conductor scripts.
- Run `actionlint` for the CI workflow.
- Run the Node pin check, Compose model verification, focused formatting, and
  `git diff --check`.

## Open questions

None.
