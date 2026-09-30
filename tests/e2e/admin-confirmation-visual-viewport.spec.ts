import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import type { Tokens } from '../../src/client/lib/tokenStore.ts';

async function readVisualViewport(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const visual = window.visualViewport;
    const left = visual?.offsetLeft ?? 0;
    const top = visual?.offsetTop ?? 0;
    const width = visual?.width ?? window.innerWidth;
    const height = visual?.height ?? window.innerHeight;
    return {
      bounds: { left, top, right: left + width, bottom: top + height },
      scale: visual?.scale ?? 1,
      width,
      height,
    };
  });
}

async function expectInsideVisualViewport(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
) {
  const [box, visual] = await Promise.all([locator.boundingBox(), readVisualViewport(page)]);
  expect(box, 'confirmation content has a measurable box').not.toBeNull();
  if (!box) return;
  const context = JSON.stringify({ box, viewport: visual });
  expect(box.x, context).toBeGreaterThanOrEqual(visual.bounds.left - 1);
  expect(box.y, context).toBeGreaterThanOrEqual(visual.bounds.top - 1);
  expect(box.x + box.width, context).toBeLessThanOrEqual(visual.bounds.right + 1);
  expect(box.y + box.height, context).toBeLessThanOrEqual(visual.bounds.bottom + 1);
}

async function expectTextInsideVisualViewport(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
) {
  const [rects, visual] = await Promise.all([
    locator.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return [...range.getClientRects()].map(({ left, top, right, bottom }) => ({
        left,
        top,
        right,
        bottom,
      }));
    }),
    readVisualViewport(page),
  ]);
  expect(rects.length).toBeGreaterThan(0);
  for (const rect of rects) {
    const context = JSON.stringify({ rect, viewport: visual });
    expect(rect.left, context).toBeGreaterThanOrEqual(visual.bounds.left - 1);
    expect(rect.top, context).toBeGreaterThanOrEqual(visual.bounds.top - 1);
    expect(rect.right, context).toBeLessThanOrEqual(visual.bounds.right + 1);
    expect(rect.bottom, context).toBeLessThanOrEqual(visual.bounds.bottom + 1);
  }
}

async function expectPhraseInsideVisualViewport(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
  phrase: string,
) {
  const [rect, visual] = await Promise.all([
    locator.evaluate((element, exactPhrase) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const start = node.textContent?.indexOf(exactPhrase) ?? -1;
        if (start >= 0) {
          const range = document.createRange();
          range.setStart(node, start);
          range.setEnd(node, start + exactPhrase.length);
          const bounds = range.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
          };
        }
        node = walker.nextNode();
      }
      return null;
    }, phrase),
    readVisualViewport(page),
  ]);
  expect(rect, `visible text phrase ${JSON.stringify(phrase)} exists`).not.toBeNull();
  if (!rect) return;
  const context = JSON.stringify({ phrase, rect, viewport: visual });
  expect(rect.left, context).toBeGreaterThanOrEqual(visual.bounds.left - 1);
  expect(rect.top, context).toBeGreaterThanOrEqual(visual.bounds.top - 1);
  expect(rect.right, context).toBeLessThanOrEqual(visual.bounds.right + 1);
  expect(rect.bottom, context).toBeLessThanOrEqual(visual.bounds.bottom + 1);
}

