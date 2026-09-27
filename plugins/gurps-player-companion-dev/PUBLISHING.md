# Production publishing readiness

This package is intentionally **development-only**. Do not submit it to the
public Plugins Directory.

## Production package invariants

- Create a separate production package identity, normally
  `gurps-player-companion`, and point its MCP server at
  `https://gurps.abundant.zip/mcp` from its first public submission.
- Do not publish the dev origin and plan to switch it later. OpenAI treats an
  MCP server origin (scheme, hostname, and port) as immutable for a published
  plugin; changing from `gurps-dev.abundant.zip` to `gurps.abundant.zip`
  requires a new plugin and review.
- Keep the dev display name and `-dev` package identity out of production
  metadata, screenshots, prompts, and reviewer instructions.
- Register a separate production Apps SDK app and use its own `asdk_app_*` ID;
  never reuse the private dev mapping from this package.
- Keep production OAuth discovery, consent, tokens, data, secrets, and demo
  accounts isolated from the dev deployment.

## Publication blockers to complete

- Verify the intended individual or business publisher in the OpenAI Platform
  Dashboard and confirm the submitting project has `api.apps.read` and
  `api.apps.write`.
- Publish a privacy policy on the production domain. It must cover the user and
  campaign data exposed by tools, purposes, recipients, retention, controls,
  authentication/audit metadata, and deletion/revocation behavior.
- Publish accurate support contact details. Decide whether to publish terms of
  service and include that URL if used.
- Choose the verified publisher/developer name; replace the contributor label
  in production metadata with that exact identity.
- Prepare a stable reviewer demo account with representative characters,
  campaigns, library content, logs, encounters, invitations, and
  notifications. It must use password login without MFA or another inaccessible
  verification step.
- Prepare the portal listing: final name, production logo, concise description,
  company/site and privacy URLs, countries, localization, annotation
  justifications, and exact test prompts with expected results. Do not submit
  screenshots unless a ChatGPT UI is added.
- Run the complete repository CI sequence and the required MCP OAuth Playwright
  test against both development and production builds. Then test direct,
  indirect, edge-case, destructive, permission-denied, revoked-access, and
  out-of-scope requests in ChatGPT developer mode.

## Review risks to audit before submission

- Re-scan the live production endpoint and verify every tool's `readOnlyHint`,
  `destructiveHint`, and `openWorldHint`. Private account/campaign operations
  must remain closed-world; only actions that reach arbitrary external parties
  should be open-world.
- Confirm read tools do not expose the mutation-only `idempotencyKey` input.
- Audit successful read payloads for data minimization. In particular, justify
  any account IDs, actor IDs, timestamps, email addresses, audit/history data,
  hidden encounter data, and other user-related fields; remove fields that are
  not necessary for the documented tool purpose.
- Confirm errors and diagnostic logs never return credentials, tokens, request
  IDs, trace data, or internal infrastructure details.
- Keep the live metadata backward-compatible while a submitted version is in
  review. Roll back a deployment that breaks the scanned contract rather than
  waiting for a new review.
