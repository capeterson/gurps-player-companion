# Notification settings

Real Chromium captures of Settings → Notifications with the default preferences:
desktop off, both invitation email switches on, security email always on, and
all seven inbox topics on. Captured on 2026-09-30 using this checkout's isolated
development server and PostgreSQL 18 database. The browser test creates synthetic
accounts; no production account or user-supplied character data is pictured.

The desktop browser width is 1280 pixels; mobile is 375 pixels. Captures use
taller viewports to show the entire card without sticky navigation overlap.
Both use the Illuminated Manuscript theme and device scale factor 1.
The browser regression also checks settings and inbox containment at 320, 375,
767, 768, 769 and 1280 pixels with normal viewport heights.

- [Desktop settings](notification-settings-desktop.png)
- [Mobile settings](notification-settings-mobile.png)

These are feature documentation assets, separate from the canonical public
README and landing-page screenshots.
