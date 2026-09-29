# Design Spec: Interaction Architecture

This document records the shared presentation and editing patterns of the
character sheet. It is a companion to [architecture.md](architecture.md) and
[offline-sync.md](offline-sync.md): presentation controls how users reach their
data, while the local mirror and outbox remain the data path. Languages and
Techniques apply these patterns alongside the Skills and Traits tables.

## Read first, edit on demand

A sheet collection shows its owned entries before asking the player to create
or edit anything. Compact summary rows keep names, useful mechanical values,
and actions available together. The toolbar shows a count and, where useful,
the total points. One explicit **Add language** or **Add technique** action
opens the creation form; it starts closed even for an empty collection. The
empty state names the missing collection and leaves that same Add action
available, rather than adding another creation control.

Each editable row has an **Edit** action that opens labeled fields below its
summary. **Done** closes the editor. These are presentation actions: existing
fields commit on blur, or on change for a select, through `useDraftField`.
Done is not an atomic Save button. Deletion lives inside the editor and uses
the shared confirmation dialog. Canceling deletion preserves the entry and
its drafts. A read-only viewer sees summaries and may roll resolved technique
levels, without creation, editing, or deletion controls.

Languages show name, spoken fluency, written fluency, and points. Techniques
show name, governing skill, difficulty/default line, points, and the resolved
level. The level uses `RollLevelChip` and the panel's single `RollSheet`, as
Skills does. A missing governing skill leaves the level unavailable rather
than inventing a roll target. Library-derived level caps remain part of the
owned technique's calculation.

## One heading and one interaction per purpose

`FoldSection` owns the panel heading, fold button, and device-local fold
preference. Languages and Techniques do not repeat their title as an eyebrow
and another large heading inside that section. Their inner toolbar carries
the count, points, and creation action. The existing Skills and Traits
collections are the references for table summaries and row disclosures;
older panels may still have their own inner title treatment.

Sorting, filtering, creation, editing, and rolling are distinct actions. Do
not add a second selector for an action already served by a column heading,
or another display for the same mechanical utility. Keep movement in movement
and defenses in defenses. A collection redesign should reuse the existing
sheet destination and fold rather than introduce another navigation surface.

## Tables are shared architecture

Use `components/ui/Table.tsx` for data tables. `TableHeader` supplies column
filters; sortable collections compose those with `SortableHeader`. Filtering
preferences are device-local and scoped by character/campaign/table identity,
never server fields or outbox operations. Action columns are ordinary headers.

Wrap each summary and its editor in one `TableBody` with declarative
`filterValues`, so a filter hides both together and leaves draft state
mounted. Values describe the owned row, not text scraped from editor inputs.
The framework supplies the accessible filter menu, active indicators,
no-match message, and **Clear all filters** action.

Languages have independent language, spoken, written, and points filters.
Techniques have technique, default skill, difficulty, default modifier,
points, and level filters. Compact layouts keep filters on their visible
columns; metadata columns and their filters appear at the wider table breakpoint.

## Draft lifetime and save feedback

For Languages and Techniques, closing an add form, closing a row editor,
filtering an entry, or folding a section hides its content without discarding
its mounted state. Reopening
returns to the draft. Pending saves can finish while a disclosure is closed.
State is scoped to the character, so switching characters cannot reuse the
previous character's form or row expansion state.

Creation forms use `useAddEntityForm` and snapshot guards: a successful create
clears only fields still matching the submitted value. Text typed while
creation is pending survives. A local validation error keeps the form and
typed value available for correction; it does not silently substitute another
value. Add submissions stay in the form for adding another entry.

Row fields use `useEntityRowPatch` and its shared `useDraftField` adapters.
Same-field commits serialize, different fields save independently, and server
refreshes cannot overwrite newer local intent. Save failures name the field
and reason in a toast and flash the affected field. Languages and Techniques
also flash the visible summary through `useFlashGroup` when a retained editor
is closed. Their add form and toolbar share the same creation flash state, so
a rejection stays visible after the add form closes. Sync rejection records
persist across reloads. These guarantees belong to the shared hooks and
outbox, rather than a second panel-specific save implementation.

Language creation keeps the fluency-based suggested points and explicit
override. Technique creation keeps its library default skill, difficulty,
default modifier, and optional level cap. Their controls clarify those values
without changing the shared calculation rules.

## Responsive layout and accessibility

Summary rows use a fluid name column and compact value/action columns. Long
names and references wrap rather than shrinking to a few letters or forcing
the whole page to scroll horizontally. At narrow widths, secondary metadata
can sit below the name with visible labels. Spoken and written language
fluency remain distinguishable. Technique points and roll levels remain easy
to scan beside the name; governing skill and default line remain readable.

