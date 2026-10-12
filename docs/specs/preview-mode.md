# Design Spec: Read-only Guest Preview

Visitors who have not registered can open **Try without an account** on the
landing page and explore a complete sample campaign, The Lantern Coast, with its
party, character sheets, library, adventure log and encounter. The preview is
read-only: a guest can never change data, settings or credentials, including
through features added later.

The feature is opt-in per instance with `PREVIEW_MODE_ENABLED=true` (default
`false`; development Compose defaults it on).

## User experience

- `LandingPage` asks `GET /api/v1/auth/guest` whether the preview is available
  and shows **Try without an account** beside **Create your account** only when
  it is. The former scroll-only **Take a look** action is gone.
- `/preview` (`features/preview/PreviewEntryPage.tsx`) starts a guest session and
  opens the preview campaign. A visitor who is already signed in goes home with
  their own session intact. Failures name the reason (unavailable, rate limited,
  unreachable) and offer **Try again**.
- A guest uses the normal campaign, character, library, log, history and
  encounter pages through the ordinary local-first read path. As a campaign
  member who does not own any character, they get the existing read-only views.
- A banner at the top of every page reads "Read-only preview" with **Create your
  account** and **Exit preview**. Home redirects to the preview campaign.
  Notifications, Settings and the signed-in user menu are absent; the account
  menu offers About and **Exit preview** instead of Logout.
- Leaving (either button) wipes the device's preview data with the same purge
  as sign-out. **Create your account** then opens registration.
- The light/dark switch works but stays on the device; guests have no account
  preferences to sync.

## Server

### Guest token

`POST /api/v1/auth/guest` (rate limited per source IP by
`AUTH_RATE_LIMIT_GUEST_MAX`) returns `{ accessToken, accessTokenExpiresIn,
campaignId }`. The token is a JWT with `type: "guest"`, valid for two hours,
and has no refresh token. When it expires the client requests a new one.
`resolveAuthHeader` accepts a guest token only while preview mode is enabled,
only for the account whose `system_role` is `preview_guest`, and only at that
account's current `auth_version`. Advancing that version revokes every
outstanding guest token. Guests authenticate as `authMethod: 'guest'`, so every
`requireJwt`/`requireActiveJwt` route (password, passkeys, API keys,
preferences, OAuth consent) also refuses them.

### Defense layers

Any one of these on its own stops a guest write:

1. **Allow-list gate** (`services/preview/guestAccess.ts`). Mounted first on
   every path in `createApp`, before every router, transport and middleware. A
   request presenting a guest token as a bearer header or as the WebSocket
   `token` query parameter may reach only the exact operations in
   `GUEST_ALLOWED_OPERATIONS`: health checks, `/auth/me`, campaign, character,
   library, adventure-log, history, encounter, invitation and notification
   reads, media capabilities, and `POST /sync/cursor` (a read that sends its
   cursors as a body). Everything else, including `/mcp`, `/oauth/*`, admin, media uploads and the
   WebSocket, answers `403 {"error":"guest_read_only"}`. A new route is
   blocked for guests until someone deliberately adds it to the list.
2. **Authentication method.** Guest sessions are never `jwt`, `api_key` or
   `oauth`, so interactive-account and delegation checks reject them.
3. **Audit layer.** The gate marks the request context; `withAudit` throws
   `GuestWriteForbiddenError` (mapped to the same 403) for any audited write
   attempted while handling a guest request.
4. **Database guard** (migration 0072). `guard_preview_campaign_trg` on the
   campaign, membership, invitation, character and character-child, encounter,
   adventure-log and every campaign-library table rejects any insert, update or
   delete touching the preview campaign while an application actor
   (`app.actor_id`) is set. This also protects the campaign from its owner, admin
   tools and bugs (`403 preview_read_only`). Only provisioning, which sets the
   transaction-local `app.preview_refresh`, passes. Schema migrations and
   actor-less maintenance can still repair preview rows.
5. **Credential-less system accounts.** The campaign is owned by
   `game-master@preview.invalid` and its characters by one fixture account per
   party member (`system_role = 'preview_fixture'`). Guests share
   `guest@preview.invalid` (`preview_guest`). Each has an unusable password
   hash and a reserved `.invalid` address: login treats them as unknown,
   recovery never issues a token or email, and registration refuses the
   `preview.invalid` domain so no one can claim a system address first.
   `guard_system_account_access_trg` refuses any membership, invitation or
   ownership of another campaign for a system account. Otherwise a campaign
   admin could add the shared guest and expose a private campaign to every
   anonymous visitor. Member and invitation lookups also skip system accounts.
6. **Coverage test.** `preview.integration.test.ts` sends a guest token to every
   OpenAPI operation, plus `/mcp`, the WebSocket and credential routes. It fails
   when an allow-list entry is stale, is not a read, or when any other operation
   does not answer `guest_read_only`. It also covers the audit and database
   layers, revocation, the disabled state and system-account isolation.

### Provisioning

`services/preview/provision.ts` builds the campaign from the Lantern Coast
recipe (`populateLanternCoast` and `bootstrap/lantern_coast.yaml`) through the
normal in-process API, as the fixture accounts, in one advisory-locked
transaction. Optional artwork in `bootstrap/lantern_coast_art/` is uploaded when
media storage is enabled. The singleton `preview_campaign` table records the
campaign, the guest account and `PREVIEW_CONTENT_VERSION`. Servers with preview
mode on provision at startup in the background, retrying every five minutes
after a failure. An up-to-date campaign is left alone. A new content version
deletes the old campaign and fixture characters and builds a fresh one;
guest devices then prune the old rows through the normal cursor access sets.
`bun run db:seed:preview [--force]` runs the same provisioning by hand, and
`bun run db:seed` includes it when preview mode is enabled. The runtime image
copies `bootstrap/lantern_coast.yaml` and the art directory for this purpose.

## Client

- `lib/guestSession.ts` owns the session. The token store records
  `guest: { campaignId }` with an empty refresh token. The shared API client
  renews an expired guest token with `POST /auth/guest`; a `404` ends the
  session.
- `apiFetch` refuses every authenticated non-GET request except
  `POST /sync/cursor` before it reaches the network. `enqueueFieldPatch(es)`,
  `enqueueEntityPatch`, `enqueueCreate`, `enqueueDelete(s)`, `enqueueImage` and
  `removeImage` throw `GuestReadOnlyError`, so nothing is written to Dexie or
  queued even if a write control is reachable.
- The WebSocket subscriber does not connect for guest sessions; the periodic
  cursor pull keeps the unchanging preview current.

## Files

| Area | Files |
|---|---|
| Server | `services/preview/guestAccess.ts`, `services/preview/provision.ts`, `routes/preview.ts`, `auth/jwt.ts` (guest token), `auth/session.ts`, `db/auditContext.ts`, migration `0072_preview_mode.sql`, `db/seeds/preview.ts`, `db/seeds/bootstrapFiles.ts`, `db/seeds/seedTransport.ts` |
| Client | `lib/guestSession.ts`, `lib/api.ts`, `lib/tokenStore.ts`, `features/preview/PreviewEntryPage.tsx`, `features/home/LandingPage.tsx`, `App.tsx` |
| Tests | `services/preview/preview.integration.test.ts`, client unit tests beside each client file, `tests/e2e/guest-preview.spec.ts` |
