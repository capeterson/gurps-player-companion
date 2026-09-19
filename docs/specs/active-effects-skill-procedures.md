# Active effects and skill procedures

Campaign owners manage reusable active effects in Library → Active Effects. Each
has description, source, tags, numeric declarations, typed capability declarations,
duration, and an explicit stacking key/policy. Character owners apply a definition
or author a custom effect from the Combat tab. Source inventory links are optional;
applying an effect does not consume the item. A deleted source item remains a
historical reference and does not prevent subsequent instance edits.

## Persistence and ownership

Definitions live in `campaign_library_active_effects`, with the normal library
CRUD, ownership checks, revision invalidation, YAML v11, and campaign history.
`/campaigns/{id}/library/active-effects` supports POST and its `/{effectId}` route
supports PATCH/DELETE. The aggregate library GET lists definitions. MCP exposes
all three mutations through the shared handler graph.

Instances live in the separate `characters.active_effects` JSONB field. This is
intentionally distinct from the existing manual `temp_effects` adjustments.
`activeEffectsField` validates a maximum of 100 unique instance IDs. Each instance
owns its numeric mechanics, capabilities, provenance/version, state, applied time,
remaining rounds or wall-clock expiry, source inventory ID and notes.

The root JSON design reuses the character's existing revision, audited trigger,
REST/sync authorization, cursor projection, conflict rollback and logout purge.
`mutateActiveEffects` reads the latest character inside the same Dexie transaction
as the outbox write. Independent local instance/property gestures therefore compose
before the whole-field patch coalesces. Same-field in-flight follow-ups use the
ordinary outbox queue; cursor pulls preserve pending intent. A rejected patch
restores the previous array and emits both a persisted toast and field flash.
Cross-device conflicting arrays use the existing visible conflict policy; this is
not a field-level merge between different devices.

Linked writes resolve definitions authoritatively in the character's current
campaign. Library edits refresh owned mechanics and advance character revisions
inside the audited library transaction. Applied duration is instance state and does
not restart on a definition edit. Deleting/replacing definitions, campaign transfer,
campaign deletion and membership removal detach links while preserving snapshots.
An explicit independent copy also retains source provenance. Minimal character
projections clear the entire field; history requires full access.

Campaign cursor rows carry a validated, read-only `activeEffectDefinitions`
projection. This uses the existing campaign store, revision invalidation, access
pruning and logout purge. The picker can use those saved templates after an offline
reload. Existing applied instances always calculate from their own saved mechanics.

## Resolution and duration

`domain/activeEffects.ts` is shared by server and browser. Active, non-expired
numeric declarations enter the same attribute/skill/weapon pipeline as traits.
Capabilities have stable keys, labels, optional parameters and sense/resistance/
capability kinds; they appear in a separate summary, never as guessed numeric stats.
The existing condition-group controls include active-effect declarations and now
commit their toggles through the root character outbox.

Stacking uses explicit keys, never display names. Additive keeps every contribution.
Highest selects the greatest signed value per exact target/selector and deduplicates
identical capabilities. Replace uses the latest applied timestamp, breaking ties
by UUID. Mixed policies resolve conservatively: replace before highest before
additive. Independent keys remain independent.

Wall-clock expiry is checked when constructing the sheet, when its nearest expiry
arrives in an open view, and when the document returns to the foreground. No closed
app timer is assumed. The writable Combat panel reconciles elapsed effects to
`expired` through the outbox; expired/inactive rows stay inspectable. Reactivation
starts a fresh duration. Round effects can be advanced explicitly or by a forward
round change in the solo tracker. Previous-turn navigation never resurrects an
expired effect. Manual temporary stat adjustments retain their existing behavior.

## Skill rules

`campaign_library_skills.procedures` contains bounded `modifiers`, `actions` and
`benefits` arrays. It is validated at REST/YAML writes and included in the owned
`libraryMechanics.skillRules` snapshot, so edits, deletion/detachment, transfer,
MCP and offline calculation share the existing skill-library lifecycle. Missing
arrays remain compatible. The library skill form exposes a validated structured
rules editor alongside descriptive prose. Legacy flat situational modifiers migrate
to opt-in task rules, retaining labels and source text.

`schemas/skillProcedures.ts` and `domain/skillProcedures.ts` define and evaluate:

- Fixed, selected-range, per-difference (factor/step/rounding), non-overlapping
  interval-table, and reference values. References without an authoritative value
  remain unapplied until the player/GM supplies one.
- Bounded predicates over task, equipment, environment, familiarity, movement, TL,
  character, skill, trait and campaign inputs. Unknown or false context never
  silently applies a rule. No arbitrary formulas, scripts or prose are executed.
- Per-rule and accumulated-group floors/caps and deterministic additive, highest, lowest or explicitly
  chosen exclusive groups. Mixed group policies remain unapplied with a diagnostic.
  Fractional calculated modifiers truncate toward zero before becoming skill levels.
- Separate base-level, task-roll, contest, damage and time destinations. Task and
  contest modifiers affect the roll preview only. Damage/time declarations are
  displayed for adjudication; they do not silently mutate other character fields.

Skill actions appear separately from notes and describe skill/attribute/other-skill
roll bases, time, resource costs, contests and bounded outcomes. Numeric actions
open the shared roll sheet with source text and required-context controls. Roll
previews retain the base target, per-rule provenance, applicability and choice
status. Time/cost/outcome previews do not automatically spend resources or adjudicate
an opponent's contest; prose-only procedures remain explicit and expose their
structured details without offering a fabricated roll. After a roll, the shared
outcome evaluator selects matching success/failure/critical and signed-margin
bounds and supplies `task:margin` to numeric outcomes. Ordinary success/failure
outcomes also apply to their corresponding critical results.

Relative/absolute level, purchased points and specialization determine unlocked
benefits. The shared detail builder evaluates them against the pre-benefit sheet
(including base modifiers), then applies their declared effects exactly once in a
second calculation pass. A benefit cannot unlock itself through its own attribute
or skill bonus. Attribute, point, modifier and specialization changes recalculate
this state in both server and local detail builders.

## Verification

Domain tests cover all modifier forms, context categories, deterministic stacking,
expiry, representative combat/recovery/movement/healing/throwing/social actions,
benefit thresholds and YAML. PostgreSQL tests cover definitions, owned snapshots,
authorization, privacy, history and lifecycle changes; MCP runs its operation matrix.
Client tests exercise local persistence, coalescing, stale cursor protection,
rollback notices/flashes, purge and roll previews. Chromium coverage exercises
application offline, reconnect, skill action context and expiry.
