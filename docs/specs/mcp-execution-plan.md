# MCP parity execution plan

Status: implementation and independent validation complete.
Requirements: [mcp-agent-access.md](mcp-agent-access.md).

## Execution sequence

1. Inventory every raw API method/path with an exact tool mapping or justified
   exclusion. Generate schemas from the OpenAPI/Zod registry and share the same
   application handlers between REST and MCP.
2. Add same-process OAuth discovery, PKCE authorization, consent, persisted
   grants, refresh rotation, revocation, and connected-app controls.
3. Mount the SDK Streamable HTTP adapter at `/mcp`; preserve HTTP protocol
   semantics, scoped access, bounded requests, and development/production routing.
4. Preserve authorization, privacy, audit attribution, transactional mutation
   deduplication, and post-commit invalidation. Protect browser outbox intent.
5. Run differential API/MCP fixtures, security and retry regressions, client
   tests, browser acceptance, and the full repository check. Fix review findings.
6. Update the living specifications and setup instructions, regenerate contracts,
   incorporate the current raw API, and publish the reviewed implementation as a PR.

Execution used Sol implementation and browser-test subagents. The primary agent
reviewed their code and tests, independently exercised boundaries and the built
application, integrated current main, and performed final validation.

## Completed coverage and review

All 88 player-domain operations have successful REST/MCP differential fixtures
and OAuth scope-denial coverage. Each REST preview rolls back before the MCP
call executes from the equivalent database state. Comparison preserves existing
IDs and normalizes newly allocated IDs, timestamps, and global revisions.
Focused cases cover privacy, ownership, campaign rule sets, and attribute-cap
rejections. Exact mappings and the live catalog are checked for drift in CI.

Review fixes include immutable grant authority, refresh replay revocation,
current client scope ceilings, canonical origins, bounded body parsing, isolated
OAuth rate limits, rollback of rejected writes and their post-commit effects,
permission-aware idempotent replay, and duplicate invalidation prevention.
Browser testing found and fixed query-parameter routing in both Vite and the
service worker.

Main's campaign rule-set/attribute-cap changes were incorporated before final
validation. The OAuth migration follows them as `0042_delegated_oauth.sql`;
tool schemas and differential fixtures include the new API fields.

## Final validation

- Docker/Bun validation: **1,142 passed, one existing skip, zero failures**,
  10,894 assertions. Typecheck, OpenAPI drift, and MCP catalog drift checks pass.
  Lint passes with four pre-existing React hook warnings.
- Node 22/Vitest: **666 client tests passed across 74 files**.
- Client, server, and migration production bundles build successfully.
- Playwright 1.59.1 Chromium passes against development and built servers. The
  final rebased built-app run also passes with default request limits and an
  active service-worker controller.
- Browser coverage includes login, consent denial/approval, PKCE exchange, real
  SDK discovery/read/write/history, HTTP cursor convergence with WebSockets
  blocked, a pending offline ST edit concurrent with an MCP DX edit, Settings
  revocation, and immediate rejection of the old token.
- The complete migration chain applies to fresh Postgres 18. The delegated OAuth
  migration also passes repeat application. Temporary review apps and databases
  are removed after validation.
- `git diff --check` passes. Per-PR CI runs contract checks, server/client tests,
  and builds. Browser acceptance is run locally during PR authoring against both
  development and built apps, then enforced remotely against the selected source
  image, with an isolated database, before named release promotion.

## Reproducing validation

Run server checks in the project Bun container with a migrated, isolated
`DATABASE_URL`: `bun run check`. Use Node 22 for Vitest with
`--maxWorkers=2 --minWorkers=1`; Bun 1.2's local Vitest worker runtime did not
execute reliably. The available Playwright image matches the installed 1.59.1
package.

For browser acceptance, configure the public origin and `playwright-mcp` client
as described in `tests/e2e/mcp-oauth.spec.ts`, then run that file with Chromium.
Set `MCP_E2E_START_SERVER=1` to let Playwright start the app and
`MCP_E2E_BUILT_SERVER=1` to test built bundles with an active service worker.
Avoid concurrent DB-mutating suites against the same database; configured OAuth
clients are authoritative.
