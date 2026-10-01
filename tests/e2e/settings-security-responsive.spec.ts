import { type Locator, expect, test } from '@playwright/test';
import { Pool } from 'pg';

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const runId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function expectInsideViewport(locator: Locator, viewport: (typeof viewports)[number]) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
}

async function waitForViewportLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('account security, API key and connected app controls fit responsive viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL so this test can remove its generated account',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const id = runId();
  const email = `settings-security-responsive-${id}@example.com`;
  const keyName = `APIKeyWithLongUnbrokenName${'ClientCredential'.repeat(4)}-${id}`;
  const clientName = `ConnectedAgentWithLongUnbrokenName${'DelegatedClient'.repeat(4)}-${id}`;
  const passkeyName = `SecurityKeyWithLongUnbrokenName${'PasskeyLabel'.repeat(4)}-${id}`;
  const apiKey = {
    id: '11111111-1111-4111-8111-111111111111',
    name: keyName,
    createdAt: '2026-08-20T12:00:00.000Z',
    lastUsedAt: null,
  };
  const grant = {
    id: '22222222-2222-4222-8222-222222222222',
    clientId: 'synthetic-responsive-client',
    clientName,
    scopes: ['gpc:read', 'gpc:write', 'gpc:manage'],
    createdAt: '2026-08-20T12:00:00.000Z',
    lastUsedAt: null,
  };

  try {
    await page.route('**/api/v1/auth/api-keys', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            apiKey,
            // This is an inert synthetic test value, never a real credential.
            plaintextKey: `gpc_test_${'SYNTHETIC_ONLY_'.repeat(5)}`,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([apiKey]),
      });
    });
    await page.route('**/api/v1/oauth/grants', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([grant]),
      });
    });
    await page.route('**/api/v1/auth/passkeys', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: passkeyName,
            createdAt: '2026-08-20T12:00:00.000Z',
            lastUsedAt: null,
          },
        ]),
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Settings Security Responsive QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    await page.goto('/settings');

    const passwordSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Change password' }) })
      .first();
    const passkeySection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Passkeys' }) })
      .first();
    const apiSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'API keys' }) })
      .first();
    const connectedSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Connected apps' }) })
      .first();
    await expect(passwordSection).toBeVisible({ timeout: 15_000 });
    await expect(passkeySection.getByText(passkeyName, { exact: true })).toBeVisible();
    await expect(apiSection.getByText(keyName, { exact: true })).toBeVisible();
    await expect(connectedSection.getByText(clientName, { exact: true })).toBeVisible();

    for (const viewport of viewports) {
      await test.step(`settings page ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        for (const control of [
          passwordSection.getByLabel('Current password', { exact: true }),
          passwordSection.getByLabel('New password', { exact: true }),
          passwordSection.getByLabel('Confirm new password', { exact: true }),
          passwordSection.getByRole('button', { name: 'Change password', exact: true }),
          passkeySection.getByRole('button', { name: 'Add passkey', exact: true }),
          apiSection.getByRole('textbox', { name: 'Name', exact: true }),
          apiSection.getByRole('button', { name: 'Mint key', exact: true }),
          connectedSection.getByRole('button', { name: 'Revoke', exact: true }),
        ]) {
          await expectInsideViewport(control, viewport);
        }
        for (const [section, name] of [
          [passkeySection, passkeyName],
          [apiSection, keyName],
          [connectedSection, clientName],
        ] as const) {
          const label = section.getByText(name, { exact: true });
          await expectInsideViewport(label, viewport);
          const metrics = await label.evaluate((element) => ({
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
            right: element.getBoundingClientRect().right,
          }));
          expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
          expect(metrics.right).toBeLessThanOrEqual(viewport.width);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
      });
    }

    const keyDialogViewport = { width: 568, height: 320 };
    await page.setViewportSize(keyDialogViewport);
    await apiSection.getByRole('textbox', { name: 'Name', exact: true }).fill('Synthetic QA key');
    await apiSection
      .getByRole('button', { name: 'Mint key', exact: true })
      .scrollIntoViewIfNeeded();
    await apiSection.getByRole('button', { name: 'Mint key', exact: true }).click();
    const keyDialog = page
      .locator('dialog[open]')
      .filter({ has: page.getByText('Save your API key') });
    await expect(keyDialog.getByText('Save your API key')).toBeVisible();
    for (const viewport of viewports) {
      await test.step(`one-time key dialog ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await waitForViewportLayout(page);
        const box = await keyDialog.locator('.modal-box').boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        }
        await expectInsideViewport(
          keyDialog.getByRole('button', { name: 'Copy to clipboard' }),
          viewport,
        );
        await expectInsideViewport(
          keyDialog.getByRole('button', { name: "I've saved it" }),
          viewport,
        );
        if ([320, 568].includes(viewport.width)) {
          await keyDialog.screenshot({
            path: testInfo.outputPath(`api-key-dialog-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
      });
    }
    await keyDialog.getByRole('button', { name: "I've saved it" }).click();

    const revokeViewports = [
      { width: 320, height: 568 },
      { width: 568, height: 320 },
    ];
    const revokeViewport = revokeViewports[1];
    await page.setViewportSize(revokeViewport);
    await apiSection.getByRole('button', { name: `Revoke ${keyName}` }).scrollIntoViewIfNeeded();
    await apiSection.getByRole('button', { name: `Revoke ${keyName}` }).click();
    const revokeKeyDialog = page.getByRole('dialog', { name: 'Revoke API key' });
    await expect(revokeKeyDialog.getByText(keyName, { exact: true })).toBeVisible();
    for (const viewport of revokeViewports) {
      await page.setViewportSize(viewport);
      await waitForViewportLayout(page);
      const dialogBox = await revokeKeyDialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      if (dialogBox) {
        expect(dialogBox.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
        expect(dialogBox.y).toBeGreaterThanOrEqual(0);
        expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height);
      }
      const keyLabel = revokeKeyDialog.getByText(keyName, { exact: true });
      await expectInsideViewport(keyLabel, viewport);
      const keyLabelMetrics = await keyLabel.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(keyLabelMetrics.scrollWidth).toBeLessThanOrEqual(keyLabelMetrics.width);
      for (const action of [
        revokeKeyDialog.getByRole('button', { name: 'Cancel', exact: true }),
        revokeKeyDialog.getByRole('button', { name: 'Revoke', exact: true }),
      ]) {
        await expectInsideViewport(action, viewport);
      }
    }
    await revokeKeyDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    await connectedSection.getByRole('button', { name: 'Revoke', exact: true }).click();
    const revokeAppDialog = page.getByRole('dialog', { name: 'Revoke connected app?' });
    await expect(revokeAppDialog.getByText(clientName, { exact: true })).toBeVisible();
    for (const viewport of revokeViewports) {
      await page.setViewportSize(viewport);
      await waitForViewportLayout(page);
      const dialogBox = await revokeAppDialog.boundingBox();
      expect(dialogBox).not.toBeNull();
      if (dialogBox) {
        expect(dialogBox.x).toBeGreaterThanOrEqual(0);
        expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width);
        expect(dialogBox.y).toBeGreaterThanOrEqual(0);
        expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height);
      }
      const appLabel = revokeAppDialog.getByText(clientName, { exact: true });
      await expectInsideViewport(appLabel, viewport);
      const appLabelMetrics = await appLabel.evaluate((element) => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(appLabelMetrics.scrollWidth).toBeLessThanOrEqual(appLabelMetrics.width);
      for (const action of [
        revokeAppDialog.getByRole('button', { name: 'Cancel', exact: true }),
        revokeAppDialog.getByRole('button', { name: 'Revoke', exact: true }),
      ]) {
        await expectInsideViewport(action, viewport);
      }
    }
    await revokeAppDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    try {
      await pool.query('delete from users where email = $1', [email]);
    } finally {
      await pool.end();
    }
  }
});
