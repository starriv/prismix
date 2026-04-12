# ── Prismix — Production Dockerfile (PostgreSQL + Redis) ────────────
# Usage:
#   docker build -f deploy/production/Dockerfile -t prismix .

# ── Stage 1: Build ────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build:web

# ── Stage 2: Runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Built frontend
COPY --from=builder /app/dist/web ./dist/web

# Server source (runs via tsx)
COPY src/ ./src/
COPY tsconfig.json ./

# PG migrations + seed
COPY drizzle/ ./drizzle/
COPY deploy/seed/ ./deploy/seed/

USER node

ENV NODE_ENV=production
ENV PORT=3403

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/health || exit 1

CMD ["pnpm", "preview"]
