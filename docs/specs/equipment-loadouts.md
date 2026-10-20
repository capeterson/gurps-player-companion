# Equipment loadouts

A loadout is a named set of a character's inventory items. **Equip** puts the
whole set on the player and equipped in one gesture; the state it replaces is
kept as **Last Equipped** so the switch can be reversed. GURPS action economy
(readying, donning) is not automated.

## Behaviour

- **Equip.** Every loadout item that is not on the player (Stashed, at an
  external location, or nested under a stashed root) moves alone to the root of
  On the player. Items already carried, including inside a carried container,
  stay where they are. A container brought in carries its contents; contents are
  never pulled out of a container the same switch brings in. Loadout items with
  nothing carried (quantity 0) stay unequipped and are named in the toast. Every
  other equipped item is unequipped without moving.
- **Last Equipped.** Restoring returns the items the switch moved to their
  earlier parent and location and re-equips the previous equipped set (moving
  any of those that have since left the player back onto it). An item whose
  recorded container is gone, no longer a container, or would form a cycle keeps
  its place and is named in the toast. A restore produces its own record, so
  Restore toggles between the two states.
- **Active loadout.** The last equipped loadout is remembered. The Loadouts
  button shows its name, `font-semibold text-primary` while the equipped items
  exactly match the loadout and `italic text-base-content/60` once they differ.
  The changed state has a tooltip ("Also equipped: …", "Not equipped: …") whose
  item names link to their inventory rows. After a restore the button shows the
  loadout that was active before the switch, or "Loadouts".
- **Toasts.** Equip: "Equipped Melee: 2 equipped, 1 unequipped, 1 moved." plus
  skipped items and "Encumbrance now Medium." when the level changes (same
  player-carried weight and labels as the Inventory header). The Equip toast has
  a **Restore** action.
- **Menu.** A dropdown in the Inventory toolbar, beside Add item: one row per
  loadout in manual order with a drag handle (drag, or ArrowUp/ArrowDown on the
  focused handle), **Equip** and an edit pencil, then **Restore Last Equipped**
  (once a switch exists) and **New loadout**. Read-only viewers, including the
  guest preview, see names and the active state only.
- **Editor.** Inline below the toolbar: Name (`useDraftField`), an item
  checklist grouped On the player / Stashed with the inventory tree and a name
  filter (each check saves immediately), and **Delete loadout** with an inline
  confirmation. New loadout starts named "New loadout" with the currently
  equipped items, with its name selected.
- Limits: names 1–80 characters (duplicates allowed), 50 loadouts per
  character, 1000 items per loadout. Deleted items' ids are ignored and dropped
  by the next checklist edit.

## Data model

- `character_loadouts` (migration 0073; sync class `character_loadout`, Dexie
  v18 `characterLoadouts`): `name`, `item_ids` (`loadoutItemIds`), `sort_order`
  (double; a move writes its new neighbours' midpoint, renumbering only when the
  gap is exhausted), with revision, tombstone, history and preview-guard
  triggers.
- `characters.last_equipment_switch` (`equipmentSwitch`): kind, active and
  previous loadout ids and names, `previousEquippedIds` and each changed item's
  `before`/`after` equipped, worn, parent and external location. It is Last
  Equipped, the remembered active loadout and the switch's undo journal.

Planning and validation are pure shared code (`src/shared/domain/loadouts.ts`):
`planLoadoutSwitch`, `planLastEquippedRestore`, `equipmentSwitchProblem`
(every `before` matches, the recorded equipped set is current, parents are
containers of this character, no cycles, nothing equipped off the player),
`loadoutDelta` and ordering helpers.

## Writes

- **PWA.** Loadout create/patch/delete use the outbox. A switch is one patch of
  `lastEquipmentSwitch` planned and applied locally in one Dexie transaction;
  ordering, the S4 cursor guard and rollback are described in
  [offline-sync.md](offline-sync.md#equipment-loadout-switches).
- **Server.** `services/loadouts.ts` serves REST (`routes/characterLoadouts.ts`)
  and the sync dispatcher. Writes take the character's inventory lock, reject
  ids of another character's items, and apply a switch atomically or refuse it
  (an identical replay is acknowledged). REST/MCP equip and restore plan the
  switch on the server.
- **REST/MCP.** `GET/POST /characters/{id}/loadouts`,
  `PATCH/DELETE /characters/{id}/loadouts/{loadoutId}`,
  `POST …/{loadoutId}/equip`, `POST …/restore-last-equipped`; MCP
  `get_character_loadouts` and the `character_loadout` task tool. See
  [mcp-agent-access.md](mcp-agent-access.md#equipment-loadouts).

## Sharing and history

Loadouts and Last Equipped are private sheet data: minimal viewers receive
neither (cursor, minimal sweep, 403 on the list), see
[campaign-content-sharing.md](campaign-content-sharing.md). The guest preview may
read the list. History summarizes loadout edits and folds each switch with its
item changes under "Equipped loadout Melee" / "Restored Last Equipped"; see
[history-tracking.md](history-tracking.md#equipment-loadouts).

## Tests

`shared/domain/loadouts.test.ts`, `routes/characterLoadouts.test.ts` (REST,
sync guards, stale/atomic switch, share gate, history batch), the MCP parity
matrix, `sync/orchestrator.loadouts.test.ts`,
`features/characters/sections/inventory/Loadouts.test.tsx`, and
`tests/e2e/inventory-loadouts.spec.ts` plus the guest preview spec.
