# Bun, not Node: this backend runs TypeScript directly, no build step, and
# the Prisma client's generator targets `runtime = "bun"` (schema.prisma).
# A Node base image cannot run either of those.
FROM oven/bun:1 AS base
WORKDIR /app

# --- deps ---------------------------------------------------------------
# Separate layer so `bun install` is skipped on rebuilds that only change
# application code.
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# --- build ----------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma/generated/ is gitignored (never commit a generated client), so it
# must exist by the time the image starts. Prisma 7 with @prisma/adapter-pg
# needs no native query-engine binary here -- it is a thin wrapper over `pg`,
# so this step needs no OpenSSL and no binaryTargets juggling.
RUN bunx prisma generate --config prisma/prisma.config.ts

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./

# APP_PORT is the app's own env var (main-config.ts), not Railway's PORT.
# Set APP_PORT=3700 in the Railway service, or change this to match.
EXPOSE 3700

# DATABASE_URL and JWT_SECRET are required; main-config.ts throws at boot
# without them. Every other value is optional -- `bun run doctor` reports
# exactly what a missing one costs, rather than the app crashing on it.
#
# One process starts the API AND all three workers (TTL sweeper, evidence
# backfill, error-log cleanup) -- see index.ts. No separate worker service.
CMD ["bun", "index.ts"]
