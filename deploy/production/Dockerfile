# ── Prismix — production image ───────────────────────────────────────
# Built in GitHub Actions for linux/amd64 and published to GHCR.
# The runtime image contains dist/ plus production dependencies only.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

FROM base AS build-deps
COPY package.json pnpm-lock.yaml ./
RUN HUSKY=0 pnpm install --frozen-lockfile

FROM build-deps AS build
COPY . .
ARG DOMAIN=prismix.live
ARG VITE_WALLETCONNECT_PROJECT_ID=""
ENV NODE_ENV=production \
    DOMAIN=$DOMAIN \
    VITE_WALLETCONNECT_PROJECT_ID=$VITE_WALLETCONNECT_PROJECT_ID
RUN HUSKY=0 pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN HUSKY=0 pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3403
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY deploy/seed ./deploy/seed

USER node
EXPOSE 3403

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3403)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
