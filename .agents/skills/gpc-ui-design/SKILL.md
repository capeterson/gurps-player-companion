---
name: gpc-ui-design
description: Implement or review GURPS Player Companion interface changes using the project's established layout, copy, navigation and calculation expectations. Use for sheet UI, forms, menus, tooltips and responsive visual regressions; exclude game-rule authoring and backend-only work.
---

# GPC UI design expectations

Apply this project skill alongside the installed official daisyUI guides. Read
[AGENTS.md](../../../AGENTS.md) and the relevant parts of
[interaction-design.md](../../../docs/specs/interaction-design.md) first.
Preserve the requested surface, existing controls and draft behavior. These
expectations come from observed regressions and explicit user preferences.

## Layout and visual hierarchy

- Compare neighboring card edges, row starts, spacing and content density.
  In Overview, keep paired stat cards aligned and avoid the empty hole caused
  by placing a short Attributes card beside a taller Secondary attributes card.
  Use available width to arrange the secondary values into fewer rows before
  adding empty height. Keep folded utilities at their content height.
- Select columns for the space the content actually receives, including nested
  card padding. More desktop columns are not automatically better. Prefer a
  readable two-column Overview over four narrow, uneven cards.
- Let numeric values and their modifier controls wrap as a group when necessary;
  never overlap adjacent values, clip controls or assume a sample value is the
  maximum supported value. Keep editable values close to their own action.
- Saving feedback must not reflow an editor or anchored popup during a click.
  For skill points, use the existing row action icon for saving status; adding
  a caption on blur can move a contributor link between pointer down and up.
- Use the established daisyUI components, semantic theme colors, spacing and
  typography. Fix the layout structure rather than adding decorative cards,
  per-item offsets, arbitrary minimum heights or a new design system.
- Button labels such as Reload retain their natural width and stay on one
  line. Flexible messages shrink and wrap; actions and dismiss controls keep
  enough space. Small release labels belong beside the existing save/sync
  action as muted secondary text, using the actual release source.

## Context and copy

- Calculation blockers name the affected owned entries and held results. Group
  overlapping armor pieces with their affected body parts, and use the shared
  `locationLabel` from `src/shared/constants/hitLocations.ts` rather than raw
  location keys. Missing linked-rule notices identify the affected traits/skills;
  bulk validation blockers identify the invalid rows instead of asking the player
  to search the whole sheet or package.

- A table row already identifies the entry. Expanded skill, trait, spell,
  language and technique editors start with labeled fields; do not repeat
  “Edit Diplomacy” or another title. Inventory keeps its category title without
  repeating the item name. Retain descriptive accessible names on controls.
- Remove captions that narrate obvious controls: “Fields save individually.
  Done closes the editor”, “Level opens a roll”, click/sort/drag instructions,
  and “Add your first below”. Empty states name what is missing.
- “Up to 250 rolls — saved on this device only and never synced.” is another
  example of bad UI text: routine storage limits and sync details do not help
  the average user make a choice or act. Omit this caption and equivalent wording.
- Do not reintroduce the declined notes about condition sources, multiple item
  categories, note-only enchantments, preview actions, device-only roll history,
  solo-tracker storage, desktop notification prerequisites or separate cover
  saves. Do not replace removed filler with equivalent wording elsewhere.
- Keep actionable errors, calculation results, necessary rule limits, permission
  restrictions and destructive-action warnings. Include technical details only
  when they explain a real choice or an actionable problem. If copy is genuinely
  borderline, show the exact wording to the user while completing clear edits;
  do not delay authorized fixes for routine copy approval.

## Navigation and calculations

- App updates never reload the page automatically, even when the server refuses
  an old sync protocol. Use the existing persistent `SwUpdatePrompt` toast with
  its Reload button; preserve drafts and queued edits until the user acts.
- Keep destination menus for navigation. The compact character menu starts
  with account name/email and omits the character name already in the breadcrumb.
  Put the light/dark control in the upper-right header, outside that menu.
- Extend the existing interaction for a utility. Follow AGENTS.md's rule against
  duplicate sorting, coverage, movement or other controls.
- When editing skill points, preview the net skill value and its actual
  contributors as the draft changes. Include the winning default, training,
  governing attribute and relevant adjustments; do not present a partial sum
  as the final value or save a draft just to preview it.
- Link named contributing skills, traits, equipment, races, active effects and
  attributes to their real sheet targets with the shared sheet-anchor helpers.
  A click should reveal the destination through folds and filters. Preserve
  useful source links instead of substituting plain names or metadata badges.
- Use the shared viewport-bounded overlay helper. Tooltip content must scroll
  when necessary; every contributor link must remain reachable, and the popup
  must avoid its input, fixed header and sheet navigation.

## Review before handoff

For a geometry fix, open the real interaction with representative long names,
unmodified and modified values, and collapsed/expanded disclosures. Cover the
reported viewport and just below/at/above the changed breakpoints. Check visible
card alignment, control containment and overlap; document scroll width alone
does not prove a layout works. Inspect screenshots at affected sizes as well as
browser assertions, in the relevant existing light and dark themes.

Reuse synthetic fixtures and one authenticated account/page across widths.
Delegate test execution as required by AGENTS.md. Select tests for the changed
behavior, preserve save/rollback coverage, and update the living specs in the
same change. A CSS-class assertion or a test matching this skill's wording is
not a substitute for a visible interaction or geometry check.

## Growing this skill

Add a narrow, reusable expectation after a demonstrated regression or explicit
user decision. Explain the failure it prevents and point to a maintained shared
primitive or meaningful regression test when one exists. Revise stale guidance
instead of accumulating contradictory rules; keep screenshots and private
character examples out of the skill. New user instructions take precedence.
