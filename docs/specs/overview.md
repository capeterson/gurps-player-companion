# Design Spec: Application Overview & Orientation

> **Read this first.** This is the entry point for the design-spec set. It
> describes the current state of GURPS Player Companion — what it does for
> users, how the code is laid out, and where to go for the deep dives. It is
> written so a fresh session (human or LLM) can get oriented **without**
> scanning the whole tree first.

## What this is

GURPS Player Companion is a **local-first Progressive Web App** for running
GURPS 4e player characters, campaigns, shared campaign content, and delegated
agent access. It is a single Bun process that serves the HTTP API, OAuth and
MCP, a WebSocket push channel, the OpenAPI document, and the React PWA client —
all on one origin, one port.

The official hosted instance is [gurps.abundant.zip](https://gurps.abundant.zip).
The root [README](../../README.md) is the player-facing introduction, with
current desktop/mobile screenshots and self-hosting/environment documentation
at the end. `APP_HOSTNAME` is the bare public hostname; the server derives HTTPS
in production and HTTP with `PORT` in development/test for all public app URLs.
Screenshot provenance and refresh notes live in
[screenshots/README.md](../screenshots/README.md).

The production image ships only production dependencies. The HTTP app denies
framing, caches content-hashed assets immutably, and keeps HTML and service-worker
entrypoints uncached so releases remain discoverable (see
[architecture.md](architecture.md)).

A first download that fails displays its reason and a retry action; an ended session
before that download completes offers sign-in instead of an indefinite loading state.

The defining product promise is **edits never disappear**. Every character
mutation is written to IndexedDB and journaled to a durable outbox *before*
anything touches the network, so a player can keep editing a stale tab with no
connectivity indefinitely and converge later. See
[offline-sync.md](offline-sync.md).

When an older unsaved library addition lacks enough evidence to recover its
campaign-change order during an app upgrade, sync retains it and asks the user
to confirm the original or destination campaign in the sync log before replay.

## Document map

| Doc | Covers |
|---|---|
| [active-effects-skill-procedures.md](active-effects-skill-procedures.md) | Campaign active effects, owned character instances, contextual skill modifiers, actions and level benefits. |
| **overview.md** (this file) | Product surface, feature catalog, codebase map, orientation notes. |
| [architecture.md](architecture.md) | Stack, process model, request lifecycle, data model, auth, testing, deploy. |
| [interaction-design.md](interaction-design.md) | Character-sheet summary tables, disclosures, draft lifetime, responsive layout, and shared UI primitives. |
| [offline-sync.md](offline-sync.md) | The local-first / outbox / cursor / WebSocket system in depth. |
| [library-calculation-rules.md](library-calculation-rules.md) | Declarative pricing, source editions, completeness, snapshots, modifiers and item modes. |
| [campaign-content-sharing.md](campaign-content-sharing.md) | Campaigns, roles, invitations, the share gate / minimal view, and the YAML library. |
| [media-uploads.md](media-uploads.md) | Portraits, campaign covers, S3-compatible storage, public immutable caching and queued offline uploads. |
| [history-tracking.md](history-tracking.md) | The append-only audit-log subsystem (character + campaign history). |
| [mcp-agent-access.md](mcp-agent-access.md) | Same-process MCP/OAuth delegation, player API coverage, and parity gates. |
| [notifications.md](notifications.md) | Notification recipients, account settings, email policy, desktop opt-in and durable delivery. |
| [json-fields.md](json-fields.md) | Catalog of every JSON/JSONB field, its Zod schema, and where it's validated. |

The **rules of engagement** (invariants you must not break, and the multi-site
checklists for extending sync/history) live in
[`AGENTS.md`](../../AGENTS.md), not here. These specs describe *what exists*;
`AGENTS.md` prescribes *what you must keep true*. Keep the two in sync — see
"Maintaining these docs" below.

---

## Portraits and campaign covers

With object storage configured in production (or automatic local storage in
development/test), character editors can add portraits and campaign owners can
add covers. The Overview Identity panel shows a portrait or neutral silhouette;
clicking it opens a portrait editor with upload/removal controls and image help.
Campaign cover controls and help live in the Campaign section of the centered
settings dialog, alongside separate Rules and Members sections. Workspace headers
only display covers. Selections and replacements queue locally,
including offline, and sync independently of text edits. At heights up to 500px,
the settings dialog keeps a compact label, Close button, section tabs and Save/Cancel
visible while the full campaign name and reduced cover preview scroll with the
upload controls. Portraits also appear
in minimal campaign views. Images are sanitized into two WebP sizes and served
through public, unguessable, immutable URLs; browser caches may retain them after
logout or removal. See [media-uploads.md](media-uploads.md) for access, limits and
recovery, and [../media-storage.md](../media-storage.md) for Garage/Unraid setup.

The subsystem lives in `src/server/services/media/`, `src/server/routes/media.ts`,
`src/shared/schemas/media.ts`, `src/client/components/MediaImage.tsx`, and
`src/client/sync/mediaUploads.ts` / `mediaRecovery.ts`. `/admin/media` is in the
separate admin entry. `docker-compose.media.yml` adds optional Garage storage.
Development/CI can use `services/media/localStorage.ts` without Garage; production
rejects the filesystem backend. See the storage guide for environment selection.

## Delegated agent access

[MCP agent access](mcp-agent-access.md) provides remote Streamable HTTP at `/mcp`
and OAuth delegation on the same app server. Settings lists connected clients
and confirms destructive revocation before invalidating their grants, while
`/oauth/consent` grants plain-language read/write/manage scopes.
If the player's primary sign-in is no longer recent, the authorization flow
returns to an explanatory login screen before rendering any approval controls,
then resumes the complete consent request after login.
Authorization discovery supports ChatGPT-style Client ID Metadata Documents and
Claude-compatible Dynamic Client Registration, so supported public clients need
no per-client server configuration or shared secret.
The 51 tools use server-local names such as `list_characters` and `character_skill`,
without an application prefix. Related writes share entity tools with explicit
actions; reads remain separate. Clients refresh tool discovery after the rename.
Every player-domain raw API operation has an exact tool/action mapping; typed
media actions share one tool with action-specific schemas and permissions. Security, administration,
replication, and transport endpoints have exact checked-in exclusions. MCP commits
use the same route graph, validation, authorization, audit, revisions, and
invalidation behavior as REST. Successful mutations return a compact
acknowledgement rather than echoing complete character/campaign resources; errors
retain their actionable body and agents re-read when refreshed state is needed.
Successful result payloads are emitted only as structured content, with concise
status text instead of a duplicate JSON copy.
Settings → **Experimental Features** includes an account-wide **MCP UI** toggle,
off by default. Its runtime gate hides UI metadata/resources when disabled;
ordinary tools keep working, and clients refresh tool discovery after changes.
Opted-in MCP Apps clients can render `get_character` as an embedded read-only character
sheet with Overview, Traits, Skills, Magic, and Inventory sections. It shares the
web app's presentation components and theme. Refresh rechecks access through the
same tool; limited viewers receive public identity only. The generic UI resource
ships separately from the PWA in `dist/mcp-ui/character.html`. Focused
`get_character_inventory_item` and `get_campaign_library_skill` reads render one
item/container subtree or campaign skill definition as a compact card, without
sheet navigation or unrelated collections. They share authoritative calculations,
item disclosures, and the library's skill presentation, while enforcing the same
share gate and restricted-entry rules.
Character, campaign, encounter, adventure-log, invitation, notification, and
campaign-library reads offer bounded search/limit/offset controls, with library
section selection, so agents can avoid loading unrelated context. History feeds
remain cursor-paginated. Compatible clients also receive compressed MCP responses.
Character, campaign, encounter and adventure-log text filters, plus admin user
and campaign searches, treat `%`, `_` and backslash as literal characters rather
than SQL pattern syntax. These searches remain case-insensitive.

Reusable [GPC workflow skills](../agent-skills.md) cover character advancement,
equipment and packing, campaign-library authoring, session wrap-up, and encounter
preparation. Clients can package these with their connected GPC tools. Synthetic
behavioral evals check the skills against the emitted tool schemas; they do not
change server permissions or install a client plugin automatically.

## User-facing features

### Library selection

Library autocomplete menus render above sheet navigation, outside their form's
stacking context (inside the enclosing native dialog when applicable). They stay
within the visual viewport, follow scrolling/resizing, and close when their
containing form is folded away.

### Table column filters

Every application data table uses the shared `components/ui/Table.tsx` framework.
Right-click a data column heading (or use Alt-click / Shift+F10 on its button)
to open a searchable checklist of exact values. Plain, unsorted headings also
open the checklist on click; existing sorting buttons retain click-to-sort.
Selected values within one column match any selection; filters across columns
combine. Headers mark active filters, and a table-level **Clear all filters**
control stays available even when no rows match. Clearing a column restores all
its values. Options include the source rows supplied by the table even when search
or folding hides them; paginated admin tables filter the currently loaded page.
Grouped summaries and their editors hide together without unmounting drafts.
Library filters reveal folded groups, and inventory filters open nested contents while active; weapon filters keep a weapon's
attack modes together. Search, sorting and folds still apply independently.

Filter selections are remembered only in device-local `localStorage`
(`gpc:table-filters:v1:*`), scoped by character/campaign/table identity, and cleared
on logout. No API, outbox or server preference is written. Storage failures
leave filtering usable and show a notice. The framework defaults to filtering on;
callers may set `filterable={false}` on `Table` or `TableHeader` (including
`SortableHeader`). Action and reorder columns remain plain headers without filters.
The portaled menu uses shared viewport collision handling, dynamic viewport size
limits, internal scrolling, Escape/outside dismissal and keyboard focus management.

### Public introduction

Unauthenticated visitors to `/` see `LandingPage`: a brief GPC overview, registration and sign-in links, an offline-use explanation, and real application screenshots. Its headline scales across responsive breakpoints so the two phrases remain on their intended lines at tablet and desktop widths. Authenticated visitors retain the recent-character dashboard. Protected deep links still return to their destination after login. The landing page and root README use the same canonical files in `public/screenshots/`; capture instructions remain in `docs/screenshots/README.md`.

### Accounts & authentication
- Email/password registration and login (`/register`, `/login`).
- **Passkeys / WebAuthn** as an optional second credential — register, list,
  and sign in with a passkey (`/auth/passkeys/*`). Ceremonies are verified by
  `@simplewebauthn/server` (origin/RP, challenge, type, flags, COSE algorithm,
  signature, and counter), not by an application-owned binary parser.
- **Password reset** by emailed token (`/forgot-password` → `/reset-password`). An invalid or expired token offers a direct path to request another link.
- **Public-auth rate limits**: durable Postgres counters bound registration by
  source IP and password login by source IP plus a normalized account budget
  consumed only by failed logins across source IPs. Recovery and passkey requests
  retain source and (when supplied) account budgets. Throttled requests return
  JSON `429` with `Retry-After`.
- **API keys** for programmatic access, created and revoked from Settings.
- JWT access tokens + rotating refresh tokens. Password changes and recovery
  advance a server-checked authentication version so every older JWT is rejected;
  recovery also revokes API keys and removes passkeys. Creating a new passkey or
  API key requires a primary sign-in within the last ten minutes. Refresh
  replacement is transactional and supports a bounded idempotent retry after a
  lost response. Nightly maintenance deletes expired refresh-token rows;
  unexpired revoked ancestors remain available for retry and replay detection.
- **Account suspension**: a suspended user is bounced to `/suspended`; admins
  can suspend / unsuspend / schedule purge.
- **Unsaved changes at sign-out**: logout and password change check queued
  edits, unsaved images, and pending theme preferences before ending the session.
  A confirmation offers **Keep editing** or explicit discard; cancel preserves
  the signed-in session and local work. Confirmed sign-out still purges all
  account data from this device.

### Character sheet (the core surface)
Route `/characters/:id`. Sectioned sheet
(`src/client/features/characters/CharacterSheetPage.tsx`), destinations:
**Overview, Combat, Traits, Skills, Magic, Inventory, History**.
Overview is the default section when opening a character. Magic is hidden on a read-only
view of a non-magical character; owners always have it available to add magic.
Inventory items, traits, skills, and spells have stable ID-based URL anchors
(`#inventory-<id>`, `#trait-<id>`, `#skill-<id>`, `#spell-<id>`). Opening a
character URL with one of these hashes selects the matching section, opens its
panel, and scrolls to the highlighted entry. Notification links use `#history`
  to select and focus the History section. Inventory links reveal nested
items inside closed containers. Weapon names in Attacks, armor layers and DB
sources in Incoming attack, and equipment named in active defenses
link to their inventory entries without a page reload. Incoming attack lists innate
DR by contributing source name and source ID, combining declarations from the same
source. Trait contributions link to the owned trait row; the target is revealed
through search and column filters without automatically opening its editor.

First-time users without characters see a **Create your first character** action and
campaign-invitation guidance instead of returning-user copy. Character creation trims
names, prevents duplicate pending submits, and preserves a new draft typed while an
earlier creation finishes.

The home page's recent characters, `/characters` listing, campaign overview
roster, and GM dashboard use the shared `CharacterCard` presentation. Each card
shows its portrait/name as a sheet link, the synced campaign name as a separate
campaign link when assigned, and one ST/DX/IQ/HT summary. All read from the local
mirror. Minimal campaign viewers see identity without attributes; masked rows
awaiting full rehydration also hide the attribute line. GM cards use effective
attributes and append live pools, secondary stats, conditions and skill lookup;
unavailable mechanics hide their numbers. GM name links open the sheet in a new tab.

- **Sheet navigation and icons.** A floating bottom daisyUI dock at widths of
  768px and above replaces the sheet tab bar, with etched outline icons, labels,
  entry counts, and a violet active marker. Below 768px a bottom-right FAB shows
  the active section icon and opens a balanced two-ring flower speed dial with
  48px icon buttons for all available destinations. Each petal has a permanent label below
  its icon and a separate entry-count badge where applicable, with no tooltip.
  The wider rings keep labels apart and inside a 320px viewport;
  selecting a section closes the flower and focuses/scrolls its visible heading.
  Escape, outside click, and leaving the navigation close it. Closed petals are
  hidden from keyboard and assistive technology. Safe-area spacing and bottom
  content padding protect controls from the dock/FAB. The closed FAB stays below
  header popovers so pool labels and explanations remain readable; the open
  flower and its backdrop rise above the header. Navigation yields to modal
  dialogs. Reduced motion disables the flower entrance and sync rotation.
  `SheetNavigation.tsx` owns this responsive control. Overview appears first in
  the dock and mobile navigation and Overview is the initial view.
  `AppIcon.tsx` standardizes
  Lucide icons at a 1.75 stroke weight: swords, portrait, fingerprint, target,
  book, backpack and history for the sheet, with matching map, bell,
  sun/moon, edit, shield, and six-sided die icons across related controls.
- **Narrow-screen navigation.** The full character sheet uses a compact
  character/app menu below 1280px, with the full character name inside the menu.
  Below 480px the trigger is icon-only; the name also remains in the sheet heading.
  On other pages, Character and Campaign navigation groups wrap within the
  available header width; long breadcrumbs remain truncated and the campaign
  dropdown stays attached to its group.
- **Compact combat view and folding.** Combat uses a smaller identity header.
  Other editable identity names use smaller display type below 640px so ordinary
  names fit on phones; unusually long names remain scrollable within the input.
  Read-only identity headings wrap long names within the content width.
  The Overview section places the foldable sheet overview (attributes, secondary
  stats, status, ledger, encumbrance and conditional effects) above the Identity
  panel; other destinations do not display it. When folded, it shows effective
  ST/DX/IQ/HT. Attributes, Secondary attributes, and Status stay expanded inside
  it, with one heading each. Point ledger, Encumbrance, and Conditional effects
  fold independently and shrink to their headings without stretching to fill
  neighboring cards. Conditional effects is absent unless the campaign active-effects
  experiment is enabled and condition groups exist. Skills, Traits, Inventory, and main Combat sections have keyboard-accessible
  folding headers. Magic collections instead have plain headings and compact tables. On Combat, Attacks, Incoming attack, and the optional Turn
  tracker fold independently. Incoming attack groups the body map, target/facing
  controls, active defenses, DR, and damage application in one open-by-default
  section. Main section headers use matching outline icons where the
  icon identifies the content. `FoldSection` saves
  open/closed preferences per character/section in device-local `localStorage`
  (`gpc:fold:*`), never the server. Content stays mounted while folded so drafts,
  pending saves, roll state and selections survive folding. Storage failures do
  not prevent folding. The point ledger, defense breakdowns, and the full DR
  details start folded. The armor body map is the single all-location DR overview.
- **Markdown descriptions.** Library traits, skills and spells render sanitized
  CommonMark/GFM descriptions; their spacious add/edit forms (including skill
  specialization description overrides) use the shared formatting toolbar and
  raw-markdown mode. Character skill copied notes have expandable markdown
  descriptions. Trait notes render markdown for readers and offer a markdown
  preview beside the compact source editor for owners. Only safe links retain
  link styling and navigation after sanitization.
- **Overview section's Identity panel.** Name, height, weight, age, **birthdate** (free-form
  text, e.g. "3/7/0402"), campaign assignment, and
  a **Description** field (stored in the existing `appearance` column). No
  per-character "player" field is
  tracked — the character's owner (the authenticated user who created
  it) is the player. **Tech level** is likewise not set per character:
  it's read-only here, sourced from the parent campaign (or an em dash
  when campaignless). Description opens as sanitized markdown with clickable
  links. Owners use its pencil **Edit description** action to open the editor;
  **Done editing description** commits the current draft and returns to the
  rendered view. The editor stays mounted once opened so closing it preserves
  its draft and source/rich mode. Rollbacks flash the description in either mode.
  Description is edited with the same
  WYSIWYG **markdown editor** (`RichTextEditor`/`Markdown`,
  `src/client/components/markdown/`) used by the adventure log, with a
  raw-markdown/source toggle and sanitized rendering. It has no separate
  Notes destination or duplicate editing surface.
