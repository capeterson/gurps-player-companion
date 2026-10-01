# PWA package audit — September 30, 2026

Scope: source configuration, actual production build, public deployment HTTP
responses, Chromium manifest/installability diagnostics, offline worker behavior,
installation artwork, launch/responsive presentation, update discovery, and
account/admin boundaries. The public deployment was inspected read-only; the
fixes described here require deployment before installed devices can receive them.

## Findings and corrections

| Finding | Impact | Correction |
|---|---|---|
| No adaptive Android icon | Android cannot use the mark as a full adaptive launcher icon; default padding/background can change its appearance. The ordinary artwork also extends outside the circular crop-safe zone. | Separate opaque 512px `maskable` artwork, sized against the circle rather than a rectangular inset. Keep 192/512px `any` icons separate. |
| Stable icon URLs across artwork updates | Chrome 144+ treats unchanged manifest icon metadata as unchanged artwork, even when PNG bytes and cache headers change. | Derive filenames from the asset contents; new artwork produces new manifest icon URLs automatically. |
| Duplicate manifest links | Production HTML had both a handwritten link and a plugin-injected link. | Let vite-plugin-pwa emit the single production link; assert it in the build gate. |
| Identity inferred only from launch URL | A future launch URL edit could inadvertently change the installation identity. | Explicit `id: '/'`, retaining the old inferred identity; explicit root scope and English language. |
| Apple touch icon used 192px; favicon only 256px | Browsers had to resample a single general-purpose icon for distinct uses. | Generate an opaque 180px touch icon and a 32px favicon from the same emblem. |
| No installation screenshots | The install dialog could not show representative app screens. | Reuse labeled narrow combat/damage and wide campaign captures, with verified pixel dimensions. |
| Worker fallback accepted `/admin.html` and unknown OAuth URLs | A controlled navigation could receive the player shell instead of the separate admin document or protocol 404. | Deny admin documents, protocol roots/query variants, every non-consent OAuth path, and static package/asset paths. |
| Missing package assets returned HTML with status 200 | Broken icon URLs and missing JS bundles appeared successful until decoding failed. Confirmed on the public deployment. | Real uncached 404s for missing assets/screenshots/known package files; preserve legitimate SPA deep links. |
| Registration comment incorrectly described caching authenticated GETs | Maintainers could infer an unsafe caching contract that the worker did not implement. | Document the actual shell/public-image-only cache boundary. |

The production 512px PNG was fetched successfully, decoded as 512×512, and its
SHA-256 matched the repository source. This rules out a missing or wrong-sized
PNG at that URL during that request; it does not identify what a particular
installed Android launcher has retained. Missing adaptive artwork and unchanged
icon URLs are confirmed packaging defects, but neither alone proves the cause
of every missing/generic Android icon.

## Areas checked

| Area | Result / intended behavior |
|---|---|
| HTTPS and MIME types | Public manifest is `application/manifest+json`; PNG and registration JS have appropriate types. HTTPS/HSTS and framing restrictions are present. |
| Cache behavior | Mutable manifest, worker/bootstrap and HTML use browser/CDN no-store headers. Generated icon and bundle URLs are content-hashed and immutable. |
| Artwork | Ordinary emblem retained; adaptive foreground fits within the circular 40% safe zone; installation PNGs are square and opaque. Apple/favicons have their own dimensions. |
| Identity and scope | Existing root identity/launch destination retained; authenticated users land on their dashboard, signed-out users on the introduction. No orientation lock. |
| Manifest discovery | Exactly one player manifest link, no admin link; Chromium parses the shipped manifest and loads its icon URLs. |
| Offline startup | Actual built-worker cold reload and navigation exercised, rather than simulating only API failures against Vite. A first data download remains an online requirement. |
| Offline edits | IndexedDB/outbox retain a character rename through a fully offline reload, then sync it after reconnection. Authenticated HTTP responses are not URL-cached by the worker. |
| Updates | Existing hourly/focus/online discovery and persistent Reload prompt retained; dedicated lifecycle tests cover first install, waiting/installing workers, dismissal and forced incompatible-build updates. |
| Responsive launch | Public launch page checked at 320/393px and around 640/768px boundaries; browser screenshot inspected. Existing sheet dock/FAB reserves bottom safe-area spacing. |
| Admin/protocol isolation | Admin entry has no manifest/registration and is excluded from precache. Controlled document navigation must reach the admin shell or real protocol/asset 404s. |
| Fonts and lazy routes | Self-hosted font files, route chunks, styles and installation icons belong to the built shell precache. No external font origin is required for offline launch. |
| Notifications | Existing desktop opt-in delivers while an app tab is running. Closed-app push delivery is not implemented; Android support must not be inferred from the desktop preference. |

