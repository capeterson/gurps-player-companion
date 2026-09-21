# README screenshots

Captured on 2026-09-19 from `fa28dd6` plus this PR's character-view cleanup, running the development
Docker Compose stack at `http://localhost:3001`. These are real Chromium
screenshots of the application, not mockups. No production account or campaign
was used. Rowan, Kestrel Vale, Mira Ashfall, Bram Stonebridge, and The Lantern
Coast are fictional demo data created locally for these captures.

| File | Surface | Theme | Image size |
| --- | --- | --- | --- |
| `armor-desktop.png` | Combat → Defense & Damage Resistance; cutting damage against torso mail, graphical coverage, defense table | Dark | 1224 × 1148 |
| `combat-mobile.png` | Character Combat tab, HP/FP, posture and maneuver | Dark | 430 × 932 |
| `damage-mobile.png` | Incoming damage; 10 cutting damage against torso DR 4 previews 9 injury | Dark | 430 × 932 |
| `inventory-desktop.png` | Inventory with worn/equipped items and supplies nested in a trail pack | Light | 1224 × 1114 |
| `campaign-desktop.png` | Campaign roster and formatted adventure log | Light | 1440 × 920 |

Desktop captures use a 1440-pixel-wide browser; armor and inventory images are
complete panel captures. Mobile captures use a 430 × 932 viewport. All images
use device scale factor 1. The damage dialog is a preview; its Apply button was
not pressed.

The [standard seed](../../bootstrap/README.md) now includes an enriched version
of this campaign and party with stable demo accounts. Its extra equipment,
mechanics, and play state go beyond these original captures.

Navigation previews captured on 2026-09-20 from `91a9b92` plus the themed-icon
and responsive-navigation changes use that standard seed, in the isolated
development stack at `http://localhost:13063`. These are real Chromium captures
with device scale factor 1 and fictional local data.
The mobile preview was refreshed the same day from `36ff3e1` plus the permanent
label update, with all eight labels visible without hovering.

| File | Surface | Theme | Image size |
| --- | --- | --- | --- |
| `navigation-desktop.png` | Character Combat section with the floating section dock and orbit sync indicator | Dark | 1440 × 1050 |
| `navigation-mobile.png` | Expanded character navigation flower with permanent labels beneath every icon | Dark | 390 × 844 |

When refreshing these images:

1. Update from `origin/main` and start the local app following the root README.
2. Use a dedicated local demo account and fictional content. Populate the
   character with trained weapon skills, equipped armor, and nested inventory;
   include enough campaign content to show the roster and adventure log.
3. Wait for the initial sync and fonts to finish. Verify loaded weapon counts,
   armor layers, and pools before capturing; do not screenshot empty bootstrap
   state. Fold unused panels using the app's normal controls.
4. Capture both mobile and desktop, including the graphical armor view and an
   incoming-damage calculation. Use a tall enough viewport for panel captures
   so sticky navigation does not overlap their content. Check every image.
5. Keep the asset names stable, update this date/revision/dimension record, and
   review the root README with a GitHub-flavored Markdown renderer. Update its
   captions and alternative text if the pictured behavior changes.