- **Campaign assignment confirmation.** Moving or removing a character already in a campaign requires confirmation before enqueueing the local-first campaign patch. The dialog explains that owned library copies remain but live links are detached; rejoining does not reconnect them. First assignment from no campaign and unchanged selections do not prompt. Pending confirmation clears when the displayed character or its campaign changes.
- **Attributes, Secondary & Status cards.** ST/DX/IQ/HT drive HP, FP,
  Will, Per, Basic Speed, Basic Move, Dodge, basic **thrust/swing
  damage** (B16 table, shown as "Thr / Sw"), etc. The **Secondary attributes** card
  surfaces the six secondary stats (HP, Will, Per, FP, Basic Speed, Basic
  Move) with their effective values and per-stat ✦ temp-modifier
  popovers. The **Status** card shows derived combat values not displayed
  elsewhere — Dodge, Basic Lift, and Thr / Sw. Current HP/FP live in the
  persistent **Current Status** controls; user preferences can also show posture,
  maneuver, and conditions there. The sheet's top row no longer duplicates the six secondary
  numbers. Temporary ST/HT boosts
  affect their normal derived values but not maximum HP/FP; only the
  dedicated temporary HP/FP modifiers change those maxima (M37). Basic
  Lift rounds to the nearest whole number once it reaches 10 (B15). All
  GURPS math is pure and shared (`src/shared/domain/`).
- **Point ledger.** Live point totals vs the campaign point target, with
  disadvantage / quirk cap warnings. Warning codes stay stable for API and
  dismissal persistence, while every active and dismissed warning is presented
  with a human-readable label; legacy unknown codes receive a readable fallback.
- **Offline mechanical definitions.** Trait/skill cursor rows carry validated
  `libraryMechanics` declarations with source ID, campaign, revision and explicit
  availability. Both player and GM readers derive from these durable rows, with
  no library HTTP request on their calculation path. Closing and reopening offline
  retains bonuses. Definitions are saved on owned Postgres rows as well as in Dexie.
  Deletion, renamed replacement and campaign transfer detach live links while
  preserving paid mechanics, selections and source/version provenance. Recreating
  the same name never reattaches old copies. Sheet rows show whether rules follow
  library updates or are retained; history records mechanics updates/detachment.
  Already unresolved legacy definitions pause calculated panels
  and rolls with an explanation; identity, trait, inventory and description editing remain
  available (inventory hides its unavailable Basic Lift/encumbrance classification).
  Library edits and YAML imports advance linked child revisions transactionally,
  so incremental HTTP pulls refresh definitions even after missed WS nudges or
  offline sessions. Library rows are themselves sync-backed, so every tab's editor
  and autocompletes follow committed cursor pulls through Dexie live queries.
  WS only accelerates that cycle. Cursor-only campaign touches do not clutter history.
  Already selected definitions are saved with speculative adds as local-only metadata,
  keeping those new copies usable offline; the server resolves its own version on replay.
  All six library reference types require an existing definition of the right kind
  in the character's campaign and current actor membership. REST and every sync
  write path share `services/libraryReferences.ts`. Removing a member detaches
  live references while preserving owned rules; unavailable sources produce visible
  rejections, including a toast and add-form flash for each character entry type.
  Inventory enchantment references use the same campaign check: the server replaces
  caller-supplied mechanics with the definition's current revision and complete owned
  snapshot. Definition edits refresh linked library/character items; deletion or
  campaign transfer clears only the live ID, leaving offline mechanics intact.
- **Active effects and skill procedures.** Active effects and conditional modifiers are behind the owner-only **Campaign settings → Rules → Experimental features → Enable active effects** (`experimentalActiveEffects`), off for new and existing campaigns. Disabled campaigns hide all related controls/library authoring and ignore their calculations while retaining stored data; manual temporary stat modifiers and skill procedures remain available. When enabled, campaign-defined and custom effect instances retain their owned mechanics, offline sync, REST/MCP operations and typed capability/sense/resistance labels, and the Combat → Active Effects panel lets players apply library/custom effects, inspect notes and duration, deactivate, expire, detach or remove instances. Skills carry contextual modifiers, action previews and level-threshold benefits through owned snapshots, REST/MCP and YAML v14. See [the subsystem spec](active-effects-skill-procedures.md).
- **Temporary effects.** Per-stat ✦ modifier popovers are the single
  way to add temp modifiers, backed by a reserved `manual` sentinel
  entry in the `characters.temp_effects` JSONB list. There is no longer
  any named-effects list or add form — the `manual` entry is the only
  entry that ever gets written, keyed by axis (ST/DX/IQ/HT/HP/Will/Per/
  FP/Speed/Move). "Revert all temporary buffs" clears the whole list in
  one patch. Tracked distinctly from permanent edits; never counts
  toward point cost. (Legacy named effects from before the add form was
  removed still exist in the DB and contribute to derived totals, but
  have no UI surface — "Revert all" clears them too.)
- **Traits** (advantages/disadvantages/perks/quirks) with modifier math:
  percent modifiers sum, the net is clamped at -80% (B110), the result
  rounds against the character (B102), then flat modifiers add.
  Per-level mechanical effects scale by the purchased level, including zero;
  legacy null levels count as one. Flat effects apply independently of level.
  ST-based damage depends on linked library definitions; unresolved declarations
  pause the sheet's calculated panels and rolls as described above.
  `damage_thrust` and `damage_swing` are signed flat adds to the final
  ST-based dice, after temporary ST adjustments; active sources add together.
  The sheet and attack roller share these adjusted results, then weapon adds
  apply once. Fixed weapon dice (e.g. `2d+1 pi`) are unaffected; adds are not
  automatically converted into extra dice.
  Skill-target effects respect explicit specializations (case/whitespace
  normalized). Unqualified names cover every specialty; `*` matches any name
  or specialty in its own field. Legacy `Name (Specialty)` effects retain
  that restriction unless an explicit `skillSpecialty` overrides it.
  Campaign owners author ordered declarative effects directly in trait and
  skill library forms: add, duplicate, reorder and delete rows; choose flat or
  per-level scaling; and supply target-aware skill, DR, condition, or weapon
  fields. Inline previews and field errors keep invalid drafts visible.
  Character owners can expand **Effects** on any trait and use the same
  editor. They can remove individual effect rows or clear the trait's effects;
  an emptied section returns to its compact add control. Those declarations
  are saved on the owned trait through the local-first outbox; this is also
  where an effect can safely bind one exact inventory item.
  Item-aware targets cover weapon attack, Parry, Block, damage and Accuracy.
  Selectors are deterministic: an exact local inventory id for owned mechanics,
  or portable exact normalized weapon name, governing skill/specialty, or
  library-item provenance. Optional `Primary`/alternate-mode restrictions apply
  only to attack, damage and Accuracy; global item effects reach each mode once.
  The sheet presents traits in one compact searchable table that mirrors Skills:
  Trait, Type, Points, and Level headings sort in place, Type folds into the trait
  row on narrow screens, and the shared row handle supports drag and keyboard
  ordering. Sort and custom order are device-only per-character preferences.
  Adding is collapsed until requested, and one full-width row editor opens at a
  time. Its **Edit** heading wraps the full trait name, including unspaced names.
  Notes, source rules, modifiers, and custom mechanics remain available
  there; advanced sections appear only when configured or when an owner chooses
  to add effects. Read-only campaign viewers retain search, sorting,
  ordering, and configured details without seeing mutation controls. Unsaved
  custom-effect drafts stay mounted when their disclosure or row closes, when
  another row opens, and while search temporarily hides the row.
