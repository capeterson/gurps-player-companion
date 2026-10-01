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

### Embedded details (MCP UI / MCP Apps)

Settings → **Experimental Features** offers an **MCP UI** toggle, off by default
for existing and new users. The account preference is persisted in
`users.experimental_mcp_ui` and read during OAuth token resolution on every MCP
request, rather than copied into tokens or a server-startup cache. No restart,
new grant, or token refresh is needed. Clients must refresh tool discovery to
see changed metadata; an already rendered snapshot is not remotely erased.

`GET` / `PATCH /api/v1/auth/experimental-features` use the strict shared
`experimentalFeatures` schema (`{ mcpUi: boolean }`) and require an active
interactive JWT. These account controls have explicit MCP exclusions; API keys
and delegated clients cannot change the user's opt-in. The settings toggle uses
`useDraftToggle` to serialize rapid changes, retain queued intent, and toast plus
flash on save failure. This account preference is online-only, like theme and
notification preferences, and does not enter the character/library outbox.

When disabled, `tools/list` omits `_meta.ui`, `resources/list` returns no UI
resources, and `resources/read` rejects even a previously discovered UI URI.
The canonical tools and structured responses remain available. The generic
resources capability is stable across initialization so clients can discover
resources after enabling the toggle. The checked-in tool snapshot documents the
supported UI metadata for opted-in accounts; runtime discovery applies the gate.

When enabled, `get_character`, `get_character_inventory_item`, and `get_campaign_library_skill`
advertise `_meta.ui.resourceUri` pointing to
`ui://gurps-player-companion/character.html`. MCP Apps hosts can render a
read-only sheet or focused card alongside the tool result; other clients keep the same
structured result. The authenticated transport supports `resources/list` and
`resources/read`. UI discovery and reads require `gpc:read` and the account MCP UI opt-in; unknown URIs are
rejected without interpreting them as paths or fetching external resources.

The resource uses `text/html;profile=mcp-app` and contains a generic application
shell, never a user-data snapshot or credentials. It is built separately into
`dist/mcp-ui/character.html` with inline JavaScript, CSS, and fonts. Its resource
CSP declares empty connection and external-resource allowlists. It does not load
the PWA, register its service worker, bootstrap browser authentication, or seed a
browser mirror. Tool results arrive through the MCP Apps SDK bridge. Refresh
calls the same read tool with the original character/item or campaign/skill IDs, including its current scope,
authorization, validation, and share-gate checks. Failed/cancelled requests and
refreshes clear the previous snapshot; minimal results replace the full view
with public identity only.

The two focused read tools select a subject by ID and render a single card with
no sheet tabs, attributes, or unrelated collections:

- `get_character_inventory_item` maps to `GET /api/v1/characters/{id}/inventory/{itemId}`.
  It returns the selected effective item and its descendants in depth-first order.
  Leaves return no contents; empty containers show **Empty container.** Nested
  contents start expanded and share the web app's read-only item disclosures.
  The loader uses the authoritative character calculation, then projects the
  subtree. It checks `resolveCharacterView` before loading private sheet data:
  minimal viewers receive 403, and foreign/missing item IDs receive 404.
- `get_campaign_library_skill` maps to `GET /api/v1/campaigns/{id}/library/skills/{skillId}`.
  It returns one campaign definition with description, attribute/difficulty,
  specialization, source, prerequisites, and effects. Membership and campaign
  scoping apply; restricted definitions return 404 to non-owners. Search the
  existing library read with `section: "skills"` first when the ID is unknown.

Both are canonical REST reads executed by the same MCP handler graph, validated
with `src/shared/schemas/details.ts`, and covered by the raw-API parity matrix.
Their schemas and metadata are present in both generated catalogs. Selecting a
new result or refreshing clears the previous card before rechecking access.

The UI reuses the web app's Skills, Traits, Spells, Languages, and Techniques
panels with `canWrite=false`, shared stat cards, the Inventory panel and item details,
sanitized Markdown, `LibrarySkillDetails` shared with the campaign library, and theme styles. Readers can navigate sections, inspect
notes and item stat blocks, filter tables, and use the existing local roller.
It offers no sheet mutations. Roll results and table preferences stay local to
the embedded UI. Portraits are not loaded by this self-contained view.

