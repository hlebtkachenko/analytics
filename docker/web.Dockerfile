# syntax=docker/dockerfile:1.7-labs

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS base
ENV NEXT_TELEMETRY_DISABLED=1
ENV IBM_TELEMETRY_DISABLED=true
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
WORKDIR /workspace

FROM base AS dependencies
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json apps/*/package.json packages/*/package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @bap/web...

FROM dependencies AS build
COPY apps/web apps/web
COPY packages packages
RUN pnpm --filter @bap/db build \
  && pnpm --filter @bap/web build \
  && pnpm --filter @bap/web build:cli

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV IBM_TELEMETRY_DISABLED=true
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /workspace/apps/web/dist-cli ./apps/web/dist-cli
COPY --chown=nextjs:nodejs THIRD_PARTY_NOTICES.md ./
COPY --chown=nextjs:nodejs licenses ./licenses
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
