# Design Spec: Interaction Architecture

This document records the shared presentation and editing patterns of the
character sheet. It is a companion to [architecture.md](architecture.md) and
[offline-sync.md](offline-sync.md): presentation controls how users reach their
data, while the local mirror and outbox remain the data path. Languages and
Techniques apply these patterns alongside the Skills and Traits tables.

## Character cards

Home, the Characters listing, campaign overview roster, and GM dashboard use
`features/characters/CharacterCard.tsx`. Its shared shell matches the Characters
listing: portrait/name linked to the sheet, a separate campaign link, and a
single compact ST/DX/IQ/HT line. Long character and campaign names wrap inside
the card. Grid breakpoints remain appropriate to each surrounding page.

The roster evaluates the local share gate before displaying attributes, so
minimal viewers keep an identity-only card even before the masking sweep runs.
Masked rows awaiting rehydration also omit attribute placeholders. The GM
wrapper supplies effective attributes and appends pools, secondary stats,
conditions and lookup results inside the same shell. Its name link opens a new
tab; missing mechanics show the existing unavailable notice and hide numbers.
Long unspaced names in character change summaries wrap inside the GM activity
feed, including when it appears below the cards on narrow viewports.

## Identity images and campaign settings

The Overview Identity panel pairs a compact portrait or neutral silhouette with
the character name. Below 640px they stack to keep the name input readable;
wider layouts place them side by side. For character editors the portrait is a keyboard-accessible
button opening a centered native dialog. Image upload, removal, recovery controls
and file-sharing help belong inside that dialog. Closing it leaves local-first
image work intact; rollback feedback also flashes the visible portrait trigger.
Readers see the image or silhouette without editing controls. Shared notifications
portal into the active native dialog so rejection toasts remain visible and
dismissible above its backdrop; they return to the page when the dialog closes.
The notification stack is bounded by the dynamic viewport and scrolls internally
when multiple messages exceed its height.

Campaign settings uses a centered, wide native dialog with wrapping Campaign,
Rules, and Members section buttons. The header, section buttons and Save/Cancel
actions stay visible while the body scrolls. Sections remain mounted to retain
form drafts. Owner cover editing and image help live only in Campaign; covers in
workspace headers are display-only. Offline owners can enter the dialog to edit
covers, with unavailable online preferences disabled and member actions hidden.
Cover selection queues immediately and separately from the settings Save action.
At viewport heights of 500px or less, the fixed header compacts to the settings
label and a 44px Close control. The complete campaign name moves into the
scrollable body, which also contains a reduced cover preview so the labeled
upload input remains usable above the persistent Save/Cancel actions.

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

## Magic collections

Magic uses a full-width shared Spells table and plain section headings, without
outer folds, nested cards, or per-spell Description disclosures. One toolbar
shows the spell count, points, and an owner-only Add spell action. The retained
add form starts closed. Search matches spell names, colleges, and notes; column
headings sort and expose the shared exact-value filters. Sorting preferences are
device-local and cleared at logout.

Spell summaries show name, college/difficulty, points, rollable level, effective
casting cost, effective upkeep, and recorded casting time. Points become name
metadata below 1024px; time moves into metadata below 1280px. Below 640px the
name and level stay aligned, costs/time wrap below the name, and Cast/Maintain/
Edit occupy one horizontal action row. Long names wrap; there is no page-wide
horizontal scroller. A free upkeep is 0, while absent upkeep is an em dash.

The name opens a bounded, read-only reference dialog with rendered Markdown,
prerequisites, duration, base-to-effective costs, and level modifiers. Its
compact close control stays pinned on an opaque surface that reaches the
dialog's inner top edge while the full spell heading and long reference content
scroll inside the dialog. The pencil
opens a labeled inline editor for name, difficulty, points, base cost, and
Markdown description/notes. Deletion lives in that editor and requires the
existing confirmation. Editors stay mounted when closed or filtered; Done
closes rather than atomically saving. Each field uses the canonical draft/outbox
path, and a hidden editor's rollback also flashes the visible summary. Spell
anchors reveal and highlight their row through filters without entering edit mode.

The level opens the existing Roll Sheet. Cast and Maintain open a separate
energy-payment dialog with Source/Available/Spend columns and an explicit Pay N
energy or Record free cast/maintenance action. Rolling and payment remain
separate; no automatic success resolution or maintained-spell tracker is added.
Below 640px, the available pool appears beneath its source name, leaving room
for readable names beside the Spend input. Short viewports scroll within the
dialog while keeping its payment and cancellation actions reachable.
Unknown campaign mana and unlearned legacy spells still hold casting. Existing
mana, failure-cost, powerstone, and fatigue rules are unchanged.

