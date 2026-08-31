# Third-Party Notices

## Carbon Design System

`@carbon/react`, `@carbon/icons-react`, `@carbon/pictograms-react`,
`@carbon/charts-react`, and their Carbon dependencies are licensed under Apache
License 2.0. BAP's original offline guidance is source-attributed to the Carbon
website repository, which is also licensed under Apache License 2.0.

- Carbon copyright notice: Copyright 2015 IBM Corp.
- Carbon Charts copyright notice: Copyright 2018 IBM.

- Source: <https://github.com/carbon-design-system/carbon>
- Website source: <https://github.com/carbon-design-system/carbon-website>
- Charts source: <https://github.com/carbon-design-system/carbon-charts>
- License: [Apache License 2.0](licenses/APACHE-2.0.txt)

Carbon, IBM, and IBM Plex are trademarks of IBM. BAP is not affiliated with,
endorsed by, or maintained by IBM. Carbon source code and website content are
not redistributed by BAP; local guidance and fixtures are modified,
source-attributed summaries for the pinned public APIs.

## Design-system workbench

The local workbench uses Storybook, TanStack Virtual, and MiniSearch. Storybook
provides the interactive component catalog, TanStack Virtual keeps complete icon
and pictogram explorers bounded, and MiniSearch indexes local knowledge content.
All three are licensed under the MIT license. BAP disables Storybook telemetry
in configuration and every Storybook execution environment.

- Storybook: <https://github.com/storybookjs/storybook>
- TanStack Virtual: <https://github.com/TanStack/virtual>
- MiniSearch: <https://github.com/lucaong/minisearch>
- Storybook license: [MIT](licenses/STORYBOOK-MIT.txt)
- TanStack Virtual license: [MIT](licenses/TANSTACK-VIRTUAL-MIT.txt)
- MiniSearch license: [MIT](licenses/MINISEARCH-MIT.txt)

Cube UI Kit informed only the workbench information architecture. No Cube UI Kit
source, documentation, or visual implementation is included.

- Cube UI Kit: <https://github.com/cube-js/cube-ui-kit>

## IBM Plex

`@ibm/plex-sans`, `@ibm/plex-mono`, and `@ibm/plex-serif` are licensed under the
SIL Open Font License 1.1. BAP self-hosts Carbon's complete default WOFF2 font
matrix through the application build.

Copyright © 2017 IBM Corp. with Reserved Font Name "Plex".

- Source: <https://github.com/IBM/plex>
- License: [SIL Open Font License 1.1](licenses/IBM-PLEX-OFL-1.1.txt)

## IBM Telemetry

Some Carbon and Plex packages declare IBM Telemetry lifecycle scripts. BAP
blocks those scripts through its pnpm build policy. Repository build scripts and
Docker stages additionally set `IBM_TELEMETRY_DISABLED=true`.

- Source: <https://github.com/ibm-telemetry/telemetry-js>

## SaaS foundation libraries

The Phase 5 foundation uses the following direct open-source dependencies:

- Better Auth, JOSE, node-postgres, Pino, Helmet, i18next, react-i18next,
  Drizzle Kit, and esbuild under their MIT licenses.
- Drizzle ORM, the Prometheus JavaScript client, Swagger UI, and Playwright
  under Apache License 2.0.
- NestJS Swagger under the MIT license.

Copyright notices and license texts remain in each installed package. Important
upstream notices include Better Auth copyright 2024-present Bereket Engida, JOSE
copyright 2018 Filip Skokan, node-postgres copyright 2010-2021 Brian Carlson,
Pino copyright 2016-2025 Matteo Collina, David Mark Clements and its
contributors, Helmet copyright 2012-2026 Evan Hahn and Adam Baldwin, and i18next
copyright 2011-present i18next.

- Better Auth: <https://github.com/better-auth/better-auth>
- Drizzle: <https://github.com/drizzle-team/drizzle-orm>
- JOSE: <https://github.com/panva/jose>
- Prometheus JavaScript client: <https://github.com/prometheus/client_js>
- License: [Apache License 2.0](licenses/APACHE-2.0.txt)

## Platform batteries

pg-boss provides the PostgreSQL-backed job queue and cron scheduler under the
MIT license. BAP pins its schema in a checksummed migration and keeps pg-boss
self-migration disabled.

Copyright (c) 2016 Tim Jones.

- Source: <https://github.com/timgit/pg-boss>
- License: [MIT](licenses/PG-BOSS-MIT.txt)

Resend provides the transactional mail client under the MIT license. BAP reads
its API key from a mounted credential file. Transport selection is explicit:
selecting Resend without a non-placeholder key fails closed, and the log
transport is available only as a separate opt-in for non-sending runtimes.

Copyright (c) 2023 Plus Five Five, Inc.

- Source: <https://github.com/resend/resend-node>
- License: [MIT](licenses/RESEND-MIT.txt)

Nodemailer provides the narrow SMTP client used only with the development/CI
Mailpit sink. It is licensed under MIT-0.

Copyright (c) 2011-2023 Andris Reinman.

- Source: <https://github.com/nodemailer/nodemailer>
- License: [MIT-0](licenses/NODEMAILER-MIT-0.txt)

Mailpit provides the digest-pinned development/CI mail sink under the MIT
license. It is absent from the production topology.

Copyright (c) 2022-Now() Ralph Slooten.

- Source: <https://github.com/axllent/mailpit>
- License: [MIT](licenses/MAILPIT-MIT.txt)

ExcelJS provides the streaming spreadsheet reader and writer under the MIT
license. BAP overrides its pinned `uuid` dependency to a patched release.

Copyright (c) 2014-2019 Guyon Roche.

- Source: <https://github.com/exceljs/exceljs>
- License: [MIT](licenses/EXCELJS-MIT.txt)

## AI SDK

The AI SDK provides the provider-agnostic model plumbing in `@bap/ai`. `ai`,
`@ai-sdk/anthropic`, and `@ai-sdk/openai` are licensed under Apache License 2.0.
BAP reads the provider name, key, base URL, and model defaults from one mounted
credential file and ships no tools, prompts, or model defaults of its own.

Copyright 2023 Vercel, Inc.

- Source: <https://github.com/vercel/ai>
- Upstream notice: [Apache License 2.0](licenses/AI-SDK-APACHE-2.0.txt)
- License: [Apache License 2.0](licenses/APACHE-2.0.txt)

## Container foundation

Caddy is licensed under Apache License 2.0. PostgreSQL is licensed under the
PostgreSQL License. Restic is licensed under the BSD 2-Clause License. The
database image is the pgvector build of PostgreSQL 18, and pgvector is licensed
under the PostgreSQL License.

- Caddy: <https://github.com/caddyserver/caddy>
- PostgreSQL: <https://www.postgresql.org/about/licence/>
- pgvector: <https://github.com/pgvector/pgvector>
- Restic: <https://github.com/restic/restic>
- Restic license: [BSD 2-Clause](licenses/RESTIC-BSD-2-CLAUSE.txt)