- **Skills** with attribute/difficulty relative levels. A skill
  copied from the library retains its specialization, learned tech level,
  description, source, and prerequisites (the latter three in notes).
  The sheet presents skills as one compact searchable table. Its Skill,
  Attr/Dif, Points, and Level headings sort in place; the narrower mobile table
  folds Attr/Dif into the skill row while keeping its visible headings clickable.
  The shared row handle supports drag and keyboard ordering. Sort and custom
  order are device-only per-character preferences, survive reloads, and clear on
  logout. A row opens one full-width inline editor; the add form stays collapsed
  until requested. The **Edit** heading wraps long skill names and specializations
  within the editor. Source & rules is absent unless that skill has configured
  TL or owned mechanics to show. Read-only viewers keep search, sorting, custom
  presentation order, details, and rolls without receiving mutation controls.
  Library definitions explicitly declare whether specialization is forbidden,
  optional, or required and whether it is free-form or selected from a catalog.
  Catalog choices can override description, prerequisites, and defaults. The
  REST, sync, and MCP copy paths enforce the policy, canonicalize catalog names,
  and materialize the selected option's defaults and generated notes.
  Specialized skills use the compact `Name/Specialization` format consistently
  across sheet rows, rolls, history, combat bindings, and GM lookup. An applied
  skill modifier is marked by a small warning-colored `✦` beside the skill name;
  hovering, focusing, or tapping it opens the source breakdown in a tooltip rather
  than expanding the row. Long selected-library captions wrap inside the add form
  without displacing its controls. Learned TL is
  independent of later campaign TL changes. Skill **defaults** are copied
  declarations: attribute plus offset or another trained skill plus offset.
  An empty list means no default; absent/null legacy definitions mean unknown,
  shown with an explanatory tooltip and no invented roll target at zero points.
  Defaults are authored through library YAML/API and character REST/sync fields;
  skill-source declarations support exact, same-specialty, and any-specialty matching.
  Library skills also carry an explicit TL policy: not applicable, fixed, or
  required `/TL`. A required definition cannot be learned until the player
  chooses a concrete TL; fixed definitions canonicalize the learned value.
  The shared cross-TL helper applies the asymmetric IQ-based table: higher-TL
  use is -5/-10/-15 at +1/+2/+3 TL and impossible at +4, while lower-TL use is
  -1/-3/-5/-7 and then -2 per further TL; non-IQ technological skills use
  -1 per TL in either direction. Defaults may select exact
  skills, campaign-owned groups, or tags and may declare task, campaign-rule,
  character-fact, and same-specialization-dimension conditions. Unknown
  conditions remain visible candidates but never contribute an automatic level.
  Structured prerequisites form nested AND/OR trees over skills (level,
  relative level, points, and specialization), traits/levels, attributes, TL,
  campaign rules, and explicit GM permission. A campaign owner grants a named
  GM gate by adding the skill; that grant is retained in the owned snapshot so
  later point changes and offline warnings remain stable. Campaigns either block learning
  and point increases or allow them with persistent sheet warnings; unrelated
  later edits never delete an existing skill. Prose remains beside the typed
  rule for source fidelity. All rule data is captured in the owned library
  snapshot so offline calculation and warnings match the server.
  Difficulty never decides whether a default exists, including Very Hard skills.
  Basic-attribute defaults cap their source ST/DX/IQ/HT at 20 before applying
  the listed penalty (B173). Purchased levels and learned-skill defaults remain
  uncapped. This schema treats Will/Per as secondary characteristics, so they
  retain their full value; Other retains its existing fixed value of 10.
  The best available candidate wins; learned sources include purchased buy-ups,
  while zero-point bridges are excluded. The shared resolver keeps an acyclic
  source dependency graph, accepts only level improvements and uses stable ID
  ordering for reciprocal ties. Reversing a bought-up pair requires redistributing
  actual points, as in B173. Purchased improvements use the
  difference in point cost above a skill default (B173 / official FAQ 3.3.1);
  only actual points count in the ledger. Talent is added after defaults, to
  its listed target skills only. A computed level is a
  tappable roll target: it opens the same roll sheet used everywhere
  else on the character (dispatch only, so read-only viewers can roll
  too); null-level rows stay plain text. On narrow screens, each skill
  becomes a labeled card row so its name keeps the full content width instead
  of being squeezed by the attribute, points, level, and action columns.
- **Point ledger** with one bucket per source: attributes, secondary
  characteristics, advantages, disadvantages, quirks, languages, skills,
  spells, and techniques, plus a derived `unspent`
  (`campaign.pointTarget - total`; 0 when the campaign sets no target).
  Spells used to be folded into the skills bucket and languages into
  advantages; both now total the way a printed sheet does. Legacy
  `kind='language'` trait rows still bill to the languages bucket
  (migration 0028 moved the existing ones into `character_languages`);
  `cultural_familiarity` stays an advantage until it gets an entity of
  its own.
- **Techniques** (`character_techniques`, sync-backed): Martial Arts
  p. 87 techniques bought up from a named default skill. Difficulty is
  Average (+1 per point) or Hard (the first point buys nothing, then +1
  per point), clamped by an optional `maxLevel` cap. Each technique
  carries its **default line** (`defaultModifier`: how far below the
  governing skill the technique starts, e.g. -6), so a technique with a
  written penalty doesn't expose the full skill level as a roll target
  until points are bought up. The default skill
  is resolved by name against the sheet — bare name or
  `Name/Specialization` (while accepting legacy parenthesized references) — using
  the skill's *effective* level, so
  Talents flow through; an unresolvable default renders an em dash with
  a "Skill 'X' not on sheet" tooltip instead of guessing. The default
  line and points are editable per row. A resolved
  level is a tappable roll target like a skill's. Rendered on the Skills
  tab. The compact summary table shows points and roll levels beside the name;
  narrow rows place the governing skill, difficulty, and default line below it.
  **Add technique** opens a closed-by-default creation form, and each **Edit**
  action reveals labeled fields and confirmed deletion. Closing forms and row
  editors preserves their drafts. Shared table column filters remain available.
  Default-skill references use the shared React Aria skill combobox: suggestions
  combine the character sheet and campaign library, with the campaign entry
  taking precedence for the same name and specialization. Free text remains
  available for references not yet in either list. The same picker serves
  weapon governing skills and skill-targeted trait, active-effect, and
  enchantment rules; picking a specialized skill fills both fields where the
  rule stores name and specialty separately.
  Martial-arts **styles** live in the campaign library only
  (name + technique/perk/skill lists); a character adopts one by adding
  its pieces, so there is no per-character style row.
- **Languages** (`character_languages`, sync-backed) with independent
  **spoken** and **written** fluency (None / Broken / Accented / Native,
  plus `n/a` for sign languages, B23-24). Points auto-seed from the
  fluency pair on the add form and stay overridable, so a free mother
  tongue and a house-ruled cost are both expressible. They bill to their
  own **languages** bucket in the point ledger rather than inflating
  advantages, and the add form autocompletes against the campaign's
  language library. Rendered on the Skills tab under the skills table, with
  compact summary rows showing spoken/written fluency and points. **Add language**
  opens its closed-by-default creation form; **Edit** opens a labeled row editor
  with confirmed deletion. Closing either disclosure preserves drafts. Languages
  and Techniques use the shared filterable table and their outer fold heading
  without repeating inner titles. See [interaction-design.md](interaction-design.md).
- **Magic**: a full-width shared spell table, **mana level** from campaign,
  and compact **powerstones / magic items** tables with Inventory links. There
  are no outer collection folds or nested description cards. Spells show college,
  difficulty, points, rollable level, discounted energy cost/upkeep and casting
  time, with search, sorting and column filters. Names open read-only Markdown
  reference dialogs; pencils open retained inline editors. Add spell starts
  closed. Spell anchors reveal filtered rows without opening editing.
  Below 640px names/levels remain aligned, costs/time become metadata, and
  mutation actions share a horizontal row. Cast/Maintain open a separate
  Source/Available/Spend payment table, whose confirmation names the energy spent.
  Rolling and energy payment remain separate, with no automatic spell resolution.
  Every dialog fits the dynamic viewport; long names wrap without page scrolling.
  Spells have no default: a 0-point (legacy) spell row has a null level,
  gets no energy discount, and its Cast/Maintain actions are held. The
  cast dialog suggests drawing from a single powerstone and warns when
  energy is allocated from more than one (B481).
  Very high mana retains normal up-front casting and maintenance costs.
  Mages (including Magery 0) receive a reminder to manually restore only
  personal FP spent casting on their own turn at the start of their next turn, capped at maximum FP;
  maintenance FP is not eligible for this recovery;
  there is no automatic or timed refund, and HP/powerstones never recover
  this way. Spell rolls promote every failure to critical and distinguish
  a rolled critical failure's spectacular disaster (B235), including after closing
  the roll sheet or reloading local roll history. Spell rolls wait until campaign
  mana is known, and changing campaign or mana context closes any pending roll.
  Each cast/maintenance gesture shares one audit batch across its
  FP, HP and powerstone deductions.
- **Inventory**: nested containers (drag-and-drop, touch-enabled),
  encumbrance, armor and weapon data, cost/weight rollups. Both encumbrance summaries
  use player-carried weight, excluding stashed items; the raw weight total covers all items. A compact filter
  combines case-insensitive item-name substring matching with a category/status
  tag (weapon, armor, container, powerstone, magic item, enchanted, worn, or
  equipped). Results retain the ancestor containers needed to locate matching
  nested items while hiding every non-matching sibling and descendant. Containers
  start collapsed; their expanded/collapsed choice is remembered per character and
  container in device-local `localStorage`, never synced. A collapsed container
  shows a category-style count badge for every recursively contained item.
  Filter-driven ancestor expansion is temporary and does not change the saved choice. Equipped
  armor and active innate DR are aggregated per hit location on the Combat tab's Defense &
  Damage Resistance card. Each enchanted armor layer expands its base DR into nested enchantment
  contributions; highest-only conflicts are resolved across every equipped layer
  covering the selected hit location and retain suppressed sources visibly for an
  auditable total; the applied source needs no redundant "winning" badge.
  Non-overlapping armor
  resolves independently, so a stronger coif enchantment does not suppress boots.
  **Inline inventory editors** replace the item edit modal. Clicking a
  category chip (Armor, Weapon/Shield, Container, Powerstone, Magic item, or
  Enchantments) opens its editor immediately below the row; clicking that same
  chip again collapses it. The pencil opens basic item details in the same
  place. Category controls are separate from row selection and container
  expansion, and hidden editors retain their drafts while switching sections.
  **+ Category**, in the pencil's item-details editor, adds another role
  without changing siblings or equipped/worn state. Category removal has a separate inline confirmation; containers with
  contents must be emptied first. Read-only viewers see summary badges only.
  Fields save on blur through `useDraftField` and the local outbox. JSON leaf
  edits merge with the latest stored item inside a Dexie transaction so rapid
  edits to different armor/weapon properties cannot overwrite each other.
  **More options** reveals unused advanced fields. Any populated optional
  field is visible even with the disclosure closed, including numeric zero and
  checked flags; blank/unchecked fields can hide again after focus leaves.
  The field stays mounted in place so promotion does not steal focus. This
  applies to armor typed DR, crushing DR, defense bonus, facing and notes;
  weapon ST, shield DB, structured ranged range (fixed yards or ST multiplier), alternate modes and notes; powerstone and
  magic-item notes; enchantment details; and basic notes/external location.
  Armor retains every canonical and custom hit location. Weapons retain
  damage, reach, parry, governing skill, optional shield side, ranged stats,
  and alternate attack modes. Powerstones and magic items retain their charge/energy state
  and shared validation. Legacy enchantment rows remain display metadata, while
  typed campaign or character-local enchantments contribute attack, damage, Accuracy,
  Parry/Block/DB, DR, armor divisor, weight reduction, or skill modifiers only under
  their equipped/worn rule. Rows show the base-to-effective contribution breakdown,
  including inactive and highest-policy-suppressed effects.
  Library templates still populate the quick-add form, and its small optional
  category/equipped/worn controls remain available; detailed editing uses the
  new item's category chips.
  Every row leads with a container chevron or an item-type icon, and each
  nesting level indents one step with a faint guide line under its parent's
  chevron; a collapsed container shows its contained-item count. Below 640px
  each item is a compact two-line row: name and chips on the left, weight over
  quantity (shown only when above 1) and cost on the right, then the edit
  action. Indentation is bounded so deep trees keep room for names. Filtering
  retains matching items' ancestor context; closing containers preserves editor
  drafts. Desktop keeps its Item/Qty/Wt/Cost columns. See
  [interaction-design.md](interaction-design.md) for the shared presentation patterns.
  Implementation lives under
  `characters/sections/inventory/` (`InventoryItemEditor`, `ItemField`, `RangedRangeField`, and
  `itemMutations`), with regression tests for disclosure, local saves, rollback,
  category changes, and structured-data preservation.
  Encumbered Move
  floors at 1 while the load is legal and reads 0 past the 10×BL carry
  cap (B17).
