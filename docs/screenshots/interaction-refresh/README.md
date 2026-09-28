# Character-sheet interaction refresh

Review captures for the Languages, Techniques, and mobile Inventory changes.
These are implementation evidence rather than replacements for the canonical
landing-page screenshots in `public/screenshots/`.

`tests/e2e/languages-techniques-inventory.spec.ts` captures the running development
app with representative fixture entries. The scenario reuses one account and
page across narrow widths and the 640px, 768px, and 1024px breakpoint boundaries,
checks visible controls and open-overlay geometry, and exercises the real
creation, editing, rolling, and inventory interactions.

| Capture | View |
|---|---|
| [Languages and techniques](languages-techniques-mobile.png) | Compact mobile summaries with creation forms closed. |
| [Mobile inventory](inventory-mobile.png) | Reclaimed item width and compact quantity/weight/cost rows. |
| [Desktop inventory](inventory-desktop.png) | Existing desktop table columns. |

The maintained UI contracts and primitive map are in
[interaction-design.md](../../specs/interaction-design.md).
