import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const password = 'CorrectHorseBatteryStaple1';

async function hitTestTextAtNavigationOverlap(
  text: import('@playwright/test').Locator,
  poolLabel: string,
) {
  return text.evaluate((element, label) => {
    const nav = document.querySelector('.sheet-flower .sheet-nav-toggle');
    if (!(nav instanceof HTMLElement)) throw new Error('Closed navigation toggle was not found');
    const navRect = nav.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const overlap = [...range.getClientRects()]
      .map((line) => ({
        left: Math.max(line.left, navRect.left),
        right: Math.min(line.right, navRect.right),
        top: Math.max(line.top, navRect.top),
        bottom: Math.min(line.bottom, navRect.bottom),
      }))
      .find((rect) => rect.right > rect.left && rect.bottom > rect.top);
    if (!overlap) return { overlapsNavigation: false, hitPool: false, hitNavigation: false };
    const hit = document.elementFromPoint(
      (overlap.left + overlap.right) / 2,
      (overlap.top + overlap.bottom) / 2,
    );
    return {
      overlapsNavigation: true,
      hitPool: hit?.closest(`fieldset[aria-label="${label} adjustment"]`) != null,
      hitNavigation: hit?.closest('.sheet-flower') != null,
    };
  }, poolLabel);
}

async function settleLayout(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function expectInsideVisualViewport(locator: import('@playwright/test').Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Expected overlay bounds to be present');
  const viewport = await locator.page().evaluate(() => {
    const visual = window.visualViewport;
    return visual
      ? {
          left: visual.offsetLeft,
          top: visual.offsetTop,
          right: visual.offsetLeft + visual.width,
          bottom: visual.offsetTop + visual.height,
        }
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  });
  expect(bounds.x).toBeGreaterThanOrEqual(viewport.left - 1);
  expect(bounds.y).toBeGreaterThanOrEqual(viewport.top - 1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.right + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.bottom + 1);
}

async function expectTextInsideVisualViewport(locator: import('@playwright/test').Locator) {
  const bounds = await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].map(({ left, top, right, bottom }) => ({
      left,
      top,
      right,
      bottom,
    }));
  });
  const viewport = await locator.page().evaluate(() => {
    const visual = window.visualViewport;
    return visual
      ? {
          left: visual.offsetLeft,
          top: visual.offsetTop,
          right: visual.offsetLeft + visual.width,
          bottom: visual.offsetTop + visual.height,
        }
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  });
  expect(bounds.length).toBeGreaterThan(0);
  for (const line of bounds) {
    expect(line.left).toBeGreaterThanOrEqual(viewport.left - 1);
    expect(line.top).toBeGreaterThanOrEqual(viewport.top - 1);
    expect(line.right).toBeLessThanOrEqual(viewport.right + 1);
    expect(line.bottom).toBeLessThanOrEqual(viewport.bottom + 1);
  }
}

