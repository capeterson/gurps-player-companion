import { type Page, expect, test } from '@playwright/test';
import {
  CLIENT_OUTDATED_ERROR,
  MIN_SUPPORTED_SYNC_PROTOCOL,
  SYNC_PROTOCOL_VERSION,
} from '../../src/shared/syncProtocol.ts';
import { captureReviewScreenshot } from './review-artifacts';

async function readOutbox(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const request = database.transaction('outbox').objectStore('outbox').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

test('app update toast keeps its message and buttons readable inside the viewport', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();

  const message = 'A new version of the app is available.';
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('gpc:sw-update-ready', {
        detail: {
          reload: () => document.body.setAttribute('data-reload-clicked', 'true'),
        },
      }),
    );
  });

  const alert = page.getByRole('alert').filter({ hasText: message });
  const action = alert.getByRole('button', { name: 'Reload', exact: true });
  const dismiss = alert.getByRole('button', { name: 'Dismiss notification' });

  // Reuse the same page across mobile widths and either side of the toast's
  // 640px breakpoint (and daisyUI's 768px breakpoint).
  for (const width of [320, 393, 639, 640, 641, 767, 768, 769, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(alert.getByText(message, { exact: true })).toBeVisible();
    await expect(action).toBeVisible();
    await expect(dismiss).toBeVisible();

    const geometry = await alert.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const parts = [...element.children].map((child) => {
        const bounds = child.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(child);
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          text: [...range.getClientRects()].map((line) => ({
            left: line.left,
            top: line.top,
            right: line.right,
            bottom: line.bottom,
          })),
        };
      });
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        overflow: element.scrollWidth > element.clientWidth,
        viewport: {
          left: viewport?.offsetLeft ?? 0,
          top: viewport?.offsetTop ?? 0,
          right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth),
          bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight),
        },
        parts,
      };
    });

    expect(geometry.left).toBeGreaterThanOrEqual(geometry.viewport.left - 1);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewport.top - 1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport.right + 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport.bottom + 1);
    expect(geometry.overflow).toBe(false);
    for (const part of geometry.parts) {
      expect(part.left).toBeGreaterThanOrEqual(geometry.left);
      expect(part.top).toBeGreaterThanOrEqual(geometry.top);
      expect(part.right).toBeLessThanOrEqual(geometry.right);
      expect(part.bottom).toBeLessThanOrEqual(geometry.bottom);
      for (const line of part.text) {
        expect(line.left).toBeGreaterThanOrEqual(part.left - 1);
        expect(line.right).toBeLessThanOrEqual(part.right + 1);
        expect(line.top).toBeGreaterThanOrEqual(part.top - 1);
        expect(line.bottom).toBeLessThanOrEqual(part.bottom + 1);
      }
    }
    expect(geometry.parts[1]?.text).toHaveLength(1);
    expect(geometry.parts[0]?.right).toBeLessThanOrEqual(geometry.parts[1]?.left ?? 0);
    expect(geometry.parts[1]?.right).toBeLessThanOrEqual(geometry.parts[2]?.left ?? 0);

    if ([320, 640, 1024].includes(width)) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`update-toast-available-${width}.png`),
        animations: 'disabled',
      });
    }
  }

  await action.click();
  await expect(page.locator('body')).toHaveAttribute('data-reload-clicked', 'true');
  await expect(alert).toHaveCount(0);
});

test('a real 426 keeps the queued edit and waits for the user to reload', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`sw-update-426-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Update prompt QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/characters');
  await page.getByLabel(/new character name/i).fill('Queued update hero');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/, { timeout: 15_000 });
  await expect.poll(async () => (await readOutbox(page)).length).toBe(0);

  let outdatedResponses = 0;
  await page.route('**/api/v1/sync/operations', async (route) => {
    outdatedResponses++;
    await route.fulfill({
      status: 426,
      contentType: 'application/json',
      body: JSON.stringify({
        error: CLIENT_OUTDATED_ERROR,
        clientProtocol: MIN_SUPPORTED_SYNC_PROTOCOL - 1,
        minProtocol: MIN_SUPPORTED_SYNC_PROTOCOL,
        serverProtocol: SYNC_PROTOCOL_VERSION,
      }),
    });
  });

  await page.evaluate(() => Reflect.set(window, '__swUpdateTestMount', crypto.randomUUID()));
  const mountId = await page.evaluate(() => Reflect.get(window, '__swUpdateTestMount'));
  const strength = page.getByRole('textbox', { name: 'ST base', exact: true });
  await strength.fill('12');
  await strength.blur();

  const message = 'A new version of the app is available.';
  const alert = page.getByRole('alert').filter({ hasText: message });
  const reload = alert.getByRole('button', { name: 'Reload', exact: true });
  await expect(alert.getByText(message, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(reload).toBeVisible();
  await expect.poll(() => outdatedResponses).toBeGreaterThan(0);
  await expect(strength).toHaveValue('12');
  await expect
    .poll(async () =>
      (await readOutbox(page)).some((op) => op.fieldPath === 'st' && op.attemptedValue === 12),
    )
    .toBe(true);

  // A prolonged idle period, leaving the editor, and focus/online checks must
  // never activate the worker or reload around the user's queued edit.
  await strength.focus();
  await strength.blur();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  await page.waitForTimeout(4_000);
  await expect(alert.getByText(message, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, '__swUpdateTestMount'))).toBe(mountId);
  expect(outdatedResponses).toBe(1);
  expect(await readOutbox(page)).toEqual(
    expect.arrayContaining([expect.objectContaining({ fieldPath: 'st', attemptedValue: 12 })]),
  );

  // Reuse this account and page at every reported width while the same
  // persistent prompt remains visible.
  for (const width of [320, 393, 639, 640, 641, 767, 768, 769, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(reload).toBeVisible();
    const box = await alert.boundingBox();
    if (!box) throw new Error('Expected the persistent app-update toast');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    if ([320, 640, 1024].includes(width)) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`real-426-update-toast-${width}.png`),
        animations: 'disabled',
      });
    }
  }

  await page.unroute('**/api/v1/sync/operations');
  const reloaded = page.waitForEvent('load', { timeout: 15_000 });
  await reload.click();
  await reloaded;
  await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+/);
  await expect.poll(async () => (await readOutbox(page)).length, { timeout: 15_000 }).toBe(0);
  await expect(page.getByRole('textbox', { name: 'ST base', exact: true })).toHaveValue('12');
});