- **Current Status and Combat tab (live-gameplay surfaces)**. Combat follows
  Overview in the navigation
  (`src/client/features/characters/sections/combat/CombatTab.tsx`),
  consolidating everything a player touches mid-session onto one inline
  surface. There is no combat modal or separate live-gameplay route; the
  player taps between live combat and the editable sheet without a route
  hop. **Current Status** is persistent on every full character section (the
  privacy-preserving minimal view does not receive it). It always holds HP and FP.
  Posture, maneuver, and conditions are independent, off-by-default user display preferences in Settings;
  they do not change the saved combat state or its effects on the rules. Settings
  are saved per signed-in user on this device. The status controls are portaled
  into the sticky global header. Below 1280px, a compact character/navigation menu,
  HP, FP, sync status, and notifications occupy separate, nonoverlapping tracks
  in one row; enabled optional controls form a second row. The mobile pool targets
  show current/max values above warning text in a flat, divided toolbar. The menu
  retains character, campaign, account, theme, and
  other navigation actions. On desktop the ordinary navigation row stays above
  the status controls, with less status padding when all optional controls are off.
  The measured complete header height supplies section scroll offsets, including
  when desktop navigation wraps. Attacks, the combined
  defense/armor workspace, the Solo tracker, and roll history use the Combat tab's
  full width. Sections stack on
  mobile instead of accumulating into two independent, uneven columns. Main combat
  sections fold independently, with responsive grids inside them.
  - **Current Status** — compact HP/FP controls show their current/max values and
    important warnings. Opening a pool reveals ±1 and ±5 controls, reset, a range
    control, threshold/recovery guidance, death-check actions, and the FP-floor
    warning. Enabled posture and maneuver close after a preset selection; enabled
    conditions stay open for multi-selection until **Done**. The maneuver editor retains the active
    preset's rules guidance and supports a custom free-text fallback. The collapsed condition summary shows
    the first active condition plus `+N`. All common-condition chips normalize
    legacy Capitalized entries so old data still lights the right chip. Below 1280px,
    HP and FP share the first row with navigation and sync actions; enabled posture,
    maneuver, and conditions appear directly below them. The
    condition editor suggests Reeling below one-third HP but never applies it.
    Each FP lost below zero also costs
    one HP, including a decrement crossing zero (B426); FP stops at −FP,
    after which loss is HP-only. Bumpers and spell spending reuse
    `applyFatigueLoss`. Bumpers compose with the latest local draft saves across
    inputs. Combined HP/FP edits enter one local transaction
    with a shared history batch; each field retains ordinary outbox coalescing,
    server settlement and rollback toast/flash behavior. One shared
    `usePoolBumpers` instance feeds Current Status, so rapid changes never race.
    The bar is always present on the full sheet and opens one editor at a time
    with threshold/recovery
    marks and visible labels positioned from their actual values on the scale.
    Close threshold labels use staggered lanes so they retain their exact anchors
    without colliding. Each popover also has touch-sized −1/+1 controls for precise
    common adjustments. Every gesture updates Dexie immediately against the latest
    durable pool value; the panel has no separate speculative counter. A refreshed
    200 ms deadline debounces only the network drain, allowing the outbox to
    coalesce rapid same-field changes without delaying or replaying the visible
    result. Slider targets are rebased inside the same transaction.
    The two triggers share one adjustment panel. On phones it is fixed and
    centered within the viewport; at 768px and above it is anchored below the
    active trigger. The desktop panel opens toward the available right side so
    FP cannot overflow the viewport's left edge. Escape or an outside tap
    dismisses it.
    Immediate threshold warnings are visible beside the pool values; exceptional
    and certain-death bounds are de-emphasized notes rather than primary controls;
    `useConditionsToggle` mirrors the same latest-intended-ref pattern
    so two rapid condition taps before Dexie re-renders don't coalesce
    into one outbox patch and drop the first tap.
  - **Incoming attack** — a foldable workspace with equipped armor,
    active global/location innate DR, and natural skull DR 2
    (`src/shared/domain/armorDr.ts`), complementing the Attacks card's
    hit-location aim presets. A rounded, generic SVG silhouette exposes all 15
    standard locations with clickable zones, keyboard selection, and linked
    DR labels. The location picker also includes custom armor/innate locations.
    Damage-type and penetration controls update the whole map and the selected
    location's layer breakdown. The same location/facing selection supplies armor
    DB to Dodge, Parry, and Block, so the displayed defense scores and armor context
    cannot drift apart. Unprotected locations remain selectable; unknown
    protection is shown as unavailable, not zero. Torso armor also protects vitals;
    explicitly listing both never counts a layer twice. Per-damage-type DR overrides
    (`armorData.typedDr` — e.g. a hauberk with 6 vs cut, 4 vs imp) and
    the legacy crushing-specific DR are shown where they differ from the
    default. Every layer contributes its override or base DR, including
    crushing overrides. Unscoped innate DR excludes eyes (B46); an explicit
    eye effect can protect them. Scoped effects, including custom locations,
    never inflate the global `derived.traitDr` total; inactive effects do not
    protect. The global trait-DR breakdown lists only unscoped effects. While
    linked trait/skill definitions are unavailable (including a cold offline
    load), DR is marked unavailable and the damage dialog cannot apply HP loss.
    Known empty effect definitions remain distinguishable from missing entries.
    An **"Incoming damage…"** button carries the one selected location, facing,
    damage type, and penetration into a dialog that displays this context read-only
    and asks for basic damage. Failed active-defense rolls also offer **Incoming damage…**,
    which closes the roll sheet and opens that same dialog with the selected attack
    context. Successful defenses and other checks do not offer this action.
    Presets include armor divisors and Ignore DR;
    custom types and divisors are edited in the workspace. The campaign's **House rules**
    setting `protectNaturalDr` defaults **on** for existing/new campaigns and
    campaignless characters: divisors above 1 (including Ignore DR) affect worn
    armor only; innate and natural skull DR remain intact. Turn it off for the
    standard GURPS calculation, including Penetrating Weapon (M63). All active
    `dr` effects are treated as innate protection; free-text trait names and
    enchantment notes never decide immunity. The selected DR, silhouette labels,
    and incoming-damage result share this policy. Fractional divisors below 1
    increase the complete DR; an unprotected target gets final DR 1 (B110/B379).
    Presets include (0.5), (0.2), and (0.1). Skull DR 2 never protects against
    toxic damage (B399); torso-scoped innate DR also covers vitals (B47).
    Corrosion uses ×1.5 at face and neck, and damage-type aliases use the same
    wounding and typed-DR rules. Missing campaign house rules (including a
    pre-upgrade local mirror) make DR unavailable and block damage application
    until the campaign cursor refreshes. Saved rules remain usable offline.
    Vitals use ×3 for impaling and
    piercing, or ×2 for tight-beam burning (using burning DR), replacing the
    damage type's multiplier rather than multiplying it twice. Invalid damage
    and divisor inputs cannot be applied; fatigue damage is directed to FP.
    Hardened must be accounted for in the chosen effective divisor, and
    armor DR and DB both follow the selected incoming facing. Facing defaults to
    **Front** and offers Front, Back, Left, and Right; there is no unknown state.
    Front-only/back-only layers do not protect either side. The shared hit-location
    and facing controls also resolve the highest applicable
    armor DB plus shield DB. A shield with an optional left/right side protects
    the front and its matching side; an unspecified legacy shield retains its
    prior behavior. That defense-only context feeds Dodge, Parry, and
    Block while remaining explicitly separate from damage resistance.
    The dialog
    (`IncomingDamageDialog.tsx`) resolves a hit against the
    character's own DR: basic damage − DR(location) with the resolver
    honoring the incoming type's typed override first, falling back to
    the crushing override (`drCrushing`, for `cr`) then the default `dr`
    (B378), dividing the complete protection (including natural skull
    DR) by an armor divisor when standard rules are selected → penetrating
    × wounding multiplier (B379/B398-400) =
    injury (`src/shared/domain/injuryCalc.ts`), applied to HP through
    the same shared `usePoolBumpers` instance as the rest of the tab.
    Limb/extremity HP loss is capped at the minimum crippling injury using
    maximum HP (B421): HP10 arms/legs cap at 6, hands/feet at 4. The full
    pre-cap injury remains visible and drives crippling/destruction hints;
    destruction requires at least twice the crippling amount. The hint describes
    severing for cutting damage and generic destruction for other damage types. Conditions
    remain manual. Torso, skull, and eye-to-brain injuries are uncapped.
  - **Active defenses** — an icon-labelled table alongside the body map inside
    Incoming attack, using its selected hit location and facing,
    with sortable Defense, Governing skill, and
    Final columns plus a device-local custom order that supports drag-and-drop and
    keyboard arrow reordering. The column headers are the only explicit sort controls;
    on narrow screens the skill and base score move under the defense name to keep
    the final defense roll visible. Choosing a numeric defense records its name
    and current score in the attack workspace. Changing the location, facing,
    or score clears that selection, as does applying injury. The roll result
    and situational modifiers remain a player
    decision; incoming damage is an explicit path when the attack hits.
    dragging or using the row handles returns the table to custom order. Attacks and
    defenses share the canonical `DragHandle` control and its `⠿` glyph so reorder
    affordances stay visually consistent. Source
    breakdowns stay collapsed on their rows; current restrictions and All-Out Defense
    choices remain visible. Move is not a defense and is omitted. Dodge includes
    the encumbrance-penalty breakdown and no invented minimum),
    Parry per equipped weapon, and Block. A weapon's governing skill is
    resolved via `resolveWeaponSkill` (`src/shared/domain/defenseCalc.ts`):
    an explicit `weaponData.skill` binding (exact case-insensitive
    name match, shown as "Skill 'X' not on sheet" if missing) takes
    priority; unset falls back to fuzzy name-matching the weapon's own
    name against the sheet's skills. The ST-shortfall penalty (B270,
    −1/point under `stRequired`) is subtracted from the matched level
    before Parry is computed. **Block** is derived from an actually-
    equipped shield — an item whose `weaponData.db` (Defense Bonus) is
    set, picked by `pickShield` — not merely the presence of a
    "Shield"-named skill; that shield's DB then adds to Dodge, every
    Parry, and Block (B287), along with the single highest **armor DB** from
    equipped armor that covers the selected hit location and facing
    (`armorData.db`, resolved by `resolveArmorDb`) — the captions identify the
    winning source. Armor DB is defense-only; the incoming-damage dialog shows
    it for context but never subtracts it as DR. Every numeric
    defense opens the roll sheet. Active derived Parry/Block modifiers are
    added once after halving skill, through the shared defense helpers;
    Dodge already includes its derived modifier. Captions show these totals,
    including enabled conditional effects such as Enhanced Defenses. Additional
    situational modifiers can still be supplied in the roll sheet.
    The shared `combatAdjustments.ts` layer halves current Move/Dodge below
    one-third HP and below one-third FP, cumulatively with rounding up
    (B419/B426; [official FAQ 3.4.5.7](https://www.sjgames.com/gurps/faq/FAQ4-3.html)).
    Encumbrance precedes these reductions; DB and situational defense modifiers
    follow them (B374). Low FP also halves usable ST for minimum-ST penalties
    on both weapon attacks and parries,
    without changing ST-based damage. Manual Reeling and Shock chips do not
    trigger a second numerical penalty. Recorded stun adds −4, posture adds
    the B551 defense penalty and limits movement, and known maneuvers limit
    movement to their full/half/step/none allowance. All-Out Attack, unconsciousness,
    sleeping, and the negative-FP floor disable defense actions; Move and Attack
    disables parry. Permanent non-rollable parries retain their raw notation and
    missing-skill diagnostics during these restrictions. All-Out Defense offers
    a local roll option: +2 to the chosen
    defense or Double Defense (no numerical bonus), with the selected chip highlighted.
    Only Increased Dodge permits half Move; the other options permit a step (B366).
    Evaluate permits a step; Wait permits no movement until its trigger (B364/B366).
    Dodge has no minimum introduced by pool reductions. Changing character/maneuver
    clears that selection. Breakdowns name pool/posture/stun/maneuver adjustments;
    unmodeled tactical situations and custom maneuvers remain player-supplied.
  - **Attacks** — a compact table groups equipped weapons and their alternate
    modes, with aligned governing-skill/target, damage, damage-type, and reach
    columns. Weapon, governing skill, and damage type headers toggle ascending /
    descending sorting. **Custom** order exposes drag handles (including touch
    long-press); focused handles also move with the up/down arrow keys. Sort and
    custom weapon order are saved per character on this device, survive reloads,
    and are cleared on logout. These are presentation preferences, not inventory
    edits, and are not server-synced (`combat/attackTablePreferences.ts`). New
    equipped weapons append to custom order. Resolved damage dice (ST
    thrust/swing + the weapon's modifiers + weapon-scoped damage effects, or
    fixed dice + weapon-scoped damage effects) are **tappable buttons that
    roll damage** (NdM+adds, B269, with the type/cut/imp/piercing
    1-point floor from B378), reach, an ST-shortfall badge/caption
    (B270, applied to the roll target), a ranged stat line (Acc/Range/
    RoF/Shots/Bulk/Recoil) when the weapon has one, and the resolved
    skill as a compact roll button. Attack rolls open separate range, Aim,
    hit-location and Other controls. Fixed-yard and ST-multiplier ranges use a
    structured weapon value, with the speed/range slider stopping at the
    mode's resolved Max. Aim offers none, 1, 2 or 3+ seconds (Acc, Acc+1,
    Acc+2, capped at twice base Acc); the defense section's body map supplies
    hit-location penalties; compact screens place its location callouts in a
    touch-sized grid below the silhouette. Vitals and eyes are disabled for the current attack mode when
    its damage cannot target them. **Alternate attack modes** render as labelled
    table rows and retain independent range and Accuracy. Attack-mode effects
    apply to the matching mode; unmatched selectors are diagnosed visibly.
  - **Roll sheet** — an ephemeral bottom-sheet/dialog roller with two
    variants sharing one shell. Check rolls show the effective target and a
    `Roll vs N` action. Attack rolls combine range, Aim, hit location, rule
    bonuses and an Other modifier; the controls remain independently adjustable.
    Long roll labels wrap inside the sheet, and the Roll action stays reachable
    while controls and results scroll. Defense and skill
    rolls retain the generic modifier stepper and optional presets. Defense
    rows use the same success-roll evaluator as skills, an existing rules
    simplification.
    The **damage** variant (triggered by a `RollRequest.damage` payload,
    e.g. from an Attacks card damage chip) rolls NdM+adds instead of
    3d6-vs-target: the stepper adjusts flat adds, presets are hidden,
    and the result shows the individual dice plus total with no
    success/crit call. The sheet's Skills and Magic tabs share the same
    roll sheet (`.RollSheet` / `RollableRow` live under `sections/`) so
    tapping a skill/spell level in those tables opens the identical
    roller.
- **Warnings**: derived rule-violation banners the user can dismiss.
  Beyond the attribute-range and campaign-cap rules, this includes HP
  modifiers beyond ±30% of ST, FP modifiers beyond ±30% of HT (B16),
  and carried weight past the 10×BL carry cap.
- **History tab**: defaults to the per-character server audit log (see
  history-tracking.md) and provides a second **Roll history** sub-tab for browsing
  this character's rolls. Roll history is newest first and capped at 250 entries
  per character; adding a roll prunes the oldest entries beyond that limit. Check
  entries show target/dice/total/margin/crit and damage entries show dice/total/type.
  Entries persisted before damage rolls existed have no `kind` and deserialize as
  checks. Rolls live only in `localStorage` under
  `gurps:rollHistory:<characterId>`: they survive reloads but are never sent through
  the outbox, sync API, history API, or MCP. Logout calls `clearAllRollHistory` so
  account switching on the same device cannot expose prior roll labels.

Every editable input on the sheet is **draft-on-blur** and never silently
loses an edit; see `src/client/hooks/useDraftField.ts` and `AGENTS.md`
interaction rules.

### Campaigns
Routes `/campaigns`, `/campaigns/:id`, `/campaigns/:id/log`,
`/campaigns/:id/library`, `/campaigns/:id/history`, `/campaigns/:id/encounters`,
and `/campaigns/:id/gm` form one campaign workspace. Every destination uses the
same campaign identity header and sibling navigation; the app-header breadcrumb
continues to show `Campaign > campaign name > destination`. The workspace uses
the local campaign mirror as its fallback, so the navigation and sync-backed
library remain available offline. The legacy top-level `/log` and `/library`
routes remain as campaign-switching entry points.

The Overview (`/campaigns/:id`) holds campaign facts and the browseable character
roster rather than embedding unrelated tools in one long page. Every member
character in the campaign is listed there, regardless of the share gate; rows a
viewer only sees minimally deep-link to `/characters/:id`, which renders
`CharacterMinimalView`. Adventure Log and History have dedicated sibling routes.
Encounters appears when the experimental turn tracker is enabled, and GM dashboard
appears for owners and managers. Campaign cards show stored covers when available, without a decorative cover
slot when no image is assigned. Cover uploads and their help live in the
Campaign section of the centered settings dialog. Rules and Members have separate
settings sections; switching sections retains drafts.

- Owner-editable **House rule sets** in campaign settings: None, J Talisar, or
  Custom. Named sets load their bundles; moving to Custom preserves all loaded
  values, and changing one option never resets its siblings. Every rule includes
  an in-app explanation. Natural DR penetration immunity remains enabled in the
  legacy/default Custom state. Settings save through the campaign REST path and
  are mirrored read-only with character mechanics.
- Create/edit campaigns with **point target, disadvantage cap, quirk cap,
  mana level, tech level**, the default-on **enforce attribute caps** rule,
  and the **share-character-sheets** toggle. Attribute-cap enforcement blocks
  purchased DX/IQ/HT above 20 and purchased Will/Per totals above 20; ST and
  temporary bonuses are exempt (B14-B16). Tech
  level is campaign-wide (not per character); every character in the
  campaign displays it read-only, resolved the same way `manaLevel` is.
- **Roles**: `owner` (GM), `manager`, `member`.
- **Membership management**: add/remove members, change roles, **transfer
  ownership**, delete campaign.
- **Invitations**: invite by handle (email or display name), inbox to
  accept/reject, notifications. Pending invitation cards wrap long campaign
  names on narrow screens. See [campaign-content-sharing.md](campaign-content-sharing.md).
- **Character-sheet sharing gate** (`shareCharacterSheets`): when off, only the
  owner (GM) and a character's own player see full sheets; other members get a
  "minimal view" (identity columns only — no stats, temp effects, HP/FP,
  traits/skills/spells/inventory/combat, or history). Enforced on the server
  sync emission, the local Dexie purge, and the UI discovery surfaces: minimal
  characters are **excluded from `/characters`** and browsable only from the
  campaign detail page; full-share and editable-manager rows remain listed.
  See campaign-content-sharing.md.
- **Library authoring guidance.** `/help/campaign-library` explains first entries, sources/editions, completeness, character adoption, advanced rules and safe bulk maintenance. The Library guide link opens separately to preserve an unfinished form. Optional metadata, calculated pricing and mechanical fields use disclosures that retain drafts. Common skill prerequisites/defaults have guided controls with a lossless advanced JSON editor. Item armor has guided DR, coverage and facing fields with a lossless YAML mode. Source validation labels required fields and focuses the first invalid input.
- **Faithful library pricing and editions.** Sources and standalone modifiers share the local-first library. Complete definitions resolve bounded declarative points, percentage, cost and weight rules; character purchases retain pricing snapshots and require explicit re-resolution after source changes. Incomplete/example/reference records stay searchable but cannot be adopted. Source-qualified editions coexist, with campaign priority and preferred overrides. Items support independent stable weapon modes and simultaneous facets. See [calculation rules](library-calculation-rules.md).
- **New-campaign sourcebooks.** Campaign creation seeds 17 common GURPS Fourth Edition source records with familiar page-reference abbreviations. The owner can delete any source they want to exclude; existing campaigns are not changed.
- **Campaign library**: per-campaign catalog of traits, skills, spells,
  items, enchantments, active effects, languages, techniques, and styles. It is
  **fully sync-backed**: every member browses it from Dexie (offline too), and
  the owner's creates, edits and deletes go through the outbox (edits are
  whole-entry patches, AGENTS.md S13) with the standard rejection toast and row
  flash. **Restricted** entries remain GM-only across library reads, export,
  sync and history; existing character snapshots remain usable. The in-app catalog editor (`/campaigns/:id/library`) offers dedicated
  CRUD forms for ten standard categories plus the opt-in Active Effects experiment, including **languages, techniques and styles**.
  The dedicated character-sheet Languages and Techniques panels consume their
  definitions through autocompletes; styles remain library reference packages. Built for
  libraries with hundreds of entries: each category is one compact table with
  sortable column headings (device-remembered per campaign and category),
  light category groups that fold (traits by kind, skills by attribute, spells
  by college, items by category, languages by spoken/sign form, techniques by
  default skill, styles by first component skill, enchantments by applicability,
  enabled active effects by first tag) and a jump strip to any group. Group anchors retain
  distinct identities for Unicode, case and punctuation variations. Group labels
  and mobile row metadata wrap long unspaced category names while preserving the
  count and fold control. Rows show the name, key numbers
  and a one-line source excerpt that preserves punctuation (including comparison
  symbols and literal Markdown characters); opening a row renders its full Markdown
  entry in place. The category chips, search and jump strip stay pinned under
  the app header when they leave enough room for content; if the toolbar would
  occupy more than half the visible area below the header, it scrolls with the page.
  Focused library form fields retain their draft and scroll below
  that toolbar when rotation, viewport resizing, or keyboard focus would conceal
  the active field. Long rich-text and raw Markdown editors track the editing
  caret, and form actions reserve the same toolbar offset. On narrow screens the
  search field and its **Clear search**
  button wrap together onto a row below the source selector, preserving usable
  input width. Search matches every word across names, descriptions, sources
  and categories. `?section=`, `?q=` and `?open=` make a category, search or
  entry linkable. Drafts survive category switches, searches and folded groups,
  and a draft the client can already tell is invalid (schema, specialization
  rule, duplicate name) stays open with the reason. The whole catalog is also
  **importable/exportable as versioned YAML**
  for sharing between campaigns. The campaign workspace's **Import & export** tab
  (`/campaigns/:id/library-transfer`) holds whole-library and sourcebook-scoped
  transfers; long sourcebook selection labels wrap beside their checkboxes within
  the transfer card. `/library` remains a campaign-switching editor. Import validates the chosen file and shows a confirmation
  preview before Merge or Replace; Replace never runs on file selection alone.
  Import is the one online-only library action; the page pulls its result into
  Dexie on success.
  Library skill forms also author first-class free-form/catalog specialization
  policies and per-catalog-option rule overrides; portable YAML v14 retains them.
  Technique form explanations for default penalties and level caps wrap within
  their fields on narrow screens, keeping the examples readable without horizontal scrolling.