Expanded editors use a responsive grid with full field labels such as
**Difficulty**, **Default modifier**, and **Points**. Creation uses the same
field treatment and a separate action footer. Inputs and grid children allow
shrinking (`min-w-0`, `w-full`) and summary text allows word wrapping. Use the
app's existing daisyUI components and semantic theme colors; avoid bespoke
palettes, nested decorative cards, and additional display fonts.

Inventory preserves its desktop columns and uses a compact two-line item row
below 640px: name and chips on the left, weight over quantity and cost on the
right, then the edit action. Quantity 1 is implied rather than repeated, and
the units (`lb`, `$`, `×`) replace per-row column labels. Long names and chip
text wrap at every width so the table also fits at the desktop breakpoint.

Each row leads with a 20px slot holding the container chevron (whose hit area
extends to a touch-sized target) or an item-type icon. Each nesting level
indents one step, and a faint guide line runs under every ancestor's chevron
through the full row height. The guides are CSS backgrounds derived from the
row's `--inventory-depth`, so they need no sibling bookkeeping and stay correct
while filtering or collapsing; depth is capped on narrow screens so deep trees
keep room for names. A collapsed container shows its contained-item count.
Containers carry only a faint tint, not another typeface or palette. The tree
is presentation over flat table rows, rather than an invalid nested table or a
second editing surface.

Inventory uses `useTableRowMatches` to share the table's existing predicate.
Search and column filters retain the ancestors of matching entries, and hide
excluded rows without unmounting their editors. Category chips remain the
route to category editors. **+ Category** lives in the item-details editor the
pencil opens, rather than repeating on every row.

Disclosures expose `aria-expanded` and `aria-controls`; row actions include
the entry name in their accessible label. Tables have accessible collection
names, and form fields have programmatically associated labels. Icon-only
actions keep a descriptive accessible name and a usable touch target.

Library selection uses `LibraryAutocomplete`; governing skills use
`SkillReferenceCombobox`. Their shared portals and viewport collision handling
keep suggestions above navigation and inside the visual viewport. A closed
form or folded section must not leave an autocomplete floating over the page.
See the overlay rules in [AGENTS.md](../../AGENTS.md): dynamic viewport size
limits alone do not establish containment.

The shared `InfoTooltip` supports scrollable recipient lists in adventure-log
award summaries. These tooltips retain horizontal collision handling, constrain
height and vertical position to the visual viewport below the sticky app header,
and allow pointer and keyboard scrolling. Hover, focus, or tap opens the list;
Escape dismisses it.

## Verification and file map

Panel tests assert visible summaries, Add/Edit disclosures, preserved drafts,
read-only behavior, create/delete payloads, validation, roll access, and the
save-success/rejection/concurrent-edit guarantees. Browser tests exercise the
actual sheet, long representative names, narrow widths and breakpoint edges,
and the geometry of open library, skill-reference, and filter menus. Screenshots
are inspected alongside bounding-box and overlap assertions.

| Primitive or surface | Implementation |
|---|---|
| Sheet composition and panel folds | `src/client/features/characters/CharacterSheetPage.tsx`, `src/client/components/ui/FoldSection.tsx` |
| Table filters and grouped row lifetime | `src/client/components/ui/Table.tsx` |
| Skill/trait summary and editor references | `src/client/features/characters/sections/SkillsPanel.tsx`, `TraitsPanel.tsx` |
| Languages and techniques | `src/client/features/characters/sections/LanguagesPanel.tsx`, `TechniquesPanel.tsx` |
| Inventory responsive item layout | `src/client/features/characters/sections/InventoryPanel.tsx`, `InventoryRow.tsx`, `inventory/inventory.css` |
| Draft serialization and rollback feedback | `src/client/hooks/useDraftField.ts`, `src/client/features/characters/sections/useEntityRowPatch.ts` |
| Visible rollback feedback for closed disclosures | `src/client/hooks/useFlashGroup.ts`, `useFlashState.ts` |
| Creation and confirmed deletion | `src/client/features/characters/sections/useAddEntityForm.ts`, `useConfirmedEntityDelete.tsx` |
| Library and governing-skill selection | `src/client/components/ui/LibraryAutocomplete.tsx`, `SkillReferenceCombobox.tsx` |
| Anchored overlay containment | `src/client/hooks/useViewportBoundedOverlay.ts` |
| Shared theme and fold presentation | `src/client/styles/theme.css` |

For a future collection, reuse these primitives before adding a new control
or save path. Maintain this document when the shared interaction contract
changes; collection-specific behavior also belongs in the overview catalog.
