import { type Page, expect, test } from '@playwright/test';
import type { SyncLogEntry } from '../../src/client/db/dexie';
import { selectCharacterSection } from './character-navigation';

async function readJournal(page: Page): Promise<SyncLogEntry[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<SyncLogEntry[]>((resolve, reject) => {
        const request = db.transaction('syncLog').objectStore('syncLog').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

test('a synced edit and its revision response share one item with Request and Response folds', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Local debugging can reuse this test's own account between runs.
  const existingEmail = process.env.SYNC_LOG_E2E_EMAIL;
  await page.goto(existingEmail ? '/login' : '/register');
  await page.getByLabel(/email/i).fill(existingEmail ?? `sync-log-${Date.now()}@example.com`);
  if (!existingEmail) await page.getByLabel(/display name/i).fill('Sync log QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: existingEmail ? /sign in/i : /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Sync response hero');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 15_000 });
  const saved = () =>
    page.getByLabel('All changes saved', { exact: true }).filter({ visible: true });
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await selectCharacterSection(page, 'Overview');
  const strength = page.getByRole('textbox', { name: 'ST base', exact: true });
  await strength.fill('14');
  await strength.blur();
  await expect(saved()).toBeVisible({ timeout: 15_000 });

  let push: SyncLogEntry | undefined;
  await expect
    .poll(async () => {
      const entries = await readJournal(page);
      push = entries.find((entry) => entry.direction === 'push' && entry.fieldPath === 'st');
      const revision = (push?.details as { newRevision?: number } | undefined)?.newRevision;
      return (
        revision !== undefined &&
        entries.some(
          (entry) =>
            entry.direction === 'pull' &&
            entry.entityId === push?.entityId &&
            (entry.details as { revision?: number }).revision === revision,
        )
      );
    })
    .toBe(true);
  if (!push?.humanName) throw new Error('Expected the recorded ST change to have a title');
  const title = push.humanName;
  const revision = (push.details as { newRevision: number }).newRevision;

  // One registration/page covers the narrow screen and the footer breakpoint.
  for (const width of [390, 639, 640, 641, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await saved().click();
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
    const recent = dialog
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Recently synced' }) });
    const change = recent
      .locator(':scope > div > details')
      .filter({ has: page.getByText(title, { exact: true }) });
    await expect(change).toHaveCount(1);
    await change.locator(':scope > summary').click();
    await expect(change.getByText('Before', { exact: true })).toBeVisible();
    await expect(change.getByText('10', { exact: true })).toBeVisible();
    await expect(change.getByText('After', { exact: true })).toBeVisible();
    await expect(change.getByText('14', { exact: true })).toBeVisible();
    const request = change
      .locator('details')
      .filter({ has: page.getByText('Request', { exact: true }) });
    const response = change
      .locator('details')
      .filter({ has: page.getByText('Response', { exact: true }) });
    await expect(request.locator('pre')).toBeHidden();
    await expect(response.locator('pre')).toBeHidden();
    await request.locator('summary').click();
    await expect(request.locator('pre')).toBeVisible();
    await expect(request.locator('pre')).toContainText('"attemptedValue": 14');
    await response.locator('summary').click();
    await expect(response.locator('pre')).toBeVisible();
    await expect(response.locator('pre')).toContainText('"status": "applied"');
    await expect(response.locator('pre')).toContainText(`"newRevision": ${revision}`);
    await expect(response.locator('pre')).toContainText(`"revision": ${revision}`);
    await expect(recent.getByText('no data fields changed locally', { exact: true })).toHaveCount(
      0,
    );
    await expect(dialog.getByText('Raw', { exact: true })).toHaveCount(0);
    for (const locator of [
      dialog.locator('.modal-box'),
      request.locator('pre'),
      response.locator('pre'),
    ]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('Expected the opened sync details to have a bounding box');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
    }
    await page.screenshot({ path: testInfo.outputPath(`sync-log-${width}.png`) });
    await dialog.getByRole('button', { name: 'Close sync log' }).click();
  }

  // Exercise native browser CompressionStream storage with a real large edit,
  // reusing the same account and page as the small acknowledgement scenario.
  const notes = 'A weathered traveller with detailed field notes. '.repeat(35).trim();
  await page.getByRole('button', { name: 'Edit raw markdown', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'description', exact: true });
  await description.fill(notes);
  await description.blur();
  let compressed: SyncLogEntry | undefined;
  await expect
    .poll(async () => {
      compressed = (await readJournal(page)).find(
        (entry) => entry.direction === 'push' && entry.fieldPath === 'appearance',
      );
      return compressed?.payloadStored;
    })
    .toBe(true);
  if (!compressed) throw new Error('Expected a compressed description change');
  expect(compressed.newValue).toBeUndefined();
  const storedSize = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction('syncLogBodies').objectStore('syncLogBodies').get(id);
        request.onsuccess = () => resolve(request.result?.bytes?.byteLength ?? 0);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, compressed.id);
  expect(storedSize).toBeGreaterThan(0);
  expect(storedSize).toBeLessThan(new TextEncoder().encode(notes).byteLength);
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await saved().click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
  const titleElement = dialog.getByText(compressed.humanName ?? 'description', { exact: true });
  const change = titleElement.locator('xpath=ancestor::details[1]');
  await expect(change.getByText('After', { exact: true })).toHaveCount(0);
  await titleElement.click();
  await expect(change.getByText(notes, { exact: true })).toBeVisible();
  const request = change
    .locator('details')
    .filter({ has: page.getByText('Request', { exact: true }) });
  await expect(request.locator('pre')).toHaveCount(0);
  await request.locator('summary').click();
  await expect(request.locator('pre')).toContainText(notes.trim());
  const response = change
    .locator('details')
    .filter({ has: page.getByText('Response', { exact: true }) });
  await response.locator('summary').click();
  await expect(response.locator('pre')).toContainText('"status": "applied"');
  await response.locator('pre').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('sync-log-compressed.png') });
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download sync debug log' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Expected a readable sync debug download');
  let json = '';
  for await (const chunk of stream) json += chunk.toString();
  const dump = JSON.parse(json) as { syncLog: SyncLogEntry[] };
  expect(dump.syncLog.find(({ id }) => id === compressed?.id)?.newValue).toBe(notes);
  expect(json).not.toContain('payloadStored');
});
