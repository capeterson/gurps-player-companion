# Active effects and skill procedures

Active effects are an experimental campaign feature. The owner opts in through
**Campaign settings → Experimental features → Enable active effects**
(`experimentalActiveEffects`). Migration `0064_experimental_active_effects.sql`
adds a non-null boolean defaulting to false for every existing campaign; new
campaigns also default false. Missing cached flags, unresolved campaigns, and
campaignless characters are disabled.

While disabled, Overview's Conditional effects, Combat's Active Effects, the
library category/pickers/forms, conditional authoring rows and previews, and the
experimental help section are hidden. Shared server/player/GM calculations ignore
active instances and condition-gated declarations (including their capabilities),
regardless of stored state. Automatic expiry and solo-turn instance advancement
stop. Manual `tempEffects`, permanent mechanics, skill procedures, and the
separately gated turn tracker remain independent.

The setting is owner-only, online-only, audited, and propagated through REST and
the read-only campaign cursor into Dexie. Turning it off retains definitions,
instances, and selected condition groups. Re-enabling resolves saved state against
the current time; wall-clock durations are not paused. Dedicated definition CRUD
and character instance/group writes reject with 403 while disabled, through shared
REST/sync/MCP handlers. Empty defaults on ordinary character creation remain valid.
YAML import/export and read/history/sync payloads retain stored data without enabling
the experiment; import previews omit the disabled category. Archived conditional
trait/skill declarations may still be stored but cannot contribute while disabled.

When enabled, campaign owners manage reusable active effects in Library → Active Effects. Each
has description, source, tags, numeric declarations, typed capability declarations,
duration, and an explicit stacking key/policy. Character effect instances can be applied and managed in the sheet’s
Combat → Active Effects panel, alongside their API, MCP, sync and calculation model.
The panel supports library and custom effects, notes, activation/deactivation, expiry,
independent copies, removal and explicit round advancement. Reactivation starts a new
duration; advancing the optional turn tracker also advances round effects when
the active-effects experiment is enabled. Source inventory links are optional; applying an effect
does not consume the item. A deleted source item remains a historical reference and
does not prevent subsequent instance edits.
The definition form marks its name and stacking key as required, focuses a missing
field after Save, and explains how shared keys combine effects.

## Persistence and ownership

Definitions live in `campaign_library_active_effects`, with the normal library
CRUD, ownership checks, revision invalidation, YAML import/export, and campaign history.
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
reload. Enabled applied instances calculate from their own saved mechanics.

## Resolution and duration

`domain/activeEffects.ts` is shared by server and browser. Active, non-expired
numeric declarations enter the same attribute/skill/weapon pipeline as traits.
Capabilities have stable keys, labels, optional parameters and sense/resistance/
capability kinds; they appear in a separate summary, never as guessed numeric stats.
Overview → Conditional effects lists named condition groups declared by owned
trait effects and active-effect numeric/capability declarations. It is absent
when there are no groups, and its compact disclosure explains these sources.
Checking a group saves `activeConditionGroups` through the root character outbox
and enables declarations requiring that group; unchecking disables them. This
same control is also available inside Combat → Active Effects. The condition
group is a player-controlled rules gate, independent of Current Status conditions such
as Stunned. An inactive or expired active-effect instance still requires
activation in Combat → Active Effects before its checked group can contribute.

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
