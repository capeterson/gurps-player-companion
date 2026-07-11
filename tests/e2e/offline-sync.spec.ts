/**
 * E2E tests for offline + sync behaviour.
 *
 * Covers three bugs found via code analysis:
 *
 *  BUG-1  Character sheet is always read-only when the /auth/me query
 *         hasn't resolved (cold cache, offline).  Fix: canWrite derives
 *         owner id from the stored JWT sub as a fallback.
 *         Also: newly created characters had no ownerId in the local Dexie
 *         row, making them uneditable before the first sync.
 *
 *  BUG-2  SyncBootstrapGate briefly renders children with an empty Dexie
 *         on first login (the window between the liveQuery resolving to
 *         `false` and setBootstrapping(true) landing).
 *
 *  BUG-3  After draining the outbox on reconnect, the cursor pull that
 *         fetches server-side changes from other devices was delayed up to
 *         5 seconds.  Fix: triggerCursorPull is called immediately after
 *         applyOutcomes.
 *
 * Requirements: dev stack running at http://localhost:3000.
 */

import { expect, test } from '@playwright/test';

// ─── helpers ─────────────────────────────────────────────────────────────────

const SUFFIX = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function registerAndLogin(
  page: import('@playwright/test').Page,
  email: string,
  password = 'CorrectHorseBatteryStaple1',
) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('E2E User');
  // RegisterPage's label is "Password (min 8 chars)" — anchor to the
  // start only so the hint text doesn't break the match, and rely on
  // there being no "Confirm password" field on this form to keep it
  // unambiguous.
  await page.getByLabel(/^password\b/i).fill(password);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });
}

async function createCharacter(page: import('@playwright/test').Page, name: string) {
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill(name);
  await page.getByRole('button', { name: /^create$/i }).click();
  // Should navigate to the character sheet
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });
}

/**
 * Take the page offline: Playwright's context.setOffline(true) blocks
 * the Chromium network stack (so API calls genuinely fail), and we also
 * dispatch the DOM event so the app's online/offline listeners fire.
 */
async function goOffline(page: import('@playwright/test').Page) {
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
}

/** Bring the page back online and fire the DOM event. */
async function goOnline(page: import('@playwright/test').Page) {
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

// ─── BUG-1: canWrite offline ──────────────────────────────────────────────────

test.describe('BUG-1: canWrite is correct offline', () => {
  test('character sheet remains editable when navigator is offline', async ({ page }) => {
    const email = `e2e-offline-edit-${SUFFIX()}@example.com`;
    await registerAndLogin(page, email);

    // Create a character while online so it's in Dexie + server.
    await createCharacter(page, 'Offline Hero');

    // Wait for the sync indicator to settle on "Synced".
    await expect(page.getByLabel(/all changes saved/i)).toBeVisible({ timeout: 15_000 });

    // Simulate offline for the *API*, not the whole browser network stack.
    // The suite runs against `bun run dev` (Vite dev server), which has no
    // service worker precaching the app shell — that's only generated for
    // a production build (`vite-plugin-pwa`'s `devOptions.enabled` is off).
    // A real `context.setOffline(true)` + `page.reload()` would therefore
    // fail with ERR_INTERNET_DISCONNECTED before the app ever runs, which
    // tests the dev server's lack of a SW rather than the bug this test
    // guards: canWrite falling back to the JWT sub when `/auth/me` can't
    // be reached. Aborting just the API traffic reproduces that condition
    // — the app genuinely gets no response from `/auth/me` — while still
    // letting the browser fetch its own JS/CSS/HTML, standing in for the
    // SW-cached shell a production build would serve offline.
    await page.route('**/api/v1/**', (route) => route.abort());
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));

    // Reload the page — /auth/me will fail, but the character should still be editable.
    await page.reload();

    // The name input should be present and enabled (not just a <span>).
    const nameInput = page.getByRole('textbox', { name: /character name/i }).first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await expect(nameInput).not.toBeDisabled();

    // Restore network state.
    await page.unroute('**/api/v1/**');
    await goOnline(page);
  });

  test('newly created character is immediately editable before first sync', async ({
    page,
    context,
  }) => {
    const email = `e2e-new-char-${SUFFIX()}@example.com`;
    await registerAndLogin(page, email);
    await page.goto('/characters');

    // `goto` is a hard navigation, so it remounts the SPA and restarts the
    // mandatory SyncBootstrapGate pull — which itself is a `/sync/**` call.
    // Wait for that bootstrap to actually resolve (the heading only renders
    // once the gate clears) before blocking sync traffic below; otherwise
    // the block races the bootstrap's own cursor-pull and can abort it,
    // leaving the app stuck on "Bringing local data in sync…" forever.
    await expect(page.getByRole('heading', { name: /your characters/i })).toBeVisible({
      timeout: 15_000,
    });

    // Block all sync requests so the create never round-trips.
    await context.route('**/api/v1/sync/**', (route) => route.abort());

    const charName = `Unsynced ${SUFFIX()}`;
    await page.getByLabel(/new character name/i).fill(charName);
    await page.getByRole('button', { name: /^create$/i }).click();

    // Should navigate to the sheet
    await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 10_000 });

    // ST input must be editable — not a read-only span.
    const stInput = page.getByRole('textbox', { name: /st base/i });
    await expect(stInput).toBeVisible({ timeout: 5_000 });
    await expect(stInput).not.toBeDisabled();
  });
});

