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
