# GURPS Player Companion

A local-first Progressive Web App for managing GURPS 4e player characters,
campaigns, and shared libraries. Single Bun process serves the HTTP API,
WebSocket push channel, OpenAPI doc, and the React PWA client.

> Status: **early development** — see [AGENTS.md](AGENTS.md) for
> architecture invariants and contribution rules.

## Features (target)

See [AGENTS.md](AGENTS.md) for the architecture invariants and the
no-lost-edits rules.

- Local-first IndexedDB store; works indefinitely offline.
- Durable edit outbox with explicit conflict / suspend / stale-base
  reconciliation.
- WebSocket push for live updates; HTTP cursor backfill on reconnect.
- Per-campaign trait/skill/item library with versioned YAML import/export.
- Character sheet with derived stats, point ledger, encumbrance,
  combat tracker, traits/skills/inventory tabs.
- Adventure log with per-entry visibility (campaign/private).

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun |
| HTTP | Hono + `@hono/zod-openapi` |
| Validation | Zod (shared between server, client, service worker) |
| DB | PostgreSQL 18 + Drizzle ORM |
| Client | React 19, React Router 7, TanStack Query 5 |
| Local store | Dexie 4 (IndexedDB) |
| PWA | vite-plugin-pwa + Workbox |
| Styling | Tailwind 4 + DaisyUI 5 (Arcane theme) |
| Tests | Vitest + bun:test + Playwright |
| Lint/format | Biome |
| Container | Docker + docker-compose |

## Quick start (dev)

Bun, Postgres, and the dev server all run in Docker — nothing is
required on the host except Docker itself.

```sh
docker compose -f docker-compose.dev.yml up --build
```

This starts three services:

| Service  | Port | What it does                                              |
|----------|------|-----------------------------------------------------------|
| `db`     | 5432 | Postgres 18 with a persistent `db_data_dev` volume.       |
| `migrate`| —    | One-shot: `bun install` + `bun run db:migrate`, then exits. |
| `app`    | 3000 | Vite dev server (with HMR) hosting the Hono API via `@hono/vite-dev-server`. Single port, single process. |

Open **<http://localhost:3000>** for the UI; the API is on the same
origin at `/api/v1/...` (e.g.
[`/api/v1/healthz`](http://localhost:3000/api/v1/healthz)).

The `migrate` service populates a shared `bun_modules` volume on first
boot — subsequent `up` runs reuse it and skip the install.

## Common operations

Seed the "Sample" campaign and bootstrap library (idempotent):

```sh
docker compose -f docker-compose.dev.yml run --rm migrate bun run db:seed
```

Tail logs from a single service:

```sh
docker compose -f docker-compose.dev.yml logs -f app
```

Open a `psql` shell against the dev database:

```sh
docker compose -f docker-compose.dev.yml exec db psql -U gurps gurps
```

Stop everything but keep data:

```sh
docker compose -f docker-compose.dev.yml down
```

Stop and **wipe** the dev database (the `-v` flag deletes the
`db_data_dev` volume):

```sh
docker compose -f docker-compose.dev.yml down -v
```

## Production build

Generate a JWT signing key (≥ 32 chars) and put it in `.env`:

```sh
cp .env.example .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

Build the runtime image and start the stack:

```sh
docker compose up --build -d
```

The prod compose runs three services: `db`, a one-shot `migrate` that
applies migrations baked into the image, and `app`. The `app` service
will not start until `migrate` exits 0. The Bun runtime serves the
built React client and the API on the same port.

Open <http://localhost:3000>. Verify health:

```sh
curl -fsS http://localhost:3000/api/v1/healthz
# => {"ok":true}
```

## Layout

```
src/
  server/      Bun process: Hono routes, auth, Drizzle, OpenAPI, WS
  client/      React PWA
  shared/      Pure TypeScript: Zod schemas, GURPS math, YAML codec
  sw/          Service worker + offline replay
docs/
  specs/       YAML and WebSocket protocol specs
  rules/       GURPS rule references (armor mechanics, etc.)
bootstrap/
  sample_library.yaml    seeded into the "Sample" campaign
```