- **Adventure log**: session log entries attached to Campaign (shared, default)
  or an owned character (private), with an attachment dropdown and explanatory
  tooltip, an optional **session number** (running
  session ordinal starting at 0, e.g. 13) and **location** (free-form text, e.g. "The
  Hollow Beneath Greymoor"), and optional **Points gained**. New campaign awards snapshot all current characters by default; **Choose characters** selects a subset. Awards raise each recipient's point cap above the campaign starting target, and edits/deletions adjust the existing credit rather than adding it twice. Campaign owners may award any character; members may award their own characters. The concrete **XP award** list remains available through REST/MCP. Campaigns without a starting point target remain uncapped.
  Opening the create form suggests session 0 when no numbered entries exist,
  otherwise one above the greatest posted session number; the suggestion is
  editable. The campaign-scoped `/campaigns/:id/log` page never shows a campaign
  selector because the route already fixes its campaign.
  The body is **markdown** (CommonMark + GFM) rendered through a sanitized
  pipeline that never interprets raw HTML or scripts. The create/edit form
  offers a Tiptap **rich text editor** with a raw-markdown toggle. Entries with
  GFM tables stay in Markdown mode so their table source remains intact; table
  previews scroll locally on narrow screens. Entries
  can be **edited or deleted** by their author or the campaign owner. Editing
  replaces the selected card in place, with Save changes and Cancel beside the draft.
  Titles, author names, and locations wrap within their entry cards, including
  values without spaces, so narrow screens do not gain horizontal page overflow.
  Award summaries show the points per recipient (or the total for varied legacy awards);
  the character count opens a bounded, scrollable tooltip of the saved recipients
  and their amounts. Private badges name the attached character when available. See
  campaign-content-sharing.md.
  Campaign/library/log/history reads show a retryable error when their request
  fails, rather than presenting a failed request as an empty collection.
- **Campaign history view**: campaign-level audit log (settings, membership,
  library, log), plus an owner/manager roll-up across member characters. Audit
  summaries wrap long unspaced entity names within their rows without clipping.
- **GM campaign dashboard** (`/campaigns/:id/gm`): an owner/manager live-session
  view with a responsive grid of compact, read-only character cards backed by
  the local Dexie character model, plus a five-second character-history feed.
   Newly observed changes remain highlighted for 30 seconds, and long unspaced
   character names in activity summaries wrap inside the feed. Cards open the
   full sheet in a new tab. The REST
   campaign mirror input stays stable across local subscription renders so
   the party query can settle instead of being invalidated by repeated mirror writes.
- **Experimental turn tracking**: the owner enables **Campaign settings → Rules →
  Experimental features → Enable turn tracker** (`experimentalTurnTracker`).
  Defaults off for existing/new campaigns; campaignless characters also hide
  their local tracker. Missing pre-upgrade/offline settings count as off.
  Disabling hides campaign encounter UI (including bookmarked encounter pages)
  and the character scratchpad without deleting data. This is a UI feature
  switch; existing encounter API permissions are unchanged.
- **Encounter tracker foundation**: the online-only REST aggregate under
  `/campaigns/:id/encounters` stores campaign encounter state, PC/NPC
   combatants, turn order, and timed effects. Members can read a privacy-aware
   projection (hidden NPCs and effects targeting them omitted; other players'
   copied PC combat fields masked when character sheets are not shared; hidden
   casters' effect ids masked), while
   owners/managers control the tracker. Encounter updates use optimistic turn
   concurrency and `encounter_invalidate` WebSocket nudges.
    - **Encounter tracker**: campaign pages list active and ended encounters;
     owners/managers can select PCs from the campaign roster, create and fully
     edit NPC combatants, reorder combatants (including Wait reslots), end
     combat. Detailed NPC creation/editing uses a native modal above the sticky
     header, with viewport-bounded height and internal scrolling; Escape closes it.
      Owners/managers can advance turns while combat is active and maintain or
    acknowledge timed effects. Effect add/edit supports templates, manual
    round/minute/hour/indefinite durations, known-spell prefills, maintenance
    costs, and optional PC-sheet links. Effect forms also use native modals above
    the sticky header, with internal scrolling and Escape dismissal.
    Expiry acknowledgement/removal confirms
     and, after the REST acknowledgement succeeds, clears linked sheet values through the character outbox. Members receive the server's privacy-safe
   projection; a player can use local-first HP/FP and condition quick actions
    only for their own PC. Each character's Combat tab also has its own
    device-only initiative scratchpad in Dexie, with local combatants and
    timed effects. Effects can use shared templates or manual round/minute/
    hour/indefinite durations, show expiry and maintenance prompts, and can
    be acknowledged or removed locally. The scratchpad is cleared at logout
    and never sent to the server.
- **Optional GM character editing**: an owner-controlled, default-off campaign
  setting lets owners and managers edit player-owned sheets through the normal
  local-first outbox. REST and sync use the same central write decision.

### Cross-cutting UI
- **Shared app mark**: the opaque charcoal-and-gold die/book mark is the favicon,
  installable-PWA artwork, and visible brand icon in player, admin, and error
  chrome. `BrandMark.tsx` owns the in-app rendering so those surfaces do not
  drift back to separate letter marks.
- **Navigational breadcrumbs** (persistent header): character detail shows
  `Character › <character name>`. Campaign detail shows
  `Campaign › <campaign name>`; campaign library, GM, and encounter routes add
  their page label. Global Log and Library pages resolve their `?campaign=`
  selection into `Campaign › <campaign name> › Log/Library`. The first level
  returns to its collection and the named level returns to that entity's main
  page. Campaign sub-navigation carries the current campaign into Log/Library.
  Long account names stay truncated at every width so the user-menu
  trigger fits alongside the other header controls; the menu retains the account
  email within viewport bounds.
- **Logged-in home**: a compact welcome and the four most recently updated
  characters. The welcome heading wraps long unspaced account names within its
  card. Global Character, Campaign, Log, and Library destinations stay in the
  persistent header instead of being repeated as homepage buttons or shortcut
  cards.
- **Sync status indicator and log** (header): a quiet etched arrow orbit replaces
  filled success/warning badges. Synced uses a still gem and muted ink; syncing
  rotates violet arrows around the gem; offline uses a neutral pause mark; errors
  use a copper exclamation and take precedence if the browser is also offline.
  Hover/focus text and the accessible name describe the state. An error always
  names its reason (in the tooltip and in a banner at the top of the log) rather than pointing at a toast that may never
  have existed. Clicking it opens the local sync log, with current unsynced
  changes, the latest 1,000 pushed/pulled changes and timestamps, repeatedly
  failing changes with diagnostics and an explicit revert action, plus a
  confirmed emergency action to abandon local changes and pull a fresh server
  copy. Every queued and journalled event **expands** (collapsed by default) to
  show what actually changed — field, before/after values, entity, operation,
  and the failure reason where there is one. Successful changes and their
  matching revision-only cursor acknowledgements share one item, with folded
  **Request** and **Response** sections beside one another. Browser campaign saves
  also retain their submitted request and matching cursor refresh; standalone pulls
  have Response only. Rapid HP/FP adjustments share explicit debounce-burst IDs;
  continuous successful uploads show one net change while retaining every raw
  request/response. Resets, damage applications, failures, and remote changes
  remain separate. Subject titles show names and link to existing entities;
  before/after focuses on changed fields and nested settings. Campaign creation,
  settings, ownership changes, deletion, and aggregate YAML imports journal their
  online-only writes. WebSocket status and its relative last-connection time
  stay separate from the HTTP last-successful-sync time. The log's **Sync now**
  button runs an HTTP outbox/cursor cycle and refreshes the last-sync time after
  success, even when nothing changed. Automatic empty polls leave that time alone.
  Larger diagnostic payloads use device-local gzip storage and load when a
  change opens; closed rows/folds do not format their bodies. Debug
  downloads still export readable JSON.
- **Viewport-safe overlays**: trigger-anchored tooltips, popovers, and dropdowns
  share horizontal collision handling, measured visual-viewport width limits, and
  content wrapping so their full surface remains reachable on narrow screens and after
  resize or zoom. Width caps shrink during pinch zoom and recover on zoom-out;
  measurement listeners attach when a delayed panel mounts. The sync status
  tooltip and notifications panel use this shared behavior; the account and
  compact character/app menus clamp to the remaining
  visual viewport height and scroll internally, including after rotation or
  pinch zoom. HP/FP adjustment and posture/maneuver/conditions panels use the
  same remaining-height constraint. Temporary modifier popovers also correct
  vertical collisions so Clear and Apply stay reachable. Native dialogs center
  and cap their boxes within the visual viewport during zoom and panning while
  retaining the browser's modal focus trap.
  Growing overlays also clamp to dynamic viewport height and scroll
  internally where needed. A source guard rejects raw `data-tip` tooltips and
  anchored dropdown content that bypasses the collision helper.
- **Notifications**: the bell receives invitations/responses, membership/access changes,
  other-user character edits, points changes, campaign rules, shared logs and linked
  library updates. Character editing bursts group into one notice. Settings offers
  account-synced topic switches and two email switches (invitations and acceptance,
  both default on). Password/passkey/API-key security email is unconditional; no
  other topics support email. Desktop is per-user on this browser, default off,
  and only its explicit enable gesture can request permission. It delivers new
  notices while the app is open in the background; no closed-app push. The bell
  panel stays within the dynamic viewport. Server notification queues wake via
  Postgres `LISTEN/NOTIFY`, drain on startup/reconnect, and schedule pending email
  retries by their due time; empty queues have no processing timer. See
  [notifications.md](notifications.md).
- **New-version prompt**: a long-lived tab polls for a new build and offers a
  persistent "A new version of the app is available" toast with a Reload
  button. Never reloads on its own (`SwUpdatePrompt`, `src/sw/registerSW.ts`).
- **Styled error recovery**: unknown routes and unexpected router/render errors
  use the app shell rather than React Router's developer fallback. The
  page offers home/reload actions and shows a unique error reference, server
  request ID when available, current-user ID when available, route, and time for
  support correlation without exposing raw error details.
- **Themes**: the header toggles dark/light mode per device (defaulting to the
  OS preference). Settings → **Appearance** picks the palette for each mode —
  dark: **Gilded Tome** (default), **Midnight Gilt**, **Verdigris & Brass**, or classic **Arcane Purple**; light: **Illuminated
  Manuscript** (default), **Heraldic Vellum**, or classic **Arcane Purple**. The palette choices are saved
  to the account (`GET`/`PATCH /auth/preferences`, `users.dark_theme` /
  `light_theme`) so every device matches; changes apply immediately, are kept
  locally while offline and pushed when back online, and a server rejection
  rolls the picker back with a toast and flash. The app icon is a fixed image
  that does not change with the theme.
- **Installable PWA.** Stable root identity, standalone launch, labeled mobile/
  desktop installation screenshots, opaque general icons and a separate adaptive
  Android icon that preserves the emblem under launcher masks. Content-hashed
  installation-art URLs allow browsers to detect artwork updates. A 180px Apple
  touch icon and 32px favicon share the existing brand mark. Character edits work
  offline after the first online download; the built package has a mandatory
  integrity check and real-service-worker browser acceptance. See
  [architecture.md](architecture.md#pwa-installation-package).
- **Settings** page: theme palettes (synced), account-scoped device-local
  Current Status display switches, notification controls, profile, password, passkeys, API keys. Long credential and
  connected-app names wrap inside their cards, with destructive actions stacked
  below them on narrow screens rather than overlapping the metadata.

### Admin (separate bundle)
A **separate Vite entry** (`src/client/admin/`, served at `/admin/*`) — not
part of the PWA bundle — for superusers: manage users (suspend/purge) and
inspect campaigns and uploaded images, take down images, and disable/re-enable
an uploader's uploads. Scheduling a purge requires confirmation, suspends the
account immediately and revokes existing JWT sessions, refresh tokens, API keys
and OAuth grants. Cancellation leaves the account suspended; unsuspension is
blocked until the purge is cancelled. Administrators cannot suspend or purge
themselves, and account actions serialize while the displayed state refreshes.
The admin entry uses `AdminRequireAuth` and `/admin/login`, with sign-in returning
to the requested admin page. It does not start the player sync orchestrator or
wait for an IndexedDB bootstrap; expired or cleared sessions return to admin sign-in.
Password recovery from admin sign-in opens the player recovery entry through a
full navigation, so its form remains reachable across the bundle boundary.

The same server runs `services/userPurge.ts` nightly at **03:00 UTC**, deleting
suspended accounts whose 30-day deadline has elapsed. No purge runs at startup;
overdue accounts are handled on the next nightly run. A database advisory lock
also covers expiry cleanup of `refresh_tokens`, including when no accounts are
due. An expiry index supports the sweep; revoked rows remain until their expiry
so rotation retries and replay detection retain their evidence. The lock
prevents concurrent sweeps; per-account transactions isolate failures, and row
locks/rechecks honor cancellation or rescheduling. The job deletes owned
characters/campaigns and their cascading children, credentials, memberships,
invitations and authored logs/effects. Other players retain their characters and
purchased library mechanics after an owned campaign disappears. Log deletions
in surviving campaigns reverse their earned-point awards, including recipients
who have since moved away; deleting an owned campaign preserves earned points
on surviving characters, matching ordinary campaign deletion. Remaining
campaign projections advance and post-commit WebSocket nudges accelerate sync.
Append-only audit history and sync tombstones are retained. Unattached images
are reclaimed by the existing media cleanup job; public cached copies may remain.
Failures are logged and stay scheduled for the following night.
Graceful shutdown cancels the next run and finishes the current account transaction.

Per architecture invariant, instance admin never ships in the
player client.

---

## Codebase map

```
src/
  build/pwaAssets.ts  Deterministic adaptive/Apple/favicon artwork and content-hashed installation URLs
  server/        Bun process — Hono routes, auth/OAuth, MCP, Drizzle, OpenAPI, WS
    index.ts     Bun.serve entrypoint; SIGTERM/SIGINT graceful drain (`shutdownServer`)
    lifecycle.ts Draining flag (readiness 503, `Connection: close`) during shutdown
    https.ts     Production HTTPS redirects and HSTS
    routes/health.ts  Liveness, database/migration readiness and release probes
    routes/      One file per resource group (auth, characters, campaigns,
                 campaignLibrary, invitations, notifications, notificationPreferences, sync, syncWs,
                 history, admin, adventureLog, characterSubResources, apiKeys,
                 health, encounters). campaignLibrary.ts is now a thin factory wiring:
                 campaignLibraryEntities.ts (per-entity-kind config: schemas,
                 DTO/insert/update mappers, natural key) and
                 campaignLibraryCrud.ts (generic POST/PATCH/DELETE route
                 registration + YAML upsert-by-key loop) consumed once per
                 entity kind.
    auth/        jwt, password, webauthn (passkeys), apiKey, session,
                 middleware, permissions (the authz helpers, incl.
                 tryLoadCampaignRole)
    oauth/       client configuration sync, PKCE authorization/grants,
                 opaque token rotation/revocation, discovery + consent routes
    mcp/         exact operation manifest/catalog, SDK transport, checked
                 snapshot, same-process shared-handler executor, and MCP Apps resource discovery
    services/    syncDispatch (the write chokepoint), wsBus, characterSummary,
                 notificationEvents, notificationEmails, notificationMaintenance
                 (durable audit fan-out, invitation/security mail and lifecycle),
                 userPurge (nightly account deletion and refresh-token expiry cleanup at 03:00 UTC),
                 defaultCampaignSources (new-campaign GURPS 4e source list),
                 libraryReferences (transactional source authorization for all
                 six character reference types plus nested item enchantments), ownedLibraryMechanics (saved
                 declarations, live updates and detachment),
                 (incl. loadCharacterDetail, the shared character-detail
                 loader), characterAccess (resolveCharacterView, the
                 shared full/minimal/forbidden decision), patchSet
                 (buildPatchSet, the shared PATCH-body-to-`.set()` helper),
                 entityWrites (per-entity insert/upsert-values builders
                 shared by REST and the sync dispatcher — AGENTS.md S12),
                 adventureLogAwards (transactional recipient selection, award
                 credit deltas and authorization),
                 characterChildren (per-class configs plus insert/update/
                 delete for library-linked character children and the
                 child-table map used by the cursor and replay lookups)
    db/          schema.ts (Drizzle), seeds/ (Lantern Coast recipe, conservative refresh/revision marker, REST/MCP adapters, data/accounts/tests),
                 migrations/ (hand-written SQL for
                 triggers), auditContext (withAudit), client, migrate, seed
    openapi/     app, emit, check (CI drift guard against docs/openapi.json)
  client/        React 19 PWA
    mcp-ui/      MCP Apps bridge, shared character composition, and focused item/library skill cards;
                 separate self-contained build via vite.mcp-ui.config.ts
    features/    Route-level screens grouped by domain (auth, characters,
                 campaigns, encounters, library, log, settings, history, home)
      campaigns/ Campaign workspace identity/navigation, overview, scoped
                 Log/Library/Import & export/History/Encounters routes, and GM dashboard
      library/   LibraryPage (catalog and transfer views, sticky category/search
                 toolbar, URL state), LibrarySection (generic sortable, grouped,
                 foldable table with memoized expandable rows),
                 sections/*Section (per-category columns, groups, details and
                 form wiring), useLocalLibrary (Dexie reads + local-first
                 outbox mutations with pre-enqueue validation),
                 libraryTablePreferences, useLibraryGroupFolds, librarySearch
                 (cached human-readable-field matcher), plus EffectsEditor, the
                 reusable ordered effect authoring UI shared with
                 character-owned trait mechanics, and LibraryFormFooter
                 (the Cancel/Add-or-Save actions every entry form shares)
      help/      CampaignLibraryHelpPage and campaign-library.md (in-app authoring guide)
      characters/CharacterCard.tsx  Shared character cards for home, listing, campaign roster and GM dashboard
      characters/SheetNavigation.tsx  Responsive desktop dock/mobile flower navigation
      characters/sheetAnchors.ts, SheetAnchorLink.tsx and InventoryAnchorLink.tsx  Stable entry hashes and routed source/equipment links
      characters/sections/inventory/ Inline category editors, field disclosure,
                                      structured Range inputs and transactional JSON-property mutations
      characters/sections/  Sheet-panel form plumbing shared across
                 Traits/Skills/Spells/Languages/Techniques/Inventory:
                 LanguagesPanel and TechniquesPanel (compact summary tables
                 with retained Add/Edit disclosures),
                 TraitsPanel and traitTablePreferences (searchable/sortable
                 compact traits table, inline editor, and per-character
                 device-only sort/custom order),
                 SkillsPanel (searchable/sortable compact table and inline
                 editor), skillTablePreferences and tablePreferences
                 (per-character device-only sort/custom order),
                 useSortableCharacterRows (shared skill/trait table behavior),
                 useAddEntityForm
                 (the add form), useEntityRowPatch (per-row field patch
                 dispatch, incl. useEntityEnumField for enum <select>s),
                 useConfirmedEntityDelete (row delete confirmation),
                 useClampedJsonbBumper (powerstone/magic-item charge
                  steppers), useTempEffects (the temporary-effects list
                  backing the Attributes panel's modifier popovers), shared
                 RollSheet/RollableRow/rollHistory (per-character
                  localStorage roll log) primitives, RollHistoryPanel (the History
                  sub-tab browser), and combat/
                  (CombatStatusProvider/CurrentStatusBar + CombatTab with
                   Defenses/Attacks/DrSummary cards, ArmorLocationMap +
                   IncomingDamageDialog)
    lib/statusBarPreferences.ts  Per-user, device-local Current Status display switches
    lib/theme.ts, lib/themeSync.ts  Dark/light mode (device-local) + synced
                 palette preferences store, server read/push and rejection toasts
    features/home/LandingPage.tsx  Public overview with canonical README screenshots
    features/settings/AppearanceSection.tsx  Settings theme pickers
    features/settings/NotificationsSection.tsx  Inbox/email controls and explicit desktop opt-in
    features/settings/ExperimentalFeaturesSection.tsx  Account-wide MCP UI opt-in
    lib/desktopNotifications.ts  Per-user browser opt-in, permission and delivery deduplication
    lib/editingFocusBounds.ts  Rich-text selection and textarea caret geometry for library focus scrolling
    features/library/  CalculationEditor, PricingResolver, RepriceEntry, WeaponModesEditor,
                 LibraryMetadataEditor, LibraryAdvancedFields, SkillRequirementsEditor,
                 ArmorFacetEditor, LibraryPackagesForms (language/technique/style authoring),
                 libraryFormErrors and source/modifier CatalogSection; category form files (Trait/Skill/Spell/Item/Enchantment/
                 ActiveEffectForm) used by the sync-backed library sections
    components/ui/Table.tsx  Default-enabled client-only column filter framework:
                 Table, TableHeader, TableBody/TableRow, source-value labels,
                 grouped row hiding, portaled value checklist and persistence
    components/CharacterHeaderChromeContext.tsx  Mobile header controls passed
                 into the portaled Current Status row
    sync/        orchestrator, outbox, libraryDependencies, patchKeys,
                 syncLog/syncLogPayload (bounded journal and lazy gzip bodies),
                 syncLogPresentation (subject routes/names and focused diffs),
                 onlineMutationLog (explicit online campaign/import diagnostics),
                 gestureBatch (explicit IDs for rapid pool-control bursts),
                 state, flashBus, minimalViewSweep,
                 wsSubscriber — the local-first engine
    db/          dexie.ts and syncEntityStore.ts — IndexedDB stores and shared
                 sync row lookup/writes (UI source of truth),
                  plus per-character device-only solo tracker scratchpads
    components/ui/AppIcon.tsx  Shared Lucide icon names, size and stroke conventions
    components/ui/BrandMark.tsx  Shared app mark used by player/admin/error chrome
    components/ui/SkillReferenceCombobox.tsx  Shared React Aria skill reference picker
                 and campaign-first suggestion merge
    components/ui/QueryReadError.tsx  Shared retryable online-read error
    hooks/       useDraftField (canonical draft-on-blur), useDraftToggle,
                 useUnsyncedChangesGuard (confirmed session cleanup),
                 useAppHeaderBottom (live sticky-header offset),
                 useSelectedCampaignId (legacy Log/Library campaign URL selection),
                 useFlashState (shared flash-pulse primitive the draft
                 hooks build on), useFlashGroup (visible summary feedback
                 for retained language/technique editor rollbacks), ...
    components/  Shared UI (FoldSection: device-persisted folding without unmounting,
                 sync indicator/log, notifications bell,
                 SwUpdatePrompt (new-build toast), ui/*, markdown/ —
                 sanitized markdown renderer + Tiptap WYSIWYG markdown
                 editor used by the adventure log)
    admin/       Separate admin SPA entry; AdminRequireAuth guards HTTP-only pages without player sync
  shared/        Pure TypeScript — runs in Bun, browser, AND service worker
    schemas/     Zod schemas — the wire contract (sync.ts is the sync protocol;
                 libraryMechanics.ts validates synced character-owned declarations)
    syncProtocol.ts  Sync protocol version + header; `/sync/*` answers 426 to
                 an outdated build, which then force-reloads onto the current one
    format/      number.ts — formatSigned/formatScaled, the shared
                 sign/scale number formatters used by both client display
                 code and shared warning text
     domain/      GURPS math (characterCalc, skillCalc, spellCalc, itemEnchantments, activeEffects, skillProcedures,
                  techniqueCalc (level from default skill + points offset for
                  A/H difficulty), encumbrance,
                  traitCost, modifierMath, poolBump, warnings, diceRoll (3d6 +
                   success-roll evaluation + NdM damage-dice rolling),
                   rangedRange (typed Range resolution, migration and B550 bands),
                   damageParse (weapon damage-string parsing/resolution +
                   the cut/imp/piercing 1-point damage floor), defenseCalc
                   (Dodge/Parry/Block, explicit-or-fuzzy weapon-to-skill
                   matching via `resolveWeaponSkill`, `skillDisplayName` for
                   specialization-disambiguated skill names, ST-shortfall
                   penalty, equipped-shield picking), combatAdjustments (pool,
                   posture, stun and maneuver limits on live defenses and Move), injuryCalc (incoming-
                   damage DR/divisor/wounding-multiplier resolution for the
                   Incoming attack panel's damage dialog), armorDr (armor + innate DR
                   aggregation per hit location + per-damage-type DR
                   resolution via `resolveDr` with typed → crushing →
                   default fallback, facing-aware DR aggregation, and the
                   location/facing-aware maximum armor DB via `resolveArmorDb`),
                   conditions (snake_case
                   condition normalization, tolerant of legacy Capitalized
                   entries))
    constants/   attributes, skills, traits, combat (postures, common
                 conditions, maneuvers), hitLocations (+ aim penalties),
                 rangePenalty (B550 reference steps), magic
    yaml/        library.ts — round-trippable campaign-library YAML codec
    history/     summarize.ts — shared history one-liner formatter
  sw/            Service worker registration and app-shell precache. It never
                 caches authenticated API responses, does not replay the
                 outbox, and excludes API/MCP/OAuth/discovery routes from its
                 navigation fallback. Mutable worker/bootstrap/HTML entrypoints
                 are served no-store; hashed assets remain cacheable. Outbox
                 replay lives in the page orchestrator; see src/sw/registerSW.ts.
skills/          Portable GPC workflow skills, client metadata, and synthetic eval cases
tests/
  skills/        Eval-grader regression tests, run by skills:check and CI
  acceptance/    Explicit full Lantern MCP seed check, outside normal CI discovery
  e2e/           Real browser acceptance, geometry and local-first interaction regressions
docs/
  specs/         These design specs
  screenshots/   Screenshot capture notes; canonical images are in public/screenshots/
  prototypes/    Standalone design studies, outside the app build:
                 armor-preview.html (interactive SVG armor-location proposal)
  openapi.json   Emitted OpenAPI contract (CI-checked; generation skips database maintenance)
  agent-skills.md  Skill packaging and independent behavioral-eval instructions
  mcp-tools.json Emitted MCP catalog (CI-checked; generation skips database maintenance)
public/
  screenshots/   Canonical app captures shared by the landing page and README
scripts/
  gpc-skill-evals.mjs  Validate cases, prepare blind inputs, and grade model traces
  run-bun-tests.ts, run-client-tests.mjs  Test execution with native case reports and command wall timings
  start-built-test-server.ts  Compiled browser acceptance server with real notification processing
  check-pwa-package.ts  Mandatory post-build manifest/icon/precache/admin-isolation verification
  capture-screenshots.mjs  Refresh canonical captures from a seeded local app
  release-image.sh  Pin and verify a candidate image, then promote its tested digest
  seed-lantern-mcp.ts  NDJSON connector bridge for the shared Lantern recipe (one existing owner)
bootstrap/
  sample_library.yaml   Seeded into the "Sample" campaign
  lantern_coast.yaml    Synthetic Lantern Coast library and four fictional sourcebooks; bootstrap/README.md lists seven demo accounts
```

Read the top-of-file doc comments — most load-bearing modules
(`orchestrator.ts`, `outbox.ts`, `dexie.ts`, `syncDispatch.ts`,
`minimalViewSweep.ts`, `library.ts`) open with a precise description of their
contract and the bugs they exist to prevent.

---

## Architecture at a glance

- **One process, one origin.** The Bun server hosts HTTP + OAuth + MCP +
  WebSocket + OpenAPI + static client. Do not split it.
- **Postgres 18 only.** No SQLite, no cross-DB shims. IDs are `uuidv7()`
  server-defaults (the concrete PG18 dependency); the schema also uses
  `GENERATED ALWAYS AS … STORED` columns. `AGENTS.md` frames PG18 as headroom
  to "lean on" (e.g. `MERGE…RETURNING`); not all of that is used yet.
- **OpenAPI is the contract.** Every route uses `createRoute` from
  `@hono/zod-openapi`; CI fails on drift against `docs/openapi.json`.
- **Shared code is pure TS.** Anything in `src/shared/` must run in Bun, the
  browser, and the service worker — no DOM, no Bun globals, no DB clients, no
  env access.
- **Local-first always.** Every UI mutation for a sync-backed class writes
  IndexedDB + the outbox first. The server is a durable mirror, not the render
  path.
- **WebSockets are acceleration, not correctness.** WS frames only invalidate;
  the HTTP cursor pull + outbox replay is the source of truth.
- **History is a required baseline.** Every syncable entity participates in the
  append-only audit log via DB triggers.

Full detail: [architecture.md](architecture.md).

---

## Orientation notes for future sessions

The standard `bun run db:seed` refreshes the Sample library and creates a populated
Lantern Coast campaign with six separately owned characters, eleven library categories,
four fictional sourcebooks with distinct abbreviations, current pricing snapshots,
30 traits, 48 skills, five shared session entries and three private journal entries
per character, and an experimental encounter. Each fresh sheet has 12–15 skills
and 6–8 traits within its 250-point starting budget plus six earned points and the
campaign's disadvantage/quirk caps. Skill procedures use supported task modifiers,
actions, prerequisites and level benefits; social privileges and physical outcomes
explicitly require manual adjudication. Active-effect
demonstrations remain stored with the active-effects experiment off. See the
[seed guide](../../bootstrap/README.md) for credentials and test cases. Creation is
transactional and serialized; existing Lantern campaigns are skipped by owner/name
so test edits survive reruns. Campaign/character fixtures use the normal API
handlers for validated writes, owned mechanics, history and revisions.
The explicit `bun run db:seed:lantern:refresh` upgrades recognized older defaults
once while preserving edits, deleted older content and play state; its transactional
revision marker makes subsequent runs no-ops, preserving later deletions too.
Ordinary seeding does not refresh existing Lantern campaigns.

Before a new development task on local `main`, fetch and fast-forward from
`origin/main` as prescribed in [AGENTS.md](../../AGENTS.md), preserving local
work. Re-read project instructions and relevant specs changed by that update.

The armor-location design study at [prototypes/armor-preview.html](../prototypes/armor-preview.html)
opens directly in a browser without dependencies or a build. It previews all 15
standard hit locations, character-relative left/right, linked silhouette/label
selection, sample DR breakdowns, keyboard controls, and the original Arcane dark/light palettes.
Three live head-shape alternatives (Rounded, Angular, Inset face) preserve the
separate skull, face, and eye targets; upper arms have clear shoulder gaps even
with their selection strokes visible.
Both eyes share the existing `eye` location. It uses a generic humanoid base;
custom body plans are not represented in its silhouette. The rounded design is
now integrated in the Combat tab with real armor data and incoming damage;
this standalone study retains illustrative data and alternative head designs.

Things that repeatedly surprise people working in this repo:

1. **Sync coverage is partial and deliberate.** The character family
   (`character`, `character_trait`, `character_skill`, `character_spell`,
   `character_language`, `character_technique`, `character_inventory`,
   `character_combat`) and all eleven `campaign_library_*` classes flow through
   the outbox; library edits are whole-entry patches (`AGENTS.md` S13) and the
   library YAML import is the one online-only library action. Campaigns
   are pulled into Dexie and only `coverAssetId` writes use the outbox; the adventure log, invitations, and
   notifications are still **online-only** React-Query/HTTP surfaces. The `entityClass` enum lists more than the orchestrator pulls —
   that's headroom, not coverage. The authoritative list is `ALL_ENTITY_CLASSES`
   in `src/client/sync/orchestrator.ts`. Confirm before assuming offline
   behaviour. (`AGENTS.md` S0.)

2. **Never write a second draft-on-blur pattern.** `useDraftField.ts` is
   canonical: it queues same-field edits, syncs per-field only when clean, and
   fires toast+flash on rollback. Extend it; don't fork it.

3. **A rollback is a UX event.** Any undo of a user-typed value must fire
   **both** a persistent toast (naming the field + reason) and an input flash.
   Toast-without-flash and flash-without-toast are both bugs. (`AGENTS.md` rule
   2 / S5.)

4. **Adding a syncable entity class touches ~6 sites** (schema enum, Dexie,
   orchestrator switches, outbox switches, server dispatcher + cursor reader,
   purge list) **plus** the history checklist (trigger, `SYNCABLE_TABLES`,
   `summarizeEvent`, `withAudit`). Only the client store map
   (`STORE_BY_ENTITY_CLASS`) fails typechecking on a miss; nothing else catches
   one — follow the `AGENTS.md` S6 and H1–H5 checklists end-to-end or you get
   silent data loss.

5. **REST and sync share primitives, not every handler.** Sync writes use
   `dispatchOperation()` in `syncDispatch.ts`; REST routes also perform writes
   directly using shared services. Trait, skill, spell, language and technique
   writes on both doors go through `services/characterChildren.ts`. Both must run inside `withAudit(...)` so DB triggers
   can attribute the change. History capture sits *below* both via Postgres
   triggers.

6. **The share gate is enforced three ways.** `decideCharacterAccess`
   (server, `sync.ts`) decides `full` vs `minimal` and the server
   `projectCharacterRow` ships only identity fields for minimal rows;
   `characterIdsToMinimize` + the orchestrator's character-row rewrite
   (`minimalViewSweep.ts` + `orchestrator.ts`) purges already-cached private
   child rows **and** rewrites cached character rows down to identity so
   stale `st`/`hpMod`/`tempEffects`/`activeConditionGroups` can't be recovered locally; and the
   UI discovery surfaces filter minimal rows off `/characters` and onto the
   campaign detail page. Changing one without the others reopens a leak
   hole.

7. **Dev + tests run in Docker.** There is no host `bun` requirement. The
   `scripts/dev-worktree.sh` wrapper gives each checkout a stable, isolated
   Compose project and host ports. The Compose `deps` service installs from
   the frozen lockfile while PostgreSQL starts; client tests can start with
   `deps` alone. `bun test` covers `src/server` +
   `src/shared`; the Compose `client-tests` profile runs the full Vitest
   suite under Node 22 and fails on zero discovered tests; Playwright
   covers e2e. `bun run check` = lint + typecheck + **`bun test`
   (server+shared only)** + OpenAPI and MCP drift checks — it does **not** run the client
   vitest or Playwright suites, so run those separately for client changes.
   Per-PR GitHub CI includes client tests and the production build, and
   runs the client job alongside server/build with only one PostgreSQL service;
   the existing required `build` check waits for both. Test commands retain timings
   under `.local/test-results/`, uploaded by CI. The complete Lantern MCP seed
   scenario lives in `tests/acceptance/lantern-coast-mcp.test.ts` and runs via
   `bun run test:acceptance:mcp-seed` as a mandatory agent pre-PR check outside CI.
   CI intentionally omits browser installation/automation. PR authors run relevant
   Playwright coverage locally, using `bun run test:e2e:built` after building for
   broad passes and `PLAYWRIGHT_REVIEW_ARTIFACTS=1` for required visual review;
   promotion to a named image release runs the
   delegated OAuth/MCP/offline Chromium acceptance against the selected source
   image before creating any release tags or aliases.

8. **When in doubt, read the file's top comment and the relevant `AGENTS.md`
   rule** before editing — most invariants are annotated at the call site
   precisely because they were broken once.

9. **Viewport-sized is not viewport-contained.** Anchored overlays use
   `useViewportBoundedOverlay` plus dynamic-viewport max dimensions and wrapping;
   test the open overlay's actual bounding box at narrow and breakpoint widths.
   Document `scrollWidth` alone cannot detect every clipped absolute overlay.

---

## Maintaining these docs (required)

These specs are a **living description of the current state**, not a
point-in-time design record. Keeping them accurate is a firm project
requirement — see the "Design specs are a maintained requirement" section in
[`AGENTS.md`](../../AGENTS.md). In short: any change that alters user-facing
features, the sync/sharing/history architecture, the codebase layout, or an
orientation note above must update the relevant spec **in the same change**,
and this overview's feature catalog and codebase map must not drift from
reality.