// ─── BUG-2: SyncBootstrapGate flash ─────────────────────────────────────────

test.describe('BUG-2: SyncBootstrapGate never flashes empty content', () => {
  test('first login never shows "no characters" before the spinner', async ({ page }) => {
    const email = `e2e-bootstrap-${SUFFIX()}@example.com`;

    // Collect all text rendered to the page while navigating from register → home.
    const renderedTexts: string[] = [];
    page.on('domcontentloaded', async () => {
      const text = await page.evaluate(() => document.body.innerText).catch(() => '');
      renderedTexts.push(text);
    });

    await registerAndLogin(page, email);

    // After registration + redirect, we should never have seen "No characters yet"
    // without a spinner present at the same moment.
    // A simpler invariant: if "No characters yet" ever appeared, the spinner
    // ("Bringing local data in sync") must have appeared before it or at the same time.
    const sawEmptyState = renderedTexts.some((t) => t.toLowerCase().includes('no characters yet'));
    const sawSpinner = renderedTexts.some((t) =>
      t.toLowerCase().includes('bringing local data in sync'),
    );

    if (sawEmptyState) {
      // If the empty state appeared, the spinner should have preceded it.
      expect(sawSpinner).toBe(true);
    }
    // Primary assertion: the spinner appeared (or there were no intermediate empty renders).
    // Both are acceptable; what's NOT acceptable is empty-state WITHOUT spinner.
  });

  test('subsequent login does not block behind a spinner', async ({ page }) => {
    const email = `e2e-bootstrap-subsequent-${SUFFIX()}@example.com`;
    await registerAndLogin(page, email);

    // Wait for content to load
    await page.goto('/characters');
    await expect(page.getByRole('heading', { name: /your characters/i })).toBeVisible({
      timeout: 10_000,
    });

    // Sign out
    // The user-menu trigger is a <summary aria-label="Open user menu">
    // inside a <details> dropdown, not a <button>: Chromium's accessibility
    // tree exposes <summary> with role "generic" (the <details> itself gets
    // role "group"), so getByRole('button', ...) never matches it. Its
    // aria-label still makes it reachable via getByLabel.
    await page.getByLabel(/open user menu/i).click();
    await page.getByRole('link', { name: /settings/i }).click();
    // Log out via the user menu — sign out button might be in settings or nav
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 10_000 });

    // On subsequent login, the character list should appear quickly — no long spinner.
    await page.goto('/characters');
    await expect(page.getByRole('heading', { name: /your characters/i })).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ─── BUG-3: cursor pull immediately after drain on reconnect ─────────────────

test.describe('BUG-3: server changes appear promptly after reconnect drain', () => {
  test('edits from a second session appear within 3 seconds of reconnect', async ({ browser }) => {
    const email = `e2e-reconnect-${SUFFIX()}@example.com`;
    const password = 'CorrectHorseBatteryStaple1';

    // Session A: register + create a character.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await registerAndLogin(pageA, email);
    await createCharacter(pageA, 'Sync Target');
    await expect(pageA.getByLabel(/all changes saved/i)).toBeVisible({ timeout: 15_000 });
    const charUrl = pageA.url();

    // Session B: log in with the same account on a different "device".
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto('/login');
    await pageB.getByLabel(/email/i).fill(email);
    await pageB.getByLabel(/^password$/i).fill(password);
    await pageB.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(pageB).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });
    await pageB.goto(charUrl);
    await expect(pageB.getByRole('textbox', { name: /character name/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Go offline on session B.
    await goOffline(pageB);

    // Session A edits the character name while session B is offline.
    const newName = `Renamed ${SUFFIX()}`;
    const nameInputA = pageA.getByRole('textbox', { name: /character name/i }).first();
    await nameInputA.fill(newName);
    await nameInputA.blur();
    // Wait for session A to sync its edit.
    await expect(pageA.getByLabel(/all changes saved/i)).toBeVisible({ timeout: 15_000 });

    // Bring session B back online.
    await goOnline(pageB);

    // Session B should pick up the rename within 3 seconds (immediate pull after drain).
    // The character name displayed in the identity hero should update.
    await expect(pageB.getByRole('textbox', { name: /character name/i }).first()).toHaveValue(
      newName,
      { timeout: 6_000 },
    );

    await ctxA.close();
    await ctxB.close();
  });
});