Powerstones and Magic items use compact shared tables with plain headings and
Inventory links for full editing. Existing drain/recharge/Max and Use/Refill
controls remain outbox-backed. An empty Magic items section is absent.
Below 640px, adjustment controls move to their own row so long item names retain
the available width beside energy or charges.

Adventure-log Markdown tables keep a readable 36rem minimum width and scroll
horizontally inside the log body or raw-Markdown preview. This local scroller
keeps the final columns reachable on narrow screens without imposing wide
tables on other Markdown surfaces.

## Named protection sources

Incoming attack's **Protection before penetration** lists eligible innate DR by
its contributing source's actual name, with one row per source ID and source kind.
Multiple declarations from the same source are summed for the selected location;
inactive and out-of-location declarations are omitted. Trait, skill, and item
sources use the sheet's stable entry links; active-effect instances retain named
plain text. Armor layers and natural skull protection retain their existing rows.

A trait link selects the Traits destination, opens its folded panel, reveals the
owned row despite search/column filters, and highlights it. Editing remains an
explicit action. `SheetAnchorLink` shares the router-aware anchor behavior with
existing equipment links and supports ordinary anchors outside a router.

## One heading and one interaction per purpose

Overview's Attributes, Secondary attributes, and Status cards are always visible
inside the outer Sheet overview disclosure. Each owns one heading without an
individual fold. The adjacent utility column sizes to its content: folded Point
ledger, Encumbrance, and Conditional effects show only their headings rather
than stretching to the stat cards' height. Conditional effects owns its fold and
is absent unless the campaign active-effects experiment is enabled and condition
groups are declared. Its explanation identifies trait
effects and Combat → Active Effects as the sources of those optional modifiers.
Campaign settings has the owner-only **Enable active effects** experiment, off by
default. Disabled campaigns hide character activation/conditional tools and experimental
guide sections. Owners retain archived library definition authoring and conditional
declarations; these declarations do not apply while activation is disabled.
Rollback feedback flashes that panel even while its content is folded.

Identity's Description defaults to sanitized markdown with navigable links.
Owners open the existing rich/source editor through a labeled pencil action;
Done editing description commits through `useDraftField` and restores the
rendered view. Once opened, the hidden editor stays mounted to preserve draft
and mode. The visible description wrapper receives rollback flashes in both
view and edit mode. Read-only viewers receive no editing action.
Description rollback reconciliation reads the durable local field through
`useDraftField` rather than relying on a live query observing every intermediate
value. A newer draft or commit supersedes an in-flight reconciliation read.

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
sheet destination rather than introduce another navigation surface. Magic
collections use plain headings; details and editors open only on explicit actions.

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

The public landing hero scales its headline through the 640px breakpoint so
the two advertised phrases remain on their intended lines at tablet and desktop
widths. The desktop heading grows when its text column has enough room; short
landscape layouts keep the heading inside the initial viewport.

The editable identity name remains a single-line field, using 30px display type
below 640px and 48px from 640px up. Compact Combat retains its 24px name size.
Long editable names scroll within the input; read-only identity headings wrap
long unspaced names within the content width.

Library source selection and search share a wrapping toolbar. The search input
and **Clear search** button stay together, taking a separate row when needed.
Library technique default-penalty and level-cap help wraps within each field on
narrow screens.
Sourcebook selection labels wrap long unspaced titles beside fixed-size
checkboxes within the import/export card.
Entry metadata keeps the **Sourcebook** picker and compact **Page** input on
one row at every width. The picker takes the available space; Page is 4rem wide
below 640px and 5rem from 640px up. The normal editor does not expose definition keys.
Library group labels and row summaries wrap long unspaced categories. Citations
sit beside the type/points summary under each name at every width, visible while
collapsed, and wrap within the name cell on narrow screens.
The Sources list has no category heading or group folding; its sourcebook rows
appear directly below the column heading.
Fold chevrons and counts retain their width; description excerpts stay truncated.
Help and About prose wraps long external links inside its content column.
Focused library form fields retain their draft and stay below the sticky toolbar
after rotation, visual-viewport resizing, and keyboard focus changes. Only an
obscured active editing field is scrolled into the remaining working area.
Long rich-text and raw Markdown editors use the editing caret rather than the
whole editor's bounds, preserving the selection and draft while resizing, moving
the selection, and typing, including horizontal panning during pinch zoom.
Form actions reserve the same toolbar offset when scrolled or focused.
When the toolbar would occupy more than half the visible area below the app
header, it scrolls with the document and field offsets reserve only the header.
Pinning returns when the viewport has enough room.

