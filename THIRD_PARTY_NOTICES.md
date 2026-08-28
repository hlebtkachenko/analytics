# Third-Party Notices

## Carbon Design System

`@carbon/react`, `@carbon/icons-react`, `@carbon/charts-react`, and their Carbon
dependencies are licensed under Apache License 2.0.

- Carbon copyright notice: Copyright 2015 IBM Corp.
- Carbon Charts copyright notice: Copyright 2018 IBM.

- Source: <https://github.com/carbon-design-system/carbon>
- Charts source: <https://github.com/carbon-design-system/carbon-charts>
- License: [Apache License 2.0](licenses/APACHE-2.0.txt)

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

## Container foundation

Caddy is licensed under Apache License 2.0. PostgreSQL is licensed under the
PostgreSQL License. Restic is licensed under the BSD 2-Clause License.

- Caddy: <https://github.com/caddyserver/caddy>
- PostgreSQL: <https://www.postgresql.org/about/licence/>
- Restic: <https://github.com/restic/restic>
- Restic license: [BSD 2-Clause](licenses/RESTIC-BSD-2-CLAUSE.txt)
