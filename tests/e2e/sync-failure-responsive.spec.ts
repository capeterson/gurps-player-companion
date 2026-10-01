import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { captureReviewScreenshot } from './review-artifacts';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

test('sync status and failure details wrap long entity names and errors', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL so this test can remove its generated account and character',
  );
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `sync-failure-responsive-${runId}@example.com`;
  const characterName = `Sync failure fixture ${runId}`;
  const longEntityName = `UnbrokenRejectedEntityName${'N'.repeat(110)}`;
  const longError = `UnbrokenServerRejectionReason${'R'.repeat(150)}`;
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL ?? '',
    connectionTimeoutMillis: 5_000,
  });

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Sync failure responsive QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    await page.goto('/characters');
    await page.getByLabel(/new character name/i).fill(characterName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 15_000 });
    const characterId = new URL(page.url()).pathname.split('/').at(-1);
    if (!characterId) throw new Error('Expected a character id in the sheet URL');

    // Seed a future-dated retry fixture directly into this browser's local
    // outbox. It remains queued and never reaches the sync endpoint.
    await page.evaluate(
      async ({ characterId, longEntityName, longError }) => {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('gurps-pc-local');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const transaction = database.transaction('outbox', 'readwrite');
            transaction.objectStore('outbox').put({
              clientOpId: crypto.randomUUID(),
              entityClass: 'character_trait',
              entityId: crypto.randomUUID(),
              parentId: characterId,
              command: 'patch',
              coalesceKey: `${characterId}|responsive-fixture`,
              fieldPath: 'name',
              attemptedValue: longEntityName,
              prevValue: 'Old name',
              baseRevision: 1,
              validationVersion: 1,
              status: 'transient_retry',
              enqueuedAt: new Date().toISOString(),
              lastAttemptAt: new Date().toISOString(),
              nextEarliestAttemptAt: new Date(Date.now() + 86_400_000).toISOString(),
              attemptCount: 4,
              serverReason: longError,
              humanName: longEntityName,
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
          });
        } finally {
          database.close();
        }
      },
      { characterId, longEntityName, longError },
    );
    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        const statusButton = page.getByRole('button', { name: 'Syncing changes' });
        await expect(statusButton).toBeVisible();
        await statusButton.hover();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toContainText('Saving local changes to the server');
        const tooltipBox = await tooltip.boundingBox();
        expect(tooltipBox).not.toBeNull();
        expect(tooltipBox?.x).toBeGreaterThanOrEqual(0);
        expect((tooltipBox?.x ?? 0) + (tooltipBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
        await statusButton.click();

        const dialog = page.getByRole('dialog').filter({
          has: page.getByRole('heading', { name: 'Sync log' }),
        });
        await expect(dialog.getByRole('heading', { name: 'Sync log' })).toBeVisible();
        const failure = dialog
          .getByRole('region', { name: 'Repeatedly failing' })
          .locator('article')
          .filter({ hasText: longEntityName });
        await expect(failure).toBeVisible();
        await expect(failure).toContainText(longError);
        const retryLabel = failure.getByText(longEntityName, { exact: true });
        const errorLabel = failure.getByText(longError, { exact: true });
        const revert = failure.getByRole('button', { name: 'Revert change' });
        await expect(revert).toBeVisible();
        const scrollArea = dialog.locator('.modal-box > div.overflow-y-auto');
        await retryLabel.scrollIntoViewIfNeeded();
        await expect(retryLabel).toBeInViewport();
        await errorLabel.scrollIntoViewIfNeeded();
        await expect(errorLabel).toBeInViewport();
        const measured = await Promise.all(
          [failure, retryLabel, errorLabel, revert].map((locator) =>
            locator.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return {
                x: box.x,
                right: box.right,
                width: box.width,
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
              };
            }),
          ),
        );
        for (const box of measured) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(viewport.width);
          expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
        }
        if (viewport.width === 320) {
          expect(measured[1]?.width).toBeGreaterThanOrEqual(160);
          expect(measured[2]?.width).toBeGreaterThanOrEqual(160);
        }
        const errorBox = await errorLabel.boundingBox();
        const scrollBox = await scrollArea.boundingBox();
        expect(errorBox).not.toBeNull();
        expect(scrollBox).not.toBeNull();
        const visibleErrorHeight =
          Math.min(
            (errorBox?.y ?? 0) + (errorBox?.height ?? 0),
            (scrollBox?.y ?? 0) + (scrollBox?.height ?? 0),
          ) - Math.max(errorBox?.y ?? 0, scrollBox?.y ?? 0);
        expect(visibleErrorHeight).toBeGreaterThan(0);
        if (viewport.height === 320) expect(scrollBox?.height).toBeGreaterThanOrEqual(80);
        if ([320, 568, 640, 768, 1024, 1440].includes(viewport.width)) {
          await captureReviewScreenshot(page, {
            path: testInfo.outputPath(`sync-failure-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
        await revert.scrollIntoViewIfNeeded();
        await expect(revert).toBeInViewport();
        await dialog.getByRole('button', { name: 'Close sync log' }).click();
      });
    }
  } finally {
    try {
      await pool.query(
        'delete from characters where owner_id=(select id from users where email=$1)',
        [email],
      );
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
