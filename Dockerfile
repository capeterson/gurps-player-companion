# syntax=docker/dockerfile:1.7
# Multi-stage build: install -> client build -> server bundle -> runtime image.

ARG BUN_VERSION=1.1-alpine

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build:client \
 && bun run build:server

FROM oven/bun:${BUN_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/server/db/migrations ./src/server/db/migrations
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/healthz || exit 1
CMD ["bun", "run", "dist/server/index.js"]