Audit-history summaries and actor names wrap without truncation. On phone
widths, the actor uses an indented second line so the timestamp and summary keep
their reading width; wider rows keep the actor beside the summary.

Adventure-log titles, author names, and locations wrap within their cards even
when the text contains no spaces.

Long account names remain width-bounded in the shared header at all breakpoints;
opening the account menu must not horizontally scroll the page. The home welcome
heading wraps unbroken account names within its card.

Detailed encounter NPC and effect forms open in the native dialog top layer, above the
sticky app header. Their height stays within the dynamic viewport, with internal
scrolling for long forms, and Escape closes the dialog and its controlled state.
Closed native dialogs are removed from layout, so their previous viewport
dimensions cannot widen the page.

Encounter initiative cards keep long unspaced combatant names within their grid
column at phone, tablet, and desktop widths; names wrap while the acting badge
and combatant controls remain available without page-wide horizontal scrolling.

Summary rows use a fluid name column and compact value/action columns. Long
names and references wrap rather than shrinking to a few letters or forcing
the whole page to scroll horizontally. At narrow widths, secondary metadata
can sit below the name with visible labels. Spoken and written language
fluency remain distinguishable. Technique points and roll levels remain easy
to scan beside the name; governing skill and default line remain readable.
Expanded trait and skill editors also wrap their complete **Edit** headings,
including long unspaced names, within the editor's content width. Trait modifier
names and descriptions wrap inside the expanded editor when they contain long
unbroken text.

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
Expanded inventory editors wrap long unspaced item names in the header while
keeping the **+ Category** and **Done** actions inside the viewport. At the
desktop-table breakpoint, item names and category chips may flow onto separate
lines so a narrow item column does not compress a chip into one letter per line.
Expanded editors contain their intrinsic inline size so their input grids do not
force a wider table; nested fieldsets and enchantment pickers can shrink within
the available editor width, including the 640px breakpoint. Long enchantment
references in row summaries also wrap without setting a minimum column width.

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

Character inventory alternate attack modes and the device-only solo tracker
generate client IDs through the shared safe ID helper, so creating them also
works on non-secure HTTP IP origins where `crypto.randomUUID()` is unavailable.
Long unspaced solo-tracker combatant names wrap inside the tracker, and armor
names in the protection-layer breakdown shrink and wrap beside their DR values.

Inventory uses `useTableRowMatches` to share the table's existing predicate.
Search and column filters retain the ancestors of matching entries, and hide
excluded rows without unmounting their editors. Category chips remain the
route to category editors. **+ Category** lives in the item-details editor the
pencil opens, rather than repeating on every row.

Inventory editor copy uses player-facing attack names and source references.
Primary and alternate attack IDs remain internal, are generated for new attacks,
and are preserved when names or stats change. Alternate attacks use plain stat
labels within numbered **Alternate attack** groups. Enchantments show their source
reference (or Campaign library/Character sheet origin), not snapshot revisions;
effect choices describe the affected stat. Magic activation and range choices use
readable labels while retaining their stored enum values. Item pricing uses
**Recalculate price**, saved price/weight summaries, and labeled costs/weights with
units in the existing dialog; trait pricing uses **Recalculate points**. Editors
omit generic save/persistence explanations.

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
The shared overlay hook measures available visual-viewport width before collision
handling; each overlay combines that cap with its existing width limit so pinch
zoom can shrink it and zooming out can restore it. Ref attachment installs the
measurement listeners even when a panel mounts after its parent hook.
Downward-opening panels can opt into the shared overlay hook's available-height
measurement. The notification bell, account menu, compact character/app menu,
and posture/maneuver/conditions panels use it to scroll within the remaining
visual viewport below either a single-row or wrapped mobile header, including
after rotation and pinch zoom. Menu items
remain in one column while their panel scrolls.

The closed mobile sheet-navigation FAB shares the desktop dock's layer below
the sticky header and its popovers. HP/FP endpoints and explanatory text remain
readable when a short landscape viewport places them over the FAB. Opening the
navigation raises its flower above the header and its dismissal backdrop;
native modal dialogs hide the sheet navigation.
HP/FP adjustment panels also cap their height to the remaining visual viewport,
with internal scrolling that keeps endpoints, explanations, and controls reachable
after pinch zoom and rotation.
Temporary modifier popovers also use shared vertical collision handling and
visual-viewport height caps below the sticky header so their Clear and Apply
controls remain reachable.
Native dialogs retain `showModal()` and its focus trap; the shared dialog hook
centers their grid within the visual viewport during zoom, panning, and resizing.
Dialog size preferences are capped by that visible area, with internal scrolling.