`bun run build:mcp-ui` builds the resource; `dev`, `dev:server-only`, and `build`
include this step. Restart development after changing embedded UI source.
Ordinary PWA HMR remains unchanged. This follows the
[MCP UI MCP Apps pattern](https://mcpui.dev/guide/server/typescript/usage-examples).
Protocol/resource tests, shared read-only component tests, browser bridge and
viewport checks, the generated catalog, and REST/MCP parity remain release gates.

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
an in-memory HTTPS Request and runs it through the same registered Hono/OpenAPI
handler chain as REST. The synthetic HTTPS URL avoids the production HTTP redirect
boundary; dispatch stays in process and makes no TLS or network connection.
A private WeakMap keyed by Request identity supplies the actor;
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
| AUTH-1 | Authorization-code flow with PKCE S256 for public clients. Login and consent happen on GPC using existing password/passkey authentication; agents never receive player passwords, app refresh tokens, or newly minted API keys. Require recent primary authentication before rendering approval controls for a new grant; a stale session returns directly to login with the complete authorization request preserved. Recheck freshness when approval is submitted. |
| AUTH-2 | Publish `/.well-known/oauth-protected-resource/mcp` with the canonical `/mcp` resource and authorization server, and `/.well-known/oauth-authorization-server` with issuer, authorization/token endpoints, scopes, and PKCE support. Unauthenticated MCP requests return 401 with a discoverable `WWW-Authenticate` challenge. Canonical URLs come from trusted deployment configuration, never arbitrary Host/forwarded headers. |
| AUTH-3 | Provide `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, and `/oauth/register`. Bind one-time, short-lived codes to player, client, exact redirect URI, PKCE challenge, granted scopes, and resource. Validate the requested resource at authorization and token exchange; reject a mismatched audience on MCP calls. Protect browser consent against CSRF, preserve client state, and reject unregistered redirects before redirecting anywhere. No implicit or password grant. |
| AUTH-4 | Support Client ID Metadata Documents (CIMD), Dynamic Client Registration (DCR), and optional operator-configured clients. Advertise CIMD and DCR in authorization-server metadata so standards-compatible public clients need no per-client server configuration. Resolve CIMD only from public HTTPS port 443 with pinned public DNS, no redirects, bounded/time-limited JSON responses, exact client-ID and safe redirect validation, and a capped cache. DCR accepts only public clients using authorization code + PKCE and safe HTTPS or loopback callbacks; it is body/rate limited and returns no client secret. |
| AUTH-5 | Issue separate short-lived, audience-bound OAuth access tokens and rotating refresh tokens. Persist grants and token-family state in Postgres; store opaque token/code secrets only as hashes. Check revocation, user suspension/deletion, authentication version, and current permissions on every call. Password change/recovery invalidates delegated sessions too. Refresh cannot widen scope or change resource/client; replay revokes the family. |
| AUTH-6 | Settings lists connected clients, scopes, creation/last-use time, and a revoke action. Revocation requires an explicit confirmation that names the app and explains the immediate loss of access. Confirmed revocation invalidates the entire grant, including outstanding access and refresh tokens, on the next request; cancellation leaves the grant untouched. Ordinary app logout clears local account state but leaves explicitly approved grants; show this distinction to players. Account recovery revokes all grants. |
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
pruned opportunistically at most once per minute; unused DCR registrations older
than 24 hours are also pruned, while granted clients remain for explicit revocation
and history provenance. CIMD registrations refresh after their bounded metadata
cache expires. Configured HTTPS client IDs remain operator-managed after removal;
metadata discovery cannot re-enable them or overwrite their configuration,
including a concurrent metadata refresh. New tables use PG18 migrations and server-default
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
| Campaign library | Read and CRUD for every library type, plus YAML import/export with sourcebook selection and existing options. Restricted entries are owner-only. Reads support section/name/limit/offset narrowing; preserve YAML export as a typed text payload. |
| Invitations and notifications | All list, invite/cancel/accept/reject, mark-read/read-all, and deletion operations. |
| Adventure log | All reads/writes, privacy, session/location fields, optional points gained and recipient subsets, concrete XP award snapshots, character cap adjustments on create/edit/delete, and identical owner/own-character authorization. |
| Encounters | List/detail/create/update, advance turn, combatant and effect CRUD; retain optimistic turn-concurrency checks and hidden-NPC/PC privacy. |
| History | Character and campaign history, filters/pagination, existing privacy and role restrictions. |
| Sync cursor/operations and WebSocket | Transport infrastructure excluded as tools; equivalent domain operations remain covered. MCP commits still propagate through the normal cursor/invalidation mechanisms. |
| Login/register/recovery/refresh/logout, passwords, passkeys, API keys, OAuth consent/token management | Browser/security infrastructure excluded, except the safe current-user read above. |
| Theme and notification preferences (`GET`/`PATCH /auth/preferences`, `GET`/`PATCH /auth/notification-preferences`) | Browser display preference; excluded, and gated to interactive JWT sessions (`requireActiveJwt`). |
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
Several exact operations may share a task tool only with distinct, explicit
`action` discriminants. Generate each action branch from its canonical route
schema, enforce its own OAuth scope, and test coverage per method/path/action.
Discovery filters action branches and their schemas to the caller’s scopes;
aggregate tool hints reflect all remaining actions. Dispatch validates the
response against the selected operation before projecting an acknowledgement.

Generate tool inputs and read outputs from the canonical shared schemas and
validate every raw handler output as well as every input. Preserve required
fields, refinements, nullable values, unions, bounds, pagination, filters, and
import formats. A bare `{ nullable: true }` alternative inside an OpenAPI union
represents the null branch; the JSON Schema converter emits `{ type: 'null' }`
there so valid ranged-weapon values do not match two `oneOf` branches.
Successful mutation tools deliberately advertise and return one
small acknowledgement shape (`acknowledged`, plus `resourceId` from the result
or canonical target path and `revision` when the result exposes it for that
resource) instead of repeating the REST resource schema. The complete REST response is still
validated before projection. DELETE acknowledgements identify the canonical
path target even when REST returns a refreshed parent; they never attach the
parent's revision to the deleted child. Target selection follows route parameter
order, independent of input object key order. Media cancellation by
`clientUploadId` reports the canonical asset ID from the validated manifest;
the retry alias is never labeled as the affected resource ID.
The complete generated input/output catalog has a regression budget of 550 KB;
the current bounded calculator, source, and modifier contracts account for
about 438 KB after grouping (previously about 549 KB). Compact mutation acknowledgements remain independently capped at
2 KB per mutation operation (including grouped actions) and aggregate outputs at 260 KB, so future schema growth
must remain bounded and avoid duplicating shared definitions.
Tool names are server-local, unprefixed snake_case identifiers such as
`list_characters`, `character_skill`, and `media`. The MCP naming guidance
recommends uniqueness within a server, not an application namespace. Clients
refresh discovery to replace the former `gpc_` names; those names are not
registered as aliases. OAuth scope names remain `gpc:read`, `gpc:write`, and
`gpc:manage`. Related writes share an entity task tool with explicit actions:
for example, `character_skill` and `library_skill` each accept `create`, `update`,
or `delete`. Character/campaign writes, campaign members, received invitations,
notifications, adventure-log entries, encounters/combatants/effects and condition
groups follow the same pattern. Read tools remain separate, preserving their
read-only hints and compact selection. `media` retains its existing mixed task
actions. Email invitations, ownership transfer, YAML import and specialized
character updates remain distinct tasks. Each action retains its exact canonical
schema, OAuth scope, authorization, audit and parity fixture; discovery exposes
only authorized action branches and derives hints from those branches. Deleting
any campaign-library entry requires `gpc:manage`, including sources and modifiers.
Identical grouped output contracts are deduplicated so CRUD acknowledgements do
not repeat one schema per action.
Keep these tool names stable; descriptions explain field meaning and effects.
Successful calls keep the authoritative payload only in `structuredContent`; their text
content is a short HTTP-status pointer so model context does not contain a second
serialized copy. Failed calls retain their complete domain error text and
structured payload, including field errors, conflicts and retry guidance;
protocol failures and OAuth failures retain their protocol/HTTP meanings. Set
read-only, destructive, and idempotency annotations accurately; annotations are
hints, not enforcement. Account- and campaign-bounded operations advertise
`openWorldHint: false` even though the service is remotely hosted. The campaign invitation tool and the invitation action tool advertise
`openWorldHint: true`: invitation creation and acceptance may send the two
user-toggleable invitation emails. No other notification topic supports email.
See [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

### Drift must fail CI

The normal `check` gate fails when:

1. An emitted OpenAPI method/path has no exact mapping or justified exclusion,
   a mapping references a removed operation, or tool/action names collide. Repeated
   tool names require distinct explicit actions; mixed grouped/ungrouped entries fail.
2. The live `tools/list` catalog differs from the checked-in generated catalog,
   schemas, scope metadata, or operation mapping.
3. REST and MCP executions from equivalent seeded DB states disagree on GET
   results, errors, authorized visibility, stored changes, history, or
   invalidations, or a successful mutation acknowledgement does not match the
   validated REST outcome. Normalize only volatile IDs/timestamps and transport
   envelopes.

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
Only non-media mutation operations advertise the optional `idempotencyKey` input;
read actions do not expose it. Image uploads instead require `clientUploadId`
and identical metadata/content on retry; cancellation repeats against the same ID.
Test lost-response retries for create, import, XP awards, and turn advancement.
Use existing revision/turn checks; any added precondition must be shared by REST
and MCP. Never silently retry a conflict with freshly fetched values. Return a
clear result for partial/bulk failures consistent with the underlying operation.

## Operation execution and parity evidence

`src/server/mcp/operationManifest.ts` is the exact mapping for every OpenAPI
method/path. It exposes 51 player-domain tools covering 106 exact operations and gives each excluded
infrastructure operation its own reason. `docs/mcp-tools.json` is the generated
catalog; `mcp:check` fails on route, mapping, name, scope, annotation, or schema
drift. Tool schemas come from the OpenAPI routes and responses are also checked
against the original Zod response schemas retained by the registry.
The catalog check and emit commands build their metadata with test configuration
and `ENVIRONMENT=test`, so application maintenance jobs do not start or keep
these commands alive after generation.

REST and MCP execute the same Hono/OpenAPI handler graph through the in-process
executor. A private Request object-identity capability supplies the validated
actor; no external header can forge it, and OAuth bearer tokens are rejected by
`/api/v1/*`. The ambient context supplies OAuth client and grant IDs to
`withAudit`, so history distinguishes direct edits from `Player via Client`.
Except for staged media uploads, mutation idempotency wraps the shared handler in an outer transaction, persists
its response for 24 hours, and rejects key reuse with changed input or authority.
After a successful non-GET response passes the canonical OpenAPI and original
Zod validators, the MCP adapter projects it to the compact mutation
acknowledgement. Failed operations retain their complete error body so an agent
can correct the call. The acknowledgement is the structured result; the text
result contains only a status pointer. Agents explicitly re-read when they need
refreshed state.

## Context and transfer efficiency

Collection reads accept bounded filters without changing their array/object
response shapes. Character, campaign, and encounter lists accept
case-insensitive `search`, `limit`, and `offset`; adventure-log reads apply the
same controls to visible entry title/body/location text; invitations and
notifications accept `limit` and `offset`. History feeds retain their existing
revision-cursor pagination.
Campaign-library reads additionally accept a `section`; unselected sections are
returned as empty arrays, while `search`, `limit`, and `offset` narrow the chosen
section. Agents should list/search first and request broad character or library
detail only when required.

Non-development `/mcp` JSON responses use gzip compression when the client
advertises it. Vite's development adapter remains uncompressed. This improves
discovery transfer and startup latency but does not
claim to reduce model tokens. Catalog order remains deterministic for client and
prompt-cache stability. Scope filtering also applies within typed task tools: read-only delegates see
only read actions, schemas, descriptions and hints. The server does not hide
authorized operations behind a catch-all executor or a non-standard profile.

Successful read payloads likewise appear only in `structuredContent`, avoiding
the former JSON-in-text duplicate. This intentionally relies on structured-output
capable MCP clients; error text remains self-contained for diagnosis.

The existing trait/skill library create/update tools accept ordered `effects`,
including weapon attack, Parry, Block, damage and Accuracy targets. Their
OpenAPI-derived schemas describe flat/per-level scaling, target-specific fields,
conditional groups and exact selectors. Library declarations accept portable
weapon-name, governing-skill/specialty and library-item selectors. Character trait
create/update tools additionally accept `customEffects` (up to 50 declarations),
including exact `inventory_item` selectors. Updating with `customEffects: []`
clears those owned effects. Character detail returns the declarations and resolved
effects, including matched inventory IDs and zero/one/multiple-match diagnostics,
subject to the normal share gate. The shared Zod handler enforces cross-field
rules that JSON Schema alone cannot express: library effects cannot bind a
character inventory ID, weapon targets require a selector, and Parry/Block cannot
select an attack mode.

Library skill create/update tools expose the same specialization policies as the
REST API: non-specialized, required/optional free-form, and required/optional
catalog options with per-specialty description, prerequisite, and default
overrides. Character skill creates and patches enforce the selected library
policy through the shared REST/sync handler.
That handler canonicalizes catalog names and materializes per-specialty defaults
and generated notes, so agents do not need to reconstruct the UI copy behavior.
The same generated tools expose library `techLevelPolicy`, nested
`prerequisiteRules`, natural-name groups/tags, conditional default declarations,
and `campaign.skillPrerequisitePolicy`. Because MCP executes the raw OpenAPI
handler, required-TL and block/warn enforcement is identical to REST and sync.

Library export returns YAML v14 as typed text, retaining effect order, scaling,
conditions and mode names. Library-item selectors export their portable name
without the campaign-local library UUID. Import accepts the existing v1–v12
formats and preserves shared merge/replace and campaign-settings options. No
extra tools or scopes are required for effects authoring. The manifest links
these operations to the focused `effects-authoring-parity` fixture, which checks
REST/MCP results, selector/schema coverage, YAML round trips, mutation retries,
OAuth audit provenance, ownership/privacy and field-refinement errors.

## Client registration and operations

Standards-compatible MCP clients that support Streamable HTTP, OAuth discovery,
authorization code, PKCE S256, and bearer protected resources need only the
`/mcp` URL. Authorization-server discovery advertises both
`client_id_metadata_document_supported: true` and `/oauth/register`:

- ChatGPT can identify itself with its HTTPS Client ID Metadata Document. GPC
  fetches and validates that document on first authorization and caches the
  resulting public-client registration for at most one hour. The SSRF-safe
  fetch connects directly to a validated public DNS address while retaining
  the original hostname for TLS certificate verification and HTTP virtual
  hosting; it does not perform a second, rebinding-prone lookup.
- Claude and other DCR clients can register their callback automatically at
  `/oauth/register`. GPC creates an opaque public client ID and never issues a
  client secret.

`OAUTH_CLIENTS` remains an optional compatibility and operator-control mechanism,
not a setup requirement. Its JSON shape is `{clientId, name, redirectUris,
scopes}`. Configuration is authoritative only for entries registered by that
mechanism: removing one disables it and its tokens on the next OAuth/token/MCP
check, and narrowing its scopes invalidates older broader tokens. It never
disables CIMD or DCR registrations. Redirect URIs use HTTPS or HTTP on a
loopback host and reject credentials or fragments. They match exactly except
that a portless registered loopback callback accepts the native client's
ephemeral local-listener port, as required for installed-app OAuth. The exact
requested callback is still bound into the authorization code and must be
repeated at token exchange. Public clients use authorization code with PKCE S256
and no secret. Direct browser clients must also list their origin in
`CORS_ORIGINS`; server-hosted ChatGPT and Claude OAuth requests do not require a
CORS entry.

Client-specific plugin packages and private registered-app mappings are local
artifacts, excluded from source control and Docker build contexts. Configure
clients with the target instance's `/mcp` URL: `https://gurps.abundant.zip/mcp`
for the hosted production instance, or `https://gurps-dev.abundant.zip/mcp`
for development testing. Each user signs in and consents with their own GPC account.

Client setup uses the `/mcp` resource URL. Discovery supplies the authorization
server and endpoints. The client sends its registered ID, exact callback,
43-character S256 challenge, requested scopes, opaque state, and canonical
resource to `/oauth/authorize`; consent returns the one-time code to that
callback. The client exchanges it with the original verifier and resource at
`/oauth/token`, then uses the `gpco_` access token only at `/mcp`.

`APP_HOSTNAME` is the bare public hostname used to derive the canonical origin
for discovery and audience checks through `config.ts`'s `appUrl()`. Production
requires it and derives HTTPS on port 443; development/test defaults to
`localhost` and derives HTTP with `PORT`. Schemes, ports, paths, credentials,
queries, and fragments are rejected in this setting. Proxies route `/mcp`, `/oauth/*`,
and `/.well-known/*` without caching. The PWA navigation fallback excludes
these protocol paths. The mutable service-worker entrypoints and HTML shells
also carry `no-store` origin/CDN headers so an edge-cached old worker cannot
shadow a newly added protocol route with the React SPA. Access tokens live for
15 minutes, refresh tokens 30 days, authorization codes five minutes, and
idempotency results 24 hours. Backups include OAuth and idempotency tables with
the rest of Postgres;
token plaintext cannot be recovered. Expired secret rows are pruned while
revoked grants remain available for Settings/history provenance. Opaque secrets
are stored only as hashes. A lost refresh response retries
with the same `request_id` for 30 seconds; a different replay revokes the family.

## Delivery and acceptance

The implementation is released only with evidence for these gates:

1. Extract shared operations, define exact coverage/exclusions and scopes, and
   establish parity CI against the current raw API.
2. Add OAuth migrations, metadata, CIMD/DCR registration, browser
   consent/connected-app UI and token validation. Exercise metadata SSRF bounds,
   DCR-to-token flow, code expiry/reuse, PKCE, wrong redirect/client/resource,
   consent denial, insufficient scope, refresh replay and immediate revocation.
3. Mount the MCP transport and cover every included operation. Validate production
   and development paths, proxy headers, non-HTML discovery/error responses,
   process restart, initialization and tool discovery with a real MCP client.
4. Run Postgres integration parity tests, an end-to-end browser authorization →
   agent read/write → player history/cursor observation → revoke flow, and a
   concurrent offline-browser edit case with missed WS delivery. Run the normal
   `check`, client tests for consent/Settings changes, and relevant Playwright tests.
   PR authors run the browser coverage locally; the named-image promotion
   workflow reruns the complete Chromium flow against the selected source image
   and blocks every release tag and alias until it passes.
5. Document supported clients, their registration flow, canonical public origin,
   proxy/TLS setup, scopes, credential expiry/revocation and backup/cleanup needs.
   Publish a completed operation coverage report. Update overview, architecture,
   sync, sharing, history and JSON specs to describe the implemented state.

The checked-in evidence includes the generated 51-tool catalog, per-operation
successful REST/MCP differential and scope-denial fixtures, OAuth boundary and
transport tests, transaction/idempotency regressions, client consent/Settings
tests, and the Playwright browser authorization acceptance flow.
Production executor integration coverage also exercises the real `/auth/me`
handler and mounted `/mcp` endpoint with a persisted OAuth user, grant and token.
It checks successful `get_current_user` and `list_campaigns` response validation,
absence of internal redirects, continued external HTTP redirects, and rejection
of external requests that lack trusted execution authority.

## Active effects and skill procedures

The `library_active_effect` tool includes `create`, `update`, and `delete` actions. Character
active effects and condition groups use the existing character write tools. Skill
procedure schemas and owned snapshots are exposed by the existing library/skill
operations. All share REST validation and authorization; the per-operation parity
matrix includes active-effect CRUD and the generated catalogs reflect YAML v11.


## Library v12 parity

Source and modifier CRUD have exact operation-manifest entries and generated
OpenAPI/MCP schemas. Aggregate reads include common source/completeness/evidence
metadata and authoritative calculation rules. Source-qualified rule references,
normalized weapon modes and pricing snapshots are shared REST/MCP/sync shapes.
All owner-only library writes and member reads retain the standard handler,
scope, audit and sync guards. New operations must satisfy the existing raw-API
parity and delegated OAuth release gates; no private importer-only write path is
introduced. See [library-calculation-rules.md](library-calculation-rules.md).

## Structured weapon Range parity

Inventory and campaign-library item `weaponData` use the shared `rangedRange`
schema at REST, sync, MCP and YAML v14 boundaries. Each attack mode may carry
a fixed-yard Max and optional 1/2D/minimum, or an ST multiplier with an explicit
wielder/weapon strength source. Legacy notation is retained for repair after
migration; the roll path does not parse it. MCP tool schemas and the checked-in catalog are generated from the
same route schemas; old free-text Range writes are rejected.

## Image upload task tool

One `media` tool exposes four explicit actions: `capabilities` and `status`
require `gpc:read`; `upload` and `cancel` require `gpc:write`. The 51-tool catalog
maps 106 player operations; each action retains an exact method/path mapping,
canonical request/response validators and REST parity coverage. An unknown
action, a mixed-action payload or insufficient scope cannot dispatch a request.

`upload` submits metadata and canonical base64 content together, with a stable
`clientUploadId` binding retries to the same uploader, target, digest and size.
It returns the ordinary compact acknowledgement containing the server asset ID.
Normal character/campaign update tools attach that ID as `portraitAssetId` or
`coverAssetId`. `status` returns the manifest; `status` and `cancel` accept either
an asset ID or `query.lookup: "clientUploadId"` for the caller’s own retry ID,
including when an upload response was lost or processing is still in flight.
There is no public initialization-only or separate content-submission operation.
Media uses `clientUploadId`, not the generic `idempotencyKey` argument.

Binary upload is exactly excluded because the JSON form is equivalent; public
image delivery and admin moderation remain exact transport/admin exclusions.
Media owns short audited reservations and processing leases before storage I/O,
avoiding the generic response journal’s outer transaction and duplicate body
buffering. Delegated execution retains trusted authority and audit context.
The authenticated MCP envelope remains bounded at 14 MiB to fit a 10 MiB base64
input; four in-flight requests per process bound aggregate memory. Full lifecycle:
[media-uploads.md](media-uploads.md).

## Reusable Lantern Coast acceptance dataset

`src/server/db/seeds/lanternCoastContent.ts` is the shared content recipe for the
standard REST seed and the connector bridge (`scripts/seed-lantern-mcp.ts`).
`lanternCoastMcp.ts` resolves exact manifest operations and consumes normal compact
mutation acknowledgements; encounter creation re-reads through MCP to obtain
combatant IDs. Every domain write goes through an existing tool/handler.

`lanternCoastMcp.integration.test.ts` initializes the real `/mcp` HTTP route with
a persisted OAuth client, grant and access token, then creates the whole campaign:
four fictional sources, all eleven library categories, six complete characters,
owned pricing and mechanics, nested/enhanced inventory, pools and active effects,
shared/private logs with XP awards, and an encounter with hidden NPC and effect.
The REST reference collects private notes through each author’s authorized feed,
so GM privacy remains intact. It compares the complete graph with the standard REST seed, normalizing generated
IDs/revisions/timestamps and the permitted ownership difference, and asserts
OAuth audit provenance and no added users. The test respects the production MCP
rate budget. Normal commits are cleaned up only within the test's own graph.
The standard script creates six demo player accounts; MCP uses one existing user
because account creation is deliberately outside the delegated tool surface.

The operational `/api/v1/readyz` probe is an explicit service-infrastructure
exclusion alongside `/api/v1/healthz`; both report the running release.

Adventure-log create/edit actions accept nullable `characterId`: selecting an owned
character makes the entry private; null attaches to Campaign and shares it. Attachment
ownership, legacy-private preservation, and history privacy use the shared REST handler.
