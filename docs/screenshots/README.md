# README and landing-page screenshots

The five current product screenshots live only in `public/screenshots/`. The
root README links those exact files; the unauthenticated landing page serves
those same assets at `/screenshots/`. Refresh them together by replacing the
canonical files, never by adding a second copy under `docs/`.

Captured on 2026-09-27 from `7bafafa` plus the Overview, theme-picker,
campaign-transfer confirmation, adventure-point awards, and landing-page changes
in this change. These are real Chromium screenshots, not mockups, captured from
this checkout's isolated `gpc-179510909` development stack at
`http://localhost:20909`, using the migrated and locally seeded
`gurps` database. All pictured accounts, characters, and campaigns come
from the fictional [standard seed](../../bootstrap/README.md); no production
account or campaign was used.

| Canonical file | Surface | Theme | Image size |
| --- | --- | --- | --- |
| `armor-desktop.png` | Complete Incoming attack panel: torso protection, coverage map, active defenses, and cutting-damage controls | Gilded Tome | 1224 × 1284 |
| `combat-mobile.png` | Kestrel Vale's Combat section, current HP/FP, weapon attacks, and mobile navigation | Gilded Tome | 430 × 932 |
| `damage-mobile.png` | Incoming-damage preview: 10 cutting damage against torso DR 5 yields 7 injury | Gilded Tome | 430 × 932 |
| `inventory-desktop.png` | Complete Inventory panel, worn/equipped equipment, and expanded three-level trail-pack contents | Illuminated Manuscript | 1224 × 1506 |
| `campaign-desktop.png` | Lantern Coast campaign overview, rules, roster, and workspace navigation | Illuminated Manuscript | 1440 × 920 |

Desktop panel captures use a 1440-pixel browser width and a tall viewport so the
floating sheet dock does not overlap the pictured panel. Mobile captures use a
430 × 932 viewport. Device scale factor is 1. The damage dialog is a preview;
its Apply button is never pressed. Theme mode changes and container expansion
use the application's real controls; no screenshot content is mocked or styled
for the capture.

## Refresh both public surfaces

1. Update from `origin/main` and follow the root README to start this checkout's
   isolated stack. Run migrations and `bun run db:seed` in that same stack.
   Use the populated Lantern Coast seed with unchanged sample equipment.
2. Install Playwright's Chromium browser in the environment running the capture.
   The screenshot script uses the existing `playwright` dependency and accepts
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing Chromium executable.
3. Use `./scripts/dev-worktree.sh info` to obtain this checkout's app URL. Run:

   ```sh
   PLAYWRIGHT_BASE_URL=http://localhost:YOUR_PORT node scripts/capture-screenshots.mjs
   ```

   Run in an environment with the project's dependencies available. A custom
   `PLAYWRIGHT_MODULE` path can locate an existing Playwright installation; the
   default imports `playwright`. Set `TMPDIR` to disk-backed temporary storage
   when the host's `/tmp` quota is small, as described in `AGENTS.md`.
4. The script signs in once as `rowan@example.invalid` using the documented seed
   password and reuses the same page for every surface. If this local seed
   account's password changed, set `SCREENSHOT_SEED_PASSWORD`. Do not use a real
   player's credentials. The script refuses a non-local base URL.
5. Inspect every output at its actual dimensions. Verify that fonts, equipment,
   armor, nested items, and the three-character roster loaded correctly; check
   that sticky navigation does not overlap panel content. The script prints
   each PNG's dimensions. Update this provenance table and the landing page's
   image width/height attributes whenever the dimensions change.
6. Open both the unauthenticated `/` page and the root README in a Markdown
   renderer. Update captions and alternative text when the pictured behavior
   changes. Future theme/layout changes must refresh these same assets for both
   surfaces in the same change.

## Historical navigation studies

The retained `navigation-desktop.png` and `navigation-mobile.png` under this
folder document the earlier Arcane navigation design; they are not current
README or landing-page assets. They were captured on 2026-09-20 from `91a9b92`
plus themed-icon and responsive-navigation changes, using the fictional standard
seed at `http://localhost:13063`. The mobile image was refreshed from `36ff3e1`
plus permanent labels that day. Both use device scale factor 1.

| Historical file | Surface | Theme | Image size |
| --- | --- | --- | --- |
| `navigation-desktop.png` | Combat section with floating dock and orbit sync indicator | Arcane Dark | 1440 × 1050 |
| `navigation-mobile.png` | Expanded flower navigation with permanent icon labels | Arcane Dark | 390 × 844 |
