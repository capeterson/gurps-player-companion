---
name: gpc-encounter-prep
description: Prepare a GPC campaign encounter from a GM's roster, NPC statistics, initial conditions, and timed effects. Use for encounter setup or revision, rather than automatically running combat or changing player character sheets.
---

Turn the GM's encounter description into the requested tracker state, preserving hidden information and the current turn.

## Gather the encounter inputs

Use the connected tools' actual names and current schemas. Resolve and read `get_campaign`, search `list_encounters`, and read `get_encounter` when modifying an existing encounter. Campaign owners/managers control encounters. A player read projection masks hidden NPCs and private PC combat values; never infer them or bypass that projection.

PC combatants reference roster character IDs; let GPC populate their permitted stats. NPC creation needs name, Basic Speed, DX, and maximum HP. Resolve missing required stats before the dependent write, and distinguish user-approved invented NPC stats from published/library facts. Preserve `hiddenFromPlayers` for a hidden ambusher and any hidden-caster information. An experimental tracker being disabled does not authorize changing campaign settings.

## Set up the tracker

A draft request stays read-only. An explicit setup/update request authorizes the described encounter changes without another approval gate. `encounter` creation can include the entire PC/NPC roster; reuse an existing encounter only when the user intends to revise it. `encounter_combatant` and `encounter_effect` actions update existing state. Effects target encounter combatant IDs, not character IDs. Read the newly created encounter to resolve combatants before adding effects.

Preserve explicit duration units (rounds, minutes, hours, indefinite), maintenance cost, caster, and visibility. Do not convert durations using an assumed turn length. Encounter effects and character active effects are separate; adding a tracker effect does not justify altering HP, FP, conditions, or temporary effects on player sheets.

Preparation does not advance turns or end combat. If the user explicitly asks for a turn advance, use the returned version, round, and active combatant as concurrency preconditions. On conflict, re-read and explain the changed state; do not automatically substitute fresh preconditions and advance a different turn.

Use one `idempotencyKey` per logical mutation; retry lost responses with identical arguments and the same key. After acknowledgement, re-read the encounter to verify roster, hidden flags, effects, and active turn. Stop on authorization/validation rejection and report partial completion. Present the roster and starting conditions relevant to the audience; omit hidden NPC details from a requested player-facing briefing.
