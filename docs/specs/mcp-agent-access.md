# Design & Requirements: Delegated MCP Access

**Status: implemented.** This document is the normative design and current-state
description for delegated agent access. MCP, OAuth grant storage, consent and
connected-app UI, exact operation coverage, and parity drift guards ship together.

## Decision: host with the normal app server

GPC serves remote MCP at `/mcp` using Streamable HTTP in the existing Bun /
Hono process, on the app's origin and port. The same process hosts the OAuth
authorization server. Neither requires another application, container, database,
or public origin. MCP is a transport adapter over GPC operations.

The protocol baseline is MCP **2025-11-25** with the SDK pinned to `1.30.0`.
Initialization tests pin negotiated versions. Upgrading
the baseline requires updating the transport/auth tests and this document.
Streamable HTTP supports hosting an endpoint in an existing server; OAuth's
resource-server and authorization-server roles may be co-located. See the
[MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

The transport uses the SDK's Bun-compatible Web Request/Response adapter and is
mounted before SPA fallback. Each request gets a fresh stateless transport with
no durable MCP session ID. It supports initialization, version negotiation,
`tools/list`, and `tools/call`, including the baseline's content negotiation.
Unsupported GET streams and DELETE sessions return protocol 405 responses. The
server has no legacy HTTP+SSE endpoint or stdio sidecar.

Production routing, development Vite routing, and proxy configuration all pass
`/mcp`, `/oauth/*`, and `/.well-known/*` to Hono. Reject invalid
Origin headers, configure browser-client CORS explicitly (including exposed auth
challenge/protocol headers), require HTTPS outside loopback development, and
bound request sizes, execution time, and per-user/client request rates. Authenticated
MCP responses and OAuth exchanges must never enter PWA or proxy caches.
Register HTTP endpoints with `createRoute`; OpenAPI describes the transport
and OAuth endpoints, while MCP tool schemas describe the JSON-RPC operations.

## Shared execution architecture

`auth/session.ts` resolves app JWTs and API keys, while `oauth/service.ts`
resolves a separate grant-backed OAuth principal. The delegated executor creates
an in-memory Request and runs it through the same registered Hono/OpenAPI handler
chain as REST. A private WeakMap keyed by Request identity supplies the actor;
external headers and bodies cannot enter that map. The executor never mints an
app JWT, forwards a bearer token, or makes a network loopback.

This shared handler graph owns resource checks, Zod validation, privacy
projection, transactions, audit, and post-commit invalidation. Existing service
primitives (`entityWrites`, `libraryReferences`, `characterAccess`, and
`syncDispatch`) remain shared where REST and sync overlap. MCP transport code
does not query or mutate domain rows or implement a parallel set of GURPS rules.

Implemented modules:

- `src/server/mcp/`: transport, tool registry, encoding, coverage/parity tests.
- `src/server/oauth/`: discovery, authorization, token/grant lifecycle.
- `src/shared/schemas/`: reusable operation and OAuth persistence schemas.
- Settings connected-app controls and authorization consent in the player UI.

## Delegation requirements

| ID | Required behavior |
|---|---|
| AUTH-1 | Authorization-code flow with PKCE S256 for public clients. Login and consent happen on GPC using existing password/passkey authentication; agents never receive player passwords, app refresh tokens, or newly minted API keys. Require recent primary authentication when approving a new grant. |
| AUTH-2 | Publish `/.well-known/oauth-protected-resource/mcp` with the canonical `/mcp` resource and authorization server, and `/.well-known/oauth-authorization-server` with issuer, authorization/token endpoints, scopes, and PKCE support. Unauthenticated MCP requests return 401 with a discoverable `WWW-Authenticate` challenge. Canonical URLs come from trusted deployment configuration, never arbitrary Host/forwarded headers. |
| AUTH-3 | Provide `/oauth/authorize`, `/oauth/token`, and `/oauth/revoke`. Bind one-time, short-lived codes to player, client, exact redirect URI, PKCE challenge, granted scopes, and resource. Validate the requested resource at authorization and token exchange; reject a mismatched audience on MCP calls. Protect browser consent against CSRF, preserve client state, and reject unregistered redirects before redirecting anywhere. No implicit or password grant. |
| AUTH-4 | Support pre-registered clients initially; document registration/setup for supported clients. Client ID Metadata Documents are the intended extension for clients without prior registration; enabling them requires SSRF-safe fetches, redirect/DNS/private-network defenses, bounded responses, and metadata validation tests. Dynamic registration is optional and must not be advertised until implemented. |
| AUTH-5 | Issue separate short-lived, audience-bound OAuth access tokens and rotating refresh tokens. Persist grants and token-family state in Postgres; store opaque token/code secrets only as hashes. Check revocation, user suspension/deletion, authentication version, and current permissions on every call. Password change/recovery invalidates delegated sessions too. Refresh cannot widen scope or change resource/client; replay revokes the family. |
| AUTH-6 | Settings lists connected clients, scopes, creation/last-use time, and a revoke action. Revocation invalidates the entire grant, including outstanding access and refresh tokens, on the next request. Ordinary app logout clears local account state but leaves explicitly approved grants; show this distinction to players. Account recovery revokes all grants. |
| AUTH-7 | Effective authority is the intersection of the user's current GPC permissions and granted scopes. No client-selected actor ID, impersonation, superuser elevation, or scope bypass through REST/sync. OAuth tokens for `/mcp` are rejected by existing app-session/API-key endpoints; shared handlers receive a trusted actor context rather than a forwarded token. |

The scope vocabulary is `gpc:read` for player-domain reads (including the
current-user identity), `gpc:write` for ordinary creates/updates, and
`gpc:manage` for deletion, invitations/membership/ownership changes and other
operations explicitly classified as management. Consent names these capabilities
in plain language. A write request must explicitly request its needed scopes;
read consent alone never permits mutation. A campaign owner or manager can only
delegate powers already allowed by the campaign's current rules, including the
default-off GM character-edit setting. Credentials, consent management, and
instance administration are outside the agent surface even for superusers.

Clients, grants, authorization codes, and refresh families persist with expiry,
revocation and cleanup rules. Expired request, code, access, and refresh rows are
pruned opportunistically at most once per minute; grants remain for explicit
revocation and history provenance. New tables use PG18 migrations and server-default
UUIDs. Every persisted JSON field needs its shared Zod schema, Drizzle `$type`,
write-boundary validation, and a row in [json-fields.md](json-fields.md).
Never store credentials in entity history, tool results, or diagnostic logs.

## Functional parity contract

Parity means complete player-domain API coverage with identical semantics,
subject only to explicit OAuth scope restrictions. It does not mean exposing
login, credential management, administrative, or replication infrastructure as
tools. The current covered surface is:

| API surface | MCP requirement |
|---|---|
| Current user (`GET /auth/me`) | Safe current-user identity with no credentials. |
| Characters | List/detail/create/update/delete, warning dismissal, all trait/skill/spell/language/technique/inventory writes, combat updates, condition-group activation/deactivation. Include every writable field, optional/null/default behavior, and computed detail field. |
| Campaigns | List/detail/create/update/delete, member and role changes, ownership transfer; use existing role checks. |
| Campaign library | Read, CRUD for all seven library types, YAML import/export with all existing options and result semantics. Preserve YAML as a typed text payload. |
| Invitations and notifications | All list, invite/cancel/accept/reject, mark-read/read-all, and deletion operations. |
| Adventure log | All reads/writes, privacy, session/location fields, and XP award semantics. |
| Encounters | List/detail/create/update, advance turn, combatant and effect CRUD; retain optimistic turn-concurrency checks and hidden-NPC/PC privacy. |
| History | Character and campaign history, filters/pagination, existing privacy and role restrictions. |
| Sync cursor/operations and WebSocket | Transport infrastructure excluded as tools; equivalent domain operations remain covered. MCP commits still propagate through the normal cursor/invalidation mechanisms. |
| Login/register/recovery/refresh/logout, passwords, passkeys, API keys, OAuth consent/token management | Browser/security infrastructure excluded, except the safe current-user read above. |
| Admin, health, OpenAPI, static assets, MCP/OAuth discovery and transport | Infrastructure/admin excluded from player tools. |

Device-only roll history and solo encounter scratchpads are not raw API
capabilities and cannot be read remotely. A future convenience tool requiring a
new domain operation must introduce that operation to the raw API too, with
shared handlers and tests, instead of creating an MCP-only feature.

Create an explicit, checked-in operation-to-tool manifest keyed by HTTP method
and normalized path (or stable unique operationId once assigned). Each entry
names the tool, schemas, handler, required scopes, mutation/destructive hints,
and parity tests, or an exact exclusion with a reason. Do not use a catch-all
HTTP/URL/SQL tool or wildcard exclusions that silently swallow new routes.

Generate tool input/output definitions from the canonical shared schemas and
validate outputs as well as inputs. Preserve required fields, refinements,
nullable values, unions, bounds, pagination, filters, and import formats. Keep
stable tool names; descriptions explain field meaning and effects. Return
structured results and a useful text rendering. Preserve domain error codes,
field errors, conflicts and retry guidance in tool errors; protocol failures and
OAuth failures retain their protocol/HTTP meanings. Set read-only, destructive,
and idempotency annotations accurately; annotations are hints, not enforcement.
See [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

### Drift must fail CI

The normal `check` gate fails when:

1. An emitted OpenAPI method/path has no exact mapping or justified exclusion,
   a mapping references a removed operation, or tool names collide.
2. The live `tools/list` catalog differs from the checked-in generated catalog,
   schemas, scope metadata, or operation mapping.
3. REST and MCP executions from equivalent seeded DB states disagree on results,
   errors, authorized visibility, stored changes, history, or invalidations.
   Normalize only volatile IDs/timestamps and transport envelopes.

Schema snapshots alone are insufficient. Cover each mapped operation with
success and representative validation/permission failures, and add focused
cases for defaults/nulls, cross-character inventory parents, foreign library
references, share-gate lists/detail/history, private log entries, hidden encounter
data, manager/owner differences, and revoked membership during an agent session.
Every future raw API addition/change must update its mapping, tool schemas,
shared handler, parity tests and relevant specs in the **same change**. Missing
coverage blocks the change; an exclusion must identify a real scope boundary,
not serve as a workaround for unfinished parity.

## Writes, sync, retries, and audit

Agent calls are online server operations. They do not create browser Dexie
entries or count as pending work in a player's local outbox. The browser keeps
its existing local-first path. MCP commits allocate normal revisions and
history/tombstones, and publish invalidations only after commit; clients converge
via HTTP cursor pulls even when WebSocket delivery is missed. Existing pending
local fields stay protected and replay/conflict rules remain authoritative.
Never claim MCP can see unsynced browser edits or overwrite them via cache pushes.

Apply `decideCharacterAccess`/the central access services on every response,
including tools returning aggregates or error details. Use `withAudit` with the
player as actor. Add durable OAuth client/grant provenance to the audit context
and history projection before release, so history can distinguish an agent edit
from the player's direct edit. Multi-write gestures share a batch ID; this alone
does not promise atomicity. Changes to history storage/projections must update
[history-tracking.md](history-tracking.md) and its schemas/tests.

MCP request IDs are not mutation deduplication keys. Define a shared mutation
idempotency contract for REST and MCP: persist the key, actor/client, operation,
input fingerprint, and outcome transactionally; identical retries replay the
outcome, differing input rejects key reuse. Set a documented retention window.
Test lost-response retries for create, import, XP awards, and turn advancement.
Use existing revision/turn checks; any added precondition must be shared by REST
and MCP. Never silently retry a conflict with freshly fetched values. Return a
clear result for partial/bulk failures consistent with the underlying operation.

## Operation execution and parity evidence

`src/server/mcp/operationManifest.ts` is the exact mapping for every OpenAPI
method/path. It exposes 88 player-domain tools and gives each excluded
infrastructure operation its own reason. `docs/mcp-tools.json` is the generated
catalog; `mcp:check` fails on route, mapping, name, scope, annotation, or schema
drift. Tool schemas come from the OpenAPI routes and responses are also checked
against the original Zod response schemas retained by the registry.

REST and MCP execute the same Hono/OpenAPI handler graph through the in-process
executor. A private Request object-identity capability supplies the validated
actor; no external header can forge it, and OAuth bearer tokens are rejected by
`/api/v1/*`. The ambient context supplies OAuth client and grant IDs to
`withAudit`, so history distinguishes direct edits from `Player via Client`.
Mutation idempotency wraps the shared handler in an outer transaction, persists
its response for 24 hours, and rejects key reuse with changed input or authority.

## Client registration and operations

Standards-compatible MCP clients that support Streamable HTTP, OAuth discovery,
authorization code, PKCE S256, and bearer protected resources are supported when
pre-registered through `OAUTH_CLIENTS`, a JSON array of `{clientId,
name, redirectUris, scopes}`. Configuration is authoritative: removing a client
disables it and its tokens on the next OAuth/token/MCP check, and narrowing its
allowed scopes invalidates older broader tokens. Redirect URIs match exactly,
use HTTPS or HTTP on a loopback host, and reject credentials or fragments.
Public clients use authorization code with PKCE S256 and no secret. Browser
clients also list their origin in `CORS_ORIGINS`; discovery, token, revoke, and
MCP preflights are served without credentials.
Dynamic registration and Client ID Metadata Documents are not advertised.

Client setup uses the `/mcp` resource URL. Discovery supplies the authorization
server and endpoints. The client sends its registered ID, exact callback,
43-character S256 challenge, requested scopes, opaque state, and canonical
resource to `/oauth/authorize`; consent returns the one-time code to that
callback. The client exchanges it with the original verifier and resource at
`/oauth/token`, then uses the `gpco_` access token only at `/mcp`.

`APP_BASE_URL` is the canonical origin used by discovery and audience checks.
Production requires a pathless HTTPS origin. Proxies route `/mcp`, `/oauth/*`,
and `/.well-known/*` without caching. Access tokens live for 15 minutes, refresh
tokens 30 days, authorization codes five minutes, and idempotency results 24
hours. Backups include OAuth and idempotency tables with the rest of Postgres;
token plaintext cannot be recovered. Expired secret rows are pruned while
revoked grants remain available for Settings/history provenance. Opaque secrets
are stored only as hashes. A lost refresh response retries
with the same `request_id` for 30 seconds; a different replay revokes the family.

## Delivery and acceptance

The implementation is released only with evidence for these gates:

1. Extract shared operations, define exact coverage/exclusions and scopes, and
   establish parity CI against the current raw API.
2. Add OAuth migrations, metadata, browser consent/connected-app UI and token
   validation. Exercise code expiry/reuse, PKCE, wrong redirect/client/resource,
   consent denial, insufficient scope, refresh replay and immediate revocation.
3. Mount the MCP transport and cover every included operation. Validate production
   and development paths, proxy headers, non-HTML discovery/error responses,
   process restart, initialization and tool discovery with a real MCP client.
4. Run Postgres integration parity tests, an end-to-end browser authorization →
   agent read/write → player history/cursor observation → revoke flow, and a
   concurrent offline-browser edit case with missed WS delivery. Run the normal
   `check`, client tests for consent/Settings changes, and relevant Playwright tests.
5. Document supported clients, their registration flow, canonical public origin,
   proxy/TLS setup, scopes, credential expiry/revocation and backup/cleanup needs.
   Publish a completed operation coverage report. Update overview, architecture,
   sync, sharing, history and JSON specs to describe the implemented state.

The checked-in evidence includes the generated 88-tool catalog, per-operation
successful REST/MCP differential and scope-denial fixtures, OAuth boundary and
transport tests, transaction/idempotency regressions, client consent/Settings
tests, and the Playwright browser authorization acceptance flow.