async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test('admin purge confirmation stays reachable through short viewports, pinch zoom and rotation', async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database',
  );
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);

  const pool = new Pool({ connectionString: process.env.ADMIN_E2E_DATABASE_URL });
  const password = 'AdminBrowserFixture123!';
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const adminEmail = `admin-dialog-${suffix}@example.com`;
  const memberEmail = `member-dialog-${suffix}@example.com`;
  const createdCampaignIds: string[] = [];
  let createdCharacterId: string | undefined;
  async function register(email: string, displayName: string) {
    const response = await request.post('/api/v1/auth/register', {
      data: { email, displayName, password },
    });
    expect(response.status()).toBe(201);
    const result = await pool.query<{ id: string }>('select id from users where email=$1', [email]);
    const user = result.rows[0];
    if (!user) throw new Error('Registered admin fixture user not found');
    return { user, tokens: (await response.json()) as Tokens };
  }

  const cdp = await page.context().newCDPSession(page);
  try {
    const admin = await register(adminEmail, 'Admin dialog fixture');
    const member = await register(memberEmail, 'Admin confirmation target');
    await pool.query('update users set is_superuser=true where id=$1', [admin.user.id]);
    await page.addInitScript((tokens) => {
      if (!sessionStorage.getItem('admin-dialog-e2e-session-ready')) {
        localStorage.setItem(
          'gpc.tokenPair.v1',
          JSON.stringify({
            ...tokens,
            sessionId: crypto.randomUUID(),
            version: 0,
            refreshRequestId: crypto.randomUUID(),
          }),
        );
        sessionStorage.setItem('admin-dialog-e2e-session-ready', '1');
      }
    }, admin.tokens);

    await page.setViewportSize({ width: 568, height: 320 });
    await page.goto(`/admin/users/${member.user.id}`);
    await expect(page.getByRole('heading', { name: 'Admin confirmation target' })).toBeVisible();
    const trigger = page.getByRole('button', { name: 'Schedule purge (30 d)', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Schedule account purge?' });
    const box = dialog.locator('.modal-box');
    const context = dialog.locator('.py-3');
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Schedule purge', exact: true });

    const openAndCheck = async (label: string, scale: number, checkFocus = true) => {
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute('open', '');
      await expect(dialog).toContainText(memberEmail);
      const visual = await readVisualViewport(page);
      expect(visual.scale).toBeCloseTo(scale, 1);
      await expectInsideVisualViewport(page, dialog);
      await expectInsideVisualViewport(page, box);
      await expect(dialog).toContainText('After 30 days');
      if (checkFocus) {
        expect(
          await dialog.evaluate((element) => element.contains(document.activeElement)),
          `${label}: native modal should own keyboard focus`,
        ).toBe(true);
      }

      // The title, warning text, and both actions remain reachable as the
      // long confirmation content scrolls inside its native dialog.
      const title = dialog.getByRole('heading', { name: 'Schedule account purge?' });
      await box.evaluate((element) => {
        element.scrollTop = 0;
      });
      await settle(page);
      await expect(title).toBeVisible();
      await expectTextInsideVisualViewport(page, title);
      await expectPhraseInsideVisualViewport(page, context, 'This immediately suspends');
      await page.screenshot({
        path: testInfo.outputPath(`admin-confirmation-${label}-top.png`),
        animations: 'disabled',
      });

      await box.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await settle(page);
      await expect(context).toBeVisible();
      await expectPhraseInsideVisualViewport(
        page,
        context,
        'cancellation leaves the account suspended.',
      );
      for (const action of [cancel, confirm]) {
        await expect(action).toBeVisible();
        await expectTextInsideVisualViewport(page, action);
        const hitTestable = await action.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit === element || (hit !== null && element.contains(hit));
        });
        expect(hitTestable, `${label}: action center should receive pointer input`).toBe(true);
      }
      await expectInsideVisualViewport(page, box);
      await page.screenshot({
        path: testInfo.outputPath(`admin-confirmation-${label}-actions.png`),
        animations: 'disabled',
      });
      const measurements = {
        label,
        visualViewport: visual,
        modal: await box.boundingBox(),
        title: await title.boundingBox(),
        context: await context.boundingBox(),
        cancel: await cancel.boundingBox(),
        confirm: await confirm.boundingBox(),
        scroll: await box.evaluate((element) => ({
          top: element.scrollTop,
          height: element.clientHeight,
          contentHeight: element.scrollHeight,
        })),
      };
      await testInfo.attach(`admin-confirmation-${label}.json`, {
        body: JSON.stringify(measurements, null, 2),
        contentType: 'application/json',
      });
    };

    // Start from a short landscape viewport before opening the real purge
    // confirmation, so the first open state exercises ordinary responsive CSS.
    await trigger.click();
    await openAndCheck('short-landscape-before-zoom', 1);
    await cancel.click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();

    // Open at 1x and keep the same native dialog open while pinching in.
    await page.setViewportSize({ width: 667, height: 375 });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 667,
      height: 375,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await trigger.click();
    await openAndCheck('landscape-open-before-pinch', 1);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await openAndCheck('landscape-reopened-before-pinch', 1);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await settle(page);
    await openAndCheck('landscape-open-at-2x', 2);

    // Reopen after Escape and keep the same native dialog through pinch zoom.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await openAndCheck('landscape-open-at-2x-after-reopen', 2);

    // Rotate the viewport while the same dialog is open, then verify the
    // reflow and all long text/actions at the short landscape and portrait sizes.
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await page.setViewportSize({ width: 375, height: 667 });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await settle(page);
    // Mobile Chromium can return focus to the document when device metrics
    // rotate an already-open modal; geometry and content remain the contract.
    await openAndCheck('portrait-after-rotation', 1, false);
    await page.setViewportSize({ width: 568, height: 320 });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 568,
      height: 320,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await settle(page);
    await openAndCheck('landscape-after-rotation', 1, false);

    await page.mouse.click(2, 2);
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    // Exercise the same shared confirmation component from a player surface,
    // using synthetic campaign and character rows owned by this fixture admin.
    const headers = { Authorization: `Bearer ${admin.tokens.accessToken}` };
    const sourceCampaignResponse = await request.post('/api/v1/campaigns', {
      headers,
      data: { name: `Dialog source ${suffix}` },
    });
    expect(sourceCampaignResponse.status()).toBe(201);
    const sourceCampaign = (await sourceCampaignResponse.json()) as { id: string };
    createdCampaignIds.push(sourceCampaign.id);
    const destinationCampaignResponse = await request.post('/api/v1/campaigns', {
      headers,
      data: { name: `Dialog destination ${suffix}` },
    });
    expect(destinationCampaignResponse.status()).toBe(201);
    const destinationCampaign = (await destinationCampaignResponse.json()) as { id: string };
    createdCampaignIds.push(destinationCampaign.id);
    const characterResponse = await request.post('/api/v1/characters', {
      headers,
      data: { name: 'Shared confirmation fixture', campaignId: sourceCampaign.id },
    });
    expect(characterResponse.status()).toBe(201);
    const character = (await characterResponse.json()) as { id: string };
    createdCharacterId = character.id;

    await page.setViewportSize({ width: 568, height: 320 });
    await page.goto(`/characters/${character.id}`);
    const campaignSelect = page.getByLabel('campaign', { exact: true });
    await expect(campaignSelect).toBeVisible();
    await campaignSelect.selectOption(destinationCampaign.id);
    const sharedDialog = page.getByRole('dialog', { name: 'Change character campaign?' });
    await expect(sharedDialog).toBeVisible();
    await expect(sharedDialog).toContainText(
      'Changing or leaving this campaign may impact your character sheet.',
    );
    const sharedBox = sharedDialog.locator('.modal-box');
    const sharedContext = sharedDialog.locator('.py-3');
    const sharedCancel = sharedDialog.getByRole('button', { name: 'Cancel', exact: true });
    const sharedConfirm = sharedDialog.getByRole('button', {
      name: 'Change campaign',
      exact: true,
    });
    await expectInsideVisualViewport(page, sharedBox);
    await sharedBox.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await settle(page);
    await expect(sharedContext).toBeVisible();
    await expectPhraseInsideVisualViewport(
      page,
      sharedContext,
      'Changing or leaving this campaign may impact your character sheet.',
    );
    for (const action of [sharedCancel, sharedConfirm]) {
      await expect(action).toBeVisible();
      await expectTextInsideVisualViewport(page, action);
    }
    await page.screenshot({
      path: testInfo.outputPath('shared-player-confirmation-actions.png'),
      animations: 'disabled',
    });
    await page.keyboard.press('Escape');
    await expect(sharedDialog).not.toBeVisible();
    await expect(campaignSelect).toBeVisible();
    await expect(campaignSelect).toHaveValue(sourceCampaign.id);
  } finally {
    try {
      if (createdCharacterId) {
        await pool.query('delete from characters where id=$1', [createdCharacterId]);
      }
      if (createdCampaignIds.length > 0) {
        await pool.query('delete from campaigns where id=ANY($1::uuid[])', [createdCampaignIds]);
      }
      await pool.query('delete from users where email=ANY($1::text[])', [
        [adminEmail, memberEmail],
      ]);
    } finally {
      await pool.end();
      await cdp.detach();
    }
  }
});
