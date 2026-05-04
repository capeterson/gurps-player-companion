# GURPS Player Companion

A local-first Progressive Web App for managing GURPS 4e player characters,
campaigns, and shared libraries. Single Bun process serves the HTTP API,
WebSocket push channel, OpenAPI doc, and the React PWA client.

> Status: **early development** — see the build plan in
> `~/.claude/plans/review-plan-md-http-plan-md-as-a-fizzy-bubble.md`.

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

```sh
cp .env.example .env
docker compose -f docker-compose.dev.yml up --build
```

Then open <http://localhost:3000>.

## Production build

```sh
docker compose up --build -d
```

Requires `JWT_SECRET` set to ≥32 chars (e.g. `openssl rand -hex 32`).

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
