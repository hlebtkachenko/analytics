# syntax=docker/dockerfile:1.7

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS base
ENV IBM_TELEMETRY_DISABLED=true
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/reporting-api/package.json apps/reporting-api/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/design-system/package.json packages/design-system/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/security/package.json packages/security/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @bap/reporting-api...

FROM dependencies AS build
COPY apps/reporting-api apps/reporting-api
COPY packages/db packages/db
COPY packages/eslint-config packages/eslint-config
COPY packages/security packages/security
COPY packages/typescript-config packages/typescript-config
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
