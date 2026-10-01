---
name: gpc-character-advancement
description: Build or advance a GURPS character in GPC using campaign rules, available points, library definitions, and the player's chosen concept. Use for character creation or spending earned points, rather than general rules questions.
---

Use the connected GPC tools to turn a character concept or advancement goal into specific, affordable changes.

## Establish the character and constraints

Resolve names with `list_characters` / `list_campaigns`, then read `get_character` and `get_campaign`. Tool names can have a client prefix; use the connected tool's actual name and advertised schema. Disambiguate duplicate names before selecting a target. A minimal character view does not contain a usable point budget or private skills: explain the access limitation rather than guessing.

Use the character's returned `points` breakdown, point cap, awards, warnings, and effective values. An uncapped campaign's zero remaining-points value is not a zero spending allowance; ask for a budget if the user has not supplied one. Search `get_campaign_library` by relevant section and name, paging when necessary. Distinguish complete definitions from references, source editions, restricted entries, and unknown rules.

## Plan and apply

For an advice request, propose changes with their incremental costs and remaining allowance without writing. Preserve the concept and campaign limits; do not increase the campaign target or dismiss warnings to make a purchase fit. Owned skill points are the new total invested, not points to add. Increasing an existing skill costs the difference between its old and new invested totals. For approved existing skills with known rules, the returned investments and budget are enough to propose spending; consult library definitions when a linked rule or purchase choice is missing, rather than blocking ordinary point increases on a library lookup. Honor required specialization/TL, prerequisite messages, technique caps, and source pricing inputs. Unknown defaults are not the same as no defaults. GPC owns derived calculations: never patch effective levels, derived stats, or pricing snapshots.

An explicit request to apply specified upgrades authorizes those upgrades; do not ask for the same approval again. Clarify missing choices that affect the purchase. Use `character` and the corresponding `character_skill`, `character_trait`, `character_spell`, `character_language`, or `character_technique` action. A character skill copy must still supply the create schema's required fields and the selected `librarySkillId`; let GPC capture provenance and enforce rules.

Give each logical mutation an `idempotencyKey`. After a lost response, retry the identical request with the same key; changed intent needs a new key. Stop on authorization or rule rejection, and report any earlier successful changes. Re-read `get_character` after acknowledged writes to verify spending and effective values. An acknowledgement alone is not a refreshed sheet. Present the chosen upgrades and unresolved choices concisely, using a sheet card only when the broader sheet is useful.
