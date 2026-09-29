# syntax=docker/dockerfile:1.7
# Separate build tools from the production dependency tree shipped at runtime.

ARG BUN_VERSION=alpine

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

FROM oven/bun:${BUN_VERSION} AS production-deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:${BUN_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG APP_RELEASE=development
ENV APP_RELEASE=${APP_RELEASE}
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/server/db/migrations ./src/server/db/migrations
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/healthz || exit 1
CMD ["bun", "run", "dist/server/index.js"]
