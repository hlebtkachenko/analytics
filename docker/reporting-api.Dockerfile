# syntax=docker/dockerfile:1.7-labs@sha256:b99fecfe00268a8b556fad7d9c37ee25d716ae08a5d7320e6d51c4dd83246894

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS base
ENV IBM_TELEMETRY_DISABLED=true
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /workspace

FROM base AS dependencies
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @bap/reporting-api...

FROM dependencies AS build
COPY apps/reporting-api apps/reporting-api
COPY packages packages
RUN pnpm --filter @bap/db build && pnpm --filter @bap/security build && pnpm --filter @bap/reporting-api build
RUN pnpm --filter @bap/reporting-api --prod deploy /runtime --legacy

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV HOST=0.0.0.0
ENV IBM_TELEMETRY_DISABLED=true
ENV NODE_ENV=production
ENV PORT=3002
WORKDIR /app
RUN groupadd --system --gid 1001 bap && useradd --system --uid 1001 --gid bap bap
COPY --from=build --chown=bap:bap /runtime ./
COPY --chown=bap:bap THIRD_PARTY_NOTICES.md ./
COPY --chown=bap:bap licenses ./licenses
USER bap
EXPOSE 3002
CMD ["node", "dist/main.js"]
