# syntax=docker/dockerfile:1
#
# Multi-stage build for the "Невидимка" monorepo (npm workspaces).
# Produces three separate final images via --target: bot, worker, web.
#
# Build examples:
#   docker build --target bot    -t nevidimka-bot    .
#   docker build --target worker -t nevidimka-worker .
#   docker build --target web    -t nevidimka-web    .
#
# In practice, use docker-compose.yml instead of building these by hand —
# it wires all three together with Postgres and the right env vars.
#
# Root CI builds every target and verifies production startup via Compose.

FROM node:22-slim AS base
WORKDIR /app

# ---- full deps (needed only to build: typescript, tsx, playwright, ...) ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/telegram/package.json packages/telegram/package.json
COPY packages/video/package.json packages/video/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# ---- lean production-only deps (no typescript/tsx/playwright at runtime) ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/telegram/package.json packages/telegram/package.json
COPY packages/video/package.json packages/video/package.json
COPY packages/logger/package.json packages/logger/package.json
COPY apps/bot/package.json apps/bot/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

# ---- build everything (same order the root "build" script uses) ----
FROM deps AS builder
COPY . .
RUN npm run build

# ==================== bot ====================
FROM base AS bot
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/bot ./apps/bot
CMD ["node", "apps/bot/dist/index.js"]

# ==================== worker (needs ffmpeg) ====================
FROM base AS worker
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker ./apps/worker
CMD ["node", "apps/worker/dist/index.js"]

# ==================== web (Next.js standalone output) ====================
FROM base AS web
ENV NODE_ENV=production
# next.config.mjs has output: "standalone" — the standalone bundle already
# includes its own pruned node_modules, so no need for prod-deps here.
# Directory layout mirrors the monorepo path (apps/web/server.js), matching
# what was manually verified earlier in this project's history.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
