import { type Page, expect, test } from '@playwright/test';
import type { SyncLogEntry } from '../../src/client/db/dexie';
import { selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

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
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Local debugging can reuse this test's own account between runs.
  const existingEmail = process.env.SYNC_LOG_E2E_EMAIL;
  await page.goto(existingEmail ? '/login' : '/register');
  await expect(page.getByLabel(/email/i)).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/email/i).fill(existingEmail ?? `sync-log-${Date.now()}@example.com`);
  if (!existingEmail) await page.getByLabel(/display name/i).fill('Sync log QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: existingEmail ? /sign in/i : /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Sync response hero');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 15_000 });
  const characterDestination = new URL(page.url()).pathname;
  const saved = () => page.getByLabel(/^All changes saved/).filter({ visible: true });
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole('button', { name: 'All changes saved — live updates connected', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await selectCharacterSection(page, 'Overview');
  const strength = page.getByRole('textbox', { name: 'ST base', exact: true });
  const connectedGemColor = await saved()
    .locator('svg > path')
    .evaluate((gem) => getComputedStyle(gem).color);
  // Hold the real upload so the connected, actively syncing icon stays visible.
  let releaseUpload = () => {};
  const heldUpload = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  const uploadRoute = '**/api/v1/sync/operations';
  await page.route(uploadRoute, async (route) => {
    await heldUpload;
    await route.continue();
  });
  try {
    const upload = page.waitForRequest(uploadRoute);
    await strength.fill('14');
    await strength.blur();
    await upload;
    const syncing = page.getByRole('button', { name: 'Syncing changes', exact: true });
    await expect(syncing).toBeVisible();
    const gem = syncing.locator('svg > path');
    await expect(gem).toHaveAttribute('fill', 'currentColor');
    const colors = await syncing.evaluate((button) => {
      const center = button.querySelector('svg > path');
      const arrows = button.querySelector('svg > g');
      if (!center || !arrows) throw new Error('Expected the syncing gem and arrows');
      return {
        center: getComputedStyle(center).color,
        arrow: getComputedStyle(arrows).color,
        animation: getComputedStyle(arrows).animationName,
      };
    });
    expect(colors.center).toBe(connectedGemColor);
    expect(colors.center).not.toBe(colors.arrow);
    expect(colors.animation).not.toBe('none');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(syncing).toBeVisible();
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`sync-connected-active-${width}.png`),
      });
    }
  } finally {
    releaseUpload();
    await page.unroute(uploadRoute);
  }
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await expect(saved().locator('svg > path')).toHaveAttribute('fill', 'currentColor');

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
  const title = 'Character: Sync response hero · ST';
  const revision = (push.details as { newRevision: number }).newRevision;

  // One registration/page covers the narrow screen and the footer breakpoint.
  for (const width of [390, 639, 640, 641, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await saved().hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('All changes synced · Live updates connected');
    const tooltipBox = await tooltip.boundingBox();
    if (!tooltipBox) throw new Error('Expected the connected sync tooltip');
    expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(width);
    expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(900);
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`sync-connected-tooltip-${width}.png`),
      animations: 'disabled',
    });
    await saved().click();
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
    const syncButton = dialog.getByRole('button', { name: 'Sync now' });
    await expect(syncButton).toBeVisible();
    const lastSyncTime = dialog
      .getByText('Last sync', { exact: true })
      .locator('..')
      .locator('time');
    const lastChangesTime = dialog
      .getByText('Last changes', { exact: true })
      .locator('..')
      .locator('time');
    await expect(lastSyncTime).toBeVisible();
    await expect(lastChangesTime).toBeVisible();
    if (width === 390) {
      const changeAt = await lastChangesTime.getAttribute('datetime');
      const checkedAt = await lastSyncTime.getAttribute('datetime');
      const manualPull = page.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/sync/cursor') && response.request().method() === 'POST',
      );
      await syncButton.click();
      expect((await manualPull).ok()).toBe(true);
      await expect(page.getByText('Sync completed', { exact: true })).toBeVisible();
      await expect(
        dialog
          .getByText('Last sync', { exact: true })
          .locator('..')
          .getByText('just now', { exact: true }),
      ).toBeVisible();
      await expect(lastChangesTime).toHaveAttribute('datetime', changeAt ?? '');
      await expect
        .poll(async () => Date.parse((await lastSyncTime.getAttribute('datetime')) ?? ''))
        .toBeGreaterThan(Date.parse(checkedAt ?? ''));

      // A later automatic empty check also advances only Last sync.
      const manualAt = await lastSyncTime.getAttribute('datetime');
      await page.waitForResponse(
        (response) => response.url().includes('/api/v1/sync/cursor') && response.ok(),
      );
      await expect
        .poll(async () => Date.parse((await lastSyncTime.getAttribute('datetime')) ?? ''))
        .toBeGreaterThan(Date.parse(manualAt ?? ''));
      await expect(lastChangesTime).toHaveAttribute('datetime', changeAt ?? '');
    }
    for (const locator of [lastSyncTime, lastChangesTime]) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Expected a visible connection timestamp');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
    }
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`sync-connection-${width}.png`),
      animations: 'disabled',
    });
    const recent = dialog
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Recently synced' }) });
    const change = recent
      .locator(':scope > div > details')
      .filter({ has: page.getByText(title, { exact: true }) });
    await expect(change).toHaveCount(1);
    await change.locator(':scope > summary').click({ position: { x: 8, y: 12 } });
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
      syncButton,
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
    await captureReviewScreenshot(page, { path: testInfo.outputPath(`sync-log-${width}.png`) });
    await dialog.getByRole('button', { name: 'Close sync log' }).click();
  }

  // Exercise native browser CompressionStream storage with a real large edit,
  // reusing the same account and page as the small acknowledgement scenario.
  const notes = 'A weathered traveller with detailed field notes. '.repeat(35).trim();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('button', { name: 'Edit raw markdown', exact: true }).click();
  const description = page.getByRole('textbox', { name: 'description', exact: true });
  await description.fill(notes);
  await page.getByRole('button', { name: 'Done editing description', exact: true }).click();
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
  const titleElement = dialog.getByRole('link', {
    name: 'Character: Sync response hero · Description',
    exact: true,
  });
  const change = titleElement.locator('xpath=ancestor::details[1]');
  await expect(change.getByText('After', { exact: true })).toHaveCount(0);
  await change.locator(':scope > summary').click({ position: { x: 8, y: 12 } });
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
  await captureReviewScreenshot(page, { path: testInfo.outputPath('sync-log-compressed.png') });
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
  await dialog.getByRole('button', { name: 'Close sync log' }).click();

  const hpControl = page.getByRole('button', { name: /^Adjust HP,/ });
  const hpLabel = await hpControl.getAttribute('aria-label');
  const hpBeforeMatch = hpLabel?.match(/current (\d+(?:\.\d+)?) of/i);
  if (!hpBeforeMatch) throw new Error('Expected the HP control to expose its current value');
  const hpBefore = Number(hpBeforeMatch[1]);
  await hpControl.click();
  const hpAdjustment = page.getByLabel('HP adjustment');
  await expect(hpAdjustment).toBeVisible();
  const decreaseHp = hpAdjustment.getByRole('button', { name: 'Decrease HP by 1' });
  await decreaseHp.click();
  await decreaseHp.click();
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await saved().click();
  const hpDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
  const hpTitle = hpDialog.getByRole('link', { name: 'HP', exact: true });
  await expect(hpTitle).toHaveAttribute('href', characterDestination);
  const hpChange = hpTitle.locator('xpath=ancestor::details[1]');
  await expect(hpChange.locator(':scope > summary')).toContainText('Pushed');
  await hpChange.locator(':scope > summary').click({ position: { x: 8, y: 12 } });
  await expect(hpChange.getByText('Before', { exact: true })).toBeVisible();
  await expect(hpChange.getByText(String(hpBefore), { exact: true })).toBeVisible();
  await expect(hpChange.getByText('After', { exact: true })).toBeVisible();
  await expect(hpChange.getByText(String(hpBefore - 2), { exact: true })).toBeVisible();
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('sync-log-hp-burst.png'),
    animations: 'disabled',
  });
  await hpDialog.getByRole('button', { name: 'Close sync log' }).click();

  // The same browser/account checks the online-only settings save and a long title.
  await page.goto('/campaigns');
  await page.getByRole('button', { name: '+ New campaign', exact: true }).click();
  const campaignName = `Lantern Coast ${'x'.repeat(104)}`;
  await page.getByRole('textbox', { name: 'Campaign name', exact: true }).fill(campaignName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const campaignLink = page.getByRole('link', { name: campaignName, exact: true });
  await expect(campaignLink).toBeVisible();
  const destination = await campaignLink.getAttribute('href');
  if (!destination) throw new Error('Expected campaign destination');
  await campaignLink.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('combobox', { name: 'Skill prerequisites' }) });
  await settings.getByRole('combobox', { name: 'Skill prerequisites' }).selectOption('warn');
  await settings.getByRole('button', { name: /^Save/ }).click();
  await expect(settings).toBeHidden();
  await expect
    .poll(async () =>
      (await readJournal(page)).some(
        (entry) => entry.source === 'Campaign settings' && entry.direction === 'push',
      ),
    )
    .toBe(true);
  for (const width of [320, 390, 639, 640, 641, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await saved().click();
    const logDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
    await expect(logDialog.getByText('WebSocket', { exact: true })).toBeVisible();
    await expect(logDialog.getByText(/^(Connected|Connecting)$/)).toBeVisible();
    await expect(logDialog.getByText('Last sync', { exact: true })).toBeVisible();
    await expect(logDialog.getByText('Last changes', { exact: true })).toBeVisible();
    const settingsTitle = logDialog.getByRole('link', {
      name: `Campaign: ${campaignName} · campaign rules updated`,
      exact: true,
    });
    await expect(settingsTitle).toHaveAttribute('href', destination);
    const settingsChange = settingsTitle.locator('xpath=ancestor::details[1]');
    await expect(settingsChange.locator(':scope > summary')).toContainText('Pushed');
    await settingsChange.locator(':scope > summary').click({ position: { x: 8, y: 12 } });
    await expect(settingsChange.getByText('Before', { exact: true })).toBeVisible();
    await expect(settingsChange.getByText('After', { exact: true })).toBeVisible();
    await expect(
      settingsChange.getByText('Skill prerequisite policy', { exact: true }),
    ).toBeVisible();
    await expect(settingsChange).toContainText('"block"');
    await expect(settingsChange).toContainText('"warn"');
    await expect(settingsChange).not.toContainText('protectNaturalDr');
    const settingsRequest = settingsChange
      .locator('details')
      .filter({ has: page.getByText('Request', { exact: true }) });
    const settingsResponse = settingsChange
      .locator('details')
      .filter({ has: page.getByText('Response', { exact: true }) });
    const requestSummaryBox = await settingsRequest.locator('summary').boundingBox();
    const responseSummaryBox = await settingsResponse.locator('summary').boundingBox();
    expect(
      requestSummaryBox && responseSummaryBox && requestSummaryBox.x < responseSummaryBox.x,
    ).toBe(true);
    await settingsRequest.locator('summary').click();
    await expect(settingsRequest.locator('pre')).toContainText('"method": "PATCH"');
    await expect(settingsRequest.locator('pre')).toContainText('"skillPrerequisitePolicy": "warn"');
    await settingsResponse.locator('summary').click();
    await expect(settingsResponse.locator('pre')).toContainText('"newRevision"');
    for (const locator of [
      logDialog.locator('.modal-box'),
      settingsTitle,
      settingsRequest.locator('pre'),
      settingsResponse.locator('pre'),
    ]) {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('Expected visible settings sync details');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
    }
    await captureReviewScreenshot(page, {
      path: testInfo.outputPath(`sync-log-settings-${width}.png`),
    });
    await logDialog.getByRole('button', { name: 'Close sync log' }).click();
  }
  await saved().click();
  const linkedDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
  await linkedDialog
    .getByRole('link', { name: `Campaign: ${campaignName} · campaign rules updated` })
    .click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect(linkedDialog).toBeHidden();

  // Block the real socket on a reload while HTTP remains usable.
  await page.routeWebSocket('**/api/v1/sync/ws**', (socket) => socket.close());
  await page.reload();
  await expect(saved()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'All changes saved', exact: true })).toBeVisible();
  await saved().hover();
  await expect(page.getByRole('tooltip')).toContainText('All changes synced');
  await expect(page.getByRole('tooltip')).not.toContainText('Live updates connected');
  await saved().click();
  const disconnectedDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Sync log' }) });
  await expect(
    disconnectedDialog.getByText('Disconnected · Reconnecting', { exact: true }),
  ).toBeVisible();
  await expect(disconnectedDialog.getByText(/Last connected/)).toBeVisible();
  await expect(
    disconnectedDialog.getByText('HTTP sync continues while WebSocket reconnects.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(disconnectedDialog.getByText('Last sync', { exact: true })).toBeVisible();
  const manualPull = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/sync/cursor') && response.request().method() === 'POST',
  );
  await disconnectedDialog.getByRole('button', { name: 'Sync now' }).click();
  expect((await manualPull).ok()).toBe(true);
  await expect(page.getByText('Sync completed', { exact: true })).toBeVisible();
  await expect(
    disconnectedDialog
      .getByText('Last sync', { exact: true })
      .locator('..')
      .getByText('just now', { exact: true }),
  ).toBeVisible();
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('sync-log-websocket-disconnected.png'),
    animations: 'disabled',
  });
});