The shared `InfoTooltip` supports scrollable recipient lists in adventure-log
award summaries and the attachment visibility explanation. These tooltips retain horizontal collision handling, constrain
height and vertical position to the visual viewport below the sticky app header,
and allow pointer and keyboard scrolling. Hover, focus, or tap opens the list;
Escape dismisses it.

## Verification and file map

The MCP Apps character view (`src/client/mcp-ui/`) uses the same read-only
collection panels, stat cards, Markdown, and inventory rows as the web app.
`CharacterIdentityDetails` supplies identity fields to both the limited sheet
and embedded view. Read-only inventory rows have one **Details** action opening
`InventoryItemDetails`, with notes, effective armor/weapon blocks, container and
magic-item information. Editable rows retain their existing editing interaction.
The embedded shell receives authorized server snapshots through the MCP Apps
bridge rather than reading the PWA mirror; its refresh repeats the same read tool.
Focused item/container and campaign-library skill results use one compact card
without sheet navigation. Container contents reuse nested read-only inventory
rows, and `LibrarySkillDetails` is shared with the campaign library's disclosures.
Its section controls wrap at narrow widths. It does not render a sheet dock or
app header, and all inherited overlays remain bounded to the iframe viewport.

Panel tests assert visible summaries, Add/Edit disclosures, preserved drafts,
read-only behavior, create/delete payloads, validation, roll access, and the
save-success/rejection/concurrent-edit guarantees. Browser tests exercise the
actual sheet, long representative names, narrow widths and breakpoint edges,
and the geometry of open library, skill-reference, and filter menus. Screenshots
are inspected alongside bounding-box and overlap assertions.

| Primitive or surface | Implementation |
|---|---|
| Character cards across home, listing and campaign views | `src/client/features/characters/CharacterCard.tsx`, `src/client/features/campaigns/GmCharacterCard.tsx` |
| Sheet composition and panel folds | `src/client/features/characters/CharacterSheetPage.tsx`, `src/client/components/ui/FoldSection.tsx` |
| Table filters and grouped row lifetime | `src/client/components/ui/Table.tsx` |
| Skill/trait summary and editor references | `src/client/features/characters/sections/SkillsPanel.tsx`, `TraitsPanel.tsx` |
| Spells, reference and energy payment | `src/client/features/characters/sections/SpellsPanel.tsx`, `CastSpellDialog.tsx`, `spellTablePreferences.ts` |
| Stored energy and magic items | `src/client/features/characters/sections/PowerstonesPanel.tsx` |
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

## Account experimental features

Settings has one **Experimental Features** section with an **MCP UI** toggle.
The description explains the embedded character/item/container/skill cards.
Features start off. Loading, read-error/retry,
and rollback feedback use the standard settings patterns. `useDraftToggle`
retains rapid same-field changes and flashes the visible checkbox with a toast
on failure. This online account preference is outside the local-first sheet
and library outbox.

## Racial templates

Race uses one control in Overview Identity and a centered bounded preview/Apply dialog. Variants, compatible lenses and alternate forms compose a single purchase; Human is the baseline. Race-only skill projections are read-only. The library authoring form uses visual component rows and shared metadata controls. See [races.md](races.md).

## Complete library authoring drafts

Every category uses one complete schema-backed entry draft, grouped by purpose.
Typed nested controls cover all supported unions, recursive prerequisites,
procedures, calculation expressions, records and exact string lists. Optional
rules distinguish **Not specified**, **None**, and **Set value**, including
specialization inheritance versus an explicit empty default list. Switching a
rule branch retains its previous draft; array rows keep stable editing identities
while reordered. Numeric drafts retain incomplete text until corrected.

The subtle **Raw YAML** disclosure edits the same whole-entry draft. Sourcebook
references use portable labels in source view and named pickers in normal forms.
Malformed YAML stays visible and blocks saving until repaired or explicitly
replaced with the last readable draft. Readable but invalid shapes remain editable
and receive actionable validation on Save. Manual Save validates the complete
entry before the existing local-first whole-entry outbox mutation.

Armor and weapons retain their visual editors; their detail toggle opens complete
typed fields. Nested controls do not add a second raw YAML utility. The package
editor stages coordinated edits across categories and uses the existing online
import preview and confirmation, preserving a failed package for correction.