## Validation and repeatable checks

`bun run build` includes the mandatory `pwa:check` package gate. Asset unit tests
check opacity, exact dimensions, foreground containment and changed source URLs;
static HTTP tests check cache policy and real missing-asset 404s. Browser acceptance
is `PWA_E2E=1 bun run test:e2e tests/e2e/pwa-package.spec.ts --workers=1`, against
the built Bun server, with the worktree's isolated PostgreSQL/Compose environment.
Use the worktree wrapper and the disk-backed Chromium temporary volume as described
in `AGENTS.md`. The normal Vite dev server intentionally has no worker.

Completed browser scenarios: Chromium manifest/installability with no reported
errors, all icon downloads, launch containment at eight widths, fully offline
public reload/login navigation, real admin/protocol/asset navigation boundaries,
and an offline character rename retained through reload and reconnect. The edit
test waits for the separate visible Identity editor to reflect the durable local
mirror before reloading; the generic Offline indicator does not establish that
a just-blurred edit's transaction has finished.

The complete client suite passed **131 files / 1,237 tests** using the direct
Node/Vitest entrypoint; static/package unit coverage passed **14 tests**. The
production build/package gate, typecheck, lint, and OpenAPI/MCP snapshot checks
passed (lint retained three existing rich-text-editor dependency warnings). A
browser-rendered circle/squircle/rounded-square preview was visually inspected;
the complete mark remains visible in each mask.
The repository client-runner wrapper failed before test discovery in this harness,
while direct invocation of the same installed Vitest entrypoint succeeded. This
runner discrepancy is separate from the PWA changes and was not patched.

## Deployment and device follow-up

1. Deploy the corrected package, then inspect the public manifest and its hashed
   image URLs with an unauthenticated browser. Verify actual images/JSON, with
   no challenge page or login redirect, and inspect DevTools installability errors.
2. On Android Chrome, install a fresh synthetic/test account and inspect launcher,
   task switcher and launch screen in circle/squircle launcher configurations.
   Repeat with an existing installation and Chrome's app-identity update flow.
3. Rotate the installed app, open the keyboard on a sheet, and check cutout/status/
   navigation-bar spacing on a real device. Chromium viewport emulation does not
   establish native launcher, splash-screen or hardware-inset correctness.
4. Exercise a real iOS Home Screen installation for the Apple touch artwork and
   standalone appearance. Explicit iOS device-sized splash images are not shipped.
5. Investigate CDN policy if installation fetches fail. During this audit, curl
   successfully fetched the manifest/icon/bootstrap while Python urllib received
   HTTP 403 for the same public resources. This client-dependent behavior is an
   observed deployment uncertainty, not a proven Android failure mechanism.

At the user's request, the official Android SDK, emulator 37.1.11, platform tools
and Android 16/API 36 Google Play x86_64 image were installed in ignored
`.local/android-sdk`. The host does not expose `/dev/kvm`. A software-only AVD
started with SwiftShader, but adb remained offline and QEMU exited with SIGSEGV
after 68 seconds, before boot completion; the system coredump record confirmed
the signal. No native Android installation/launcher result can be claimed. The
emulator was stopped; SDK/AVD files stay local and outside Git/Docker builds.
No physical iOS device was available.

No production deployment or CDN configuration was changed. Existing installed
icons can remain until the browser's identity update is accepted. Do not clear
site storage or uninstall while edits/images are queued locally.

Platform references: [Android adaptive-icon safe zone](https://web.dev/articles/maskable-icon),
[Chrome 144 app identity updates](https://developer.chrome.com/blog/improvements-to-web-app-updates),
[manifest identity and installation metadata](https://web.dev/learn/pwa/web-app-manifest),
[Chromium PWA diagnostics](https://developer.chrome.com/docs/devtools/progressive-web-apps).