async function register(page: import('@playwright/test').Page) {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`pool-overlay-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Pool Overlay QA');
  await page.getByLabel(/^password\b/i).fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
}

test('pool popovers keep endpoint text above the mobile navigation flower', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const token = await register(page);
  const headers = { Authorization: `Bearer ${token}` };
  const createCharacter = await page.request.post('/api/v1/characters', {
    headers,
    data: {
      name: 'Pool Boundary Surveyor',
      st: 99,
      dx: 99,
      iq: 99,
      ht: 99,
      hpMod: 50,
      fpMod: 50,
    },
  });
  expect(createCharacter.ok(), await createCharacter.text()).toBeTruthy();
  const character = (await createCharacter.json()) as { id: string };
  const combatResponse = await page.request.patch(`/api/v1/characters/${character.id}/combat`, {
    headers,
    data: { currentHp: -1000, currentFp: -1000 },
  });
  expect(combatResponse.ok(), await combatResponse.text()).toBeTruthy();
  await page.goto(`/characters/${character.id}`);
  await expect(page.getByRole('button', { name: /Adjust HP, current -1000 of 149/ })).toBeVisible();

  for (const pool of [
    {
      label: 'HP',
      title: 'Hit Points',
      lowEndpoint: 'Death check',
      fullEndpoint: 'Full',
      footnote:
        'At 0 HP or less, roll HT each turn to stay conscious. Death checks begin at −149 HP and repeat at each full −149 HP threshold; certain death is −745 HP.',
    },
    {
      label: 'FP',
      title: 'Fatigue Points',
      lowEndpoint: 'Unconscious',
      fullEndpoint: 'Rested',
      footnote: 'At −149 FP, further fatigue loss is paid from HP instead.',
    },
  ]) {
    await page.setViewportSize({ width: 568, height: 320 });
    const trigger = page.getByRole('button', {
      name: new RegExp(`Adjust ${pool.label}, current -1000 of 149`),
    });
    await trigger.click();
    const panel = page.locator(`fieldset[aria-label="${pool.label} adjustment"]`);
    await expect(panel).toBeVisible();
    await settleLayout(page);
    await expect(panel.getByText(pool.title, { exact: true })).toBeVisible();
    await expect(panel.getByLabel(`Current ${pool.label}`)).toHaveText('-1000');
    await expect(panel.getByText(pool.lowEndpoint, { exact: true }).first()).toBeVisible();
    const endpoint = panel.getByText(pool.fullEndpoint, { exact: true });
    await expect(endpoint).toBeVisible();
    const footnote = panel.getByText(pool.footnote, { exact: true });
    await expect(footnote).toBeVisible();

    if (pool.label === 'HP') {
      const screenshotPath = testInfo.outputPath('hp-popover-landscape-568x320.png');
      const screenshot = await page.screenshot({ animations: 'disabled' });
      await writeFile(screenshotPath, screenshot);
      await testInfo.attach('hp-popover-landscape-568x320', {
        path: screenshotPath,
        contentType: 'image/png',
      });
    }

    const navToggle = page.getByRole('button', { name: 'Open character navigation', exact: true });
    const endpointHit = await hitTestTextAtNavigationOverlap(endpoint, pool.label);
    if (endpointHit.overlapsNavigation) {
      expect(endpointHit.hitPool).toBe(true);
      expect(endpointHit.hitNavigation).toBe(false);
    }
    if (pool.label === 'HP') {
      const footnoteHit = await hitTestTextAtNavigationOverlap(footnote, pool.label);
      expect(footnoteHit.overlapsNavigation).toBe(true);
      expect(footnoteHit.hitPool).toBe(true);
      expect(footnoteHit.hitNavigation).toBe(false);
    }
    await expect(navToggle).toBeVisible();

    for (const viewport of [
      { width: 767, height: 900 },
      { width: 768, height: 900 },
      { width: 769, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await settleLayout(page);
      await expect(panel).toBeVisible();
      await expect(panel.getByText(pool.fullEndpoint, { exact: true })).toBeVisible();
      await expect(panel.getByText(pool.footnote, { exact: true })).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    }

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }

  const browser = page.context().browser();
  if (!browser) throw new Error('Chromium browser was not available for the touch viewport');
  const tokenPair = await page.evaluate(() => localStorage.getItem('gpc.tokenPair.v1'));
  expect(tokenPair).not.toBeNull();
  const touchContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 568, height: 320 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await touchContext.addInitScript((storedTokenPair) => {
    if (storedTokenPair) localStorage.setItem('gpc.tokenPair.v1', storedTokenPair);
  }, tokenPair);
  const touchPage = await touchContext.newPage();
  try {
    await touchPage.goto(`/characters/${character.id}`);
    await expect(
      touchPage.getByRole('button', { name: /Adjust HP, current -1000 of 149/ }),
    ).toBeVisible();
    const cdp = await touchContext.newCDPSession(touchPage);
    for (const pool of [
      {
        label: 'HP',
        fullEndpoint: 'Full',
        footnote:
          'At 0 HP or less, roll HT each turn to stay conscious. Death checks begin at −149 HP and repeat at each full −149 HP threshold; certain death is −745 HP.',
      },
      {
        label: 'FP',
        fullEndpoint: 'Rested',
        footnote: 'At −149 FP, further fatigue loss is paid from HP instead.',
      },
    ]) {
      const trigger = touchPage.getByRole('button', {
        name: new RegExp(`Adjust ${pool.label}, current -1000 of 149`),
      });
      await trigger.tap();
      const panel = touchPage.locator(`fieldset[aria-label="${pool.label} adjustment"]`);
      await expect(panel).toBeVisible();
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
      await settleLayout(touchPage);
      await expectInsideVisualViewport(panel);

      await panel.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await settleLayout(touchPage);
      const endpoint = panel.getByText(pool.fullEndpoint, { exact: true });
      const footnote = panel.getByText(pool.footnote, { exact: true });
      await expect(endpoint).toBeVisible();
      await expect(footnote).toBeVisible();
      await endpoint.scrollIntoViewIfNeeded();
      await settleLayout(touchPage);
      await expectTextInsideVisualViewport(endpoint);
      await footnote.scrollIntoViewIfNeeded();
      await settleLayout(touchPage);
      await expectTextInsideVisualViewport(footnote);
      if (pool.label === 'HP') {
        const screenshotPath = testInfo.outputPath('hp-pinch-150-percent-contained.png');
        const screenshot = await touchPage.screenshot({ animations: 'disabled' });
        await writeFile(screenshotPath, screenshot);
        await testInfo.attach('hp-pinch-150-percent-contained', {
          path: screenshotPath,
          contentType: 'image/png',
        });
      }

      const increase = panel.getByRole('button', { name: `Increase ${pool.label} by 1` });
      const increasedValue = pool.label === 'HP' ? '-745' : '-999';
      await increase.scrollIntoViewIfNeeded();
      await settleLayout(touchPage);
      const increaseBounds = await increase.boundingBox();
      expect(increaseBounds).not.toBeNull();
      if (!increaseBounds) throw new Error('Expected the increase control to be visible');
      const visualBounds = await touchPage.evaluate(() => {
        const visual = window.visualViewport;
        if (!visual) throw new Error('Expected a visual viewport on the touch page');
        return {
          left: visual.offsetLeft,
          top: visual.offsetTop,
          right: visual.offsetLeft + visual.width,
          bottom: visual.offsetTop + visual.height,
        };
      });
      const tapX = increaseBounds.x + increaseBounds.width / 2;
      const tapY = increaseBounds.y + increaseBounds.height / 2;
      expect(tapX).toBeGreaterThanOrEqual(visualBounds.left);
      expect(tapX).toBeLessThanOrEqual(visualBounds.right);
      expect(tapY).toBeGreaterThanOrEqual(visualBounds.top);
      expect(tapY).toBeLessThanOrEqual(visualBounds.bottom);
      await touchPage.touchscreen.tap(tapX, tapY);
      await expect(panel.getByLabel(`Current ${pool.label}`)).toHaveText(increasedValue);

      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await touchPage.setViewportSize({ width: 320, height: 568 });
      await settleLayout(touchPage);
      await expectInsideVisualViewport(panel);
      await expect(panel.getByLabel(`Current ${pool.label}`)).toHaveText(increasedValue);
      await panel.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await settleLayout(touchPage);
      await endpoint.scrollIntoViewIfNeeded();
      await settleLayout(touchPage);
      await expectTextInsideVisualViewport(endpoint);
      await footnote.scrollIntoViewIfNeeded();
      await settleLayout(touchPage);
      await expectTextInsideVisualViewport(footnote);
      await touchPage.setViewportSize({ width: 568, height: 320 });
      await settleLayout(touchPage);
      await expectInsideVisualViewport(panel);
      await expect(panel.getByLabel(`Current ${pool.label}`)).toHaveText(increasedValue);
      await touchPage.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(
        touchPage.getByRole('button', {
          name: new RegExp(`Adjust ${pool.label}, current ${increasedValue} of 149`),
        }),
      ).toBeVisible();
      await touchPage.setViewportSize({ width: 568, height: 320 });
    }
  } finally {
    await touchContext.close();
  }

  await page.setViewportSize({ width: 568, height: 320 });
  const openNavigation = page.getByRole('button', {
    name: 'Open character navigation',
    exact: true,
  });
  await openNavigation.click();
  await settleLayout(page);
  const flower = page.locator('.sheet-flower');
  await expect(flower).toHaveAttribute('data-open', 'true');
  const combat = flower.getByRole('button', { name: 'Combat', exact: true });
  await expect(combat).toBeVisible();
  const combatHit = await combat.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit?.closest('button')?.getAttribute('aria-label');
  });
  expect(combatHit).toBe('Combat');
  await combat.click();
  await expect(flower).toHaveAttribute('data-open', 'false');
  await expect(page.getByRole('heading', { name: 'Combat', exact: true })).toBeVisible();

  await openNavigation.click();
  await settleLayout(page);
  await expect(flower).toHaveAttribute('data-open', 'true');
  await page.getByRole('button', { name: 'Dismiss character navigation', exact: true }).click({
    position: { x: 48, y: 48 },
  });
  await expect(flower).toHaveAttribute('data-open', 'false');
});
