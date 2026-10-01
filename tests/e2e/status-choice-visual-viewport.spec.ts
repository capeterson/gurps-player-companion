import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const password = 'CorrectHorseBatteryStaple1';
const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

async function settle(page: import('@playwright/test').Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function viewport(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const visual = window.visualViewport;
    return {
      left: visual?.offsetLeft ?? 0,
      top: visual?.offsetTop ?? 0,
      right: (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
      bottom: (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
      scale: visual?.scale ?? 1,
    };
  });
}

async function expectOverlayContained(
  page: import('@playwright/test').Page,
  overlay: import('@playwright/test').Locator,
) {
  const [box, visible] = await Promise.all([overlay.boundingBox(), viewport(page)]);
  expect(box, 'open overlay has a measurable box').not.toBeNull();
  if (!box) return;
  expect(box.x, JSON.stringify({ box, visible })).toBeGreaterThanOrEqual(visible.left - 1);
  expect(box.y, JSON.stringify({ box, visible })).toBeGreaterThanOrEqual(visible.top - 1);
  expect(box.x + box.width, JSON.stringify({ box, visible })).toBeLessThanOrEqual(
    visible.right + 1,
  );
  expect(box.y + box.height, JSON.stringify({ box, visible })).toBeLessThanOrEqual(
    visible.bottom + 1,
  );
}

async function expectTextContained(
  page: import('@playwright/test').Page,
  element: import('@playwright/test').Locator,
) {
  const [rects, visible] = await Promise.all([
    element.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].map(({ left, top, right, bottom }) => ({
        left,
        top,
        right,
        bottom,
      }));
    }),
    viewport(page),
  ]);
  expect(rects.length).toBeGreaterThan(0);
  for (const rect of rects) {
    expect(rect.left, JSON.stringify({ rect, visible })).toBeGreaterThanOrEqual(visible.left - 1);
    expect(rect.top, JSON.stringify({ rect, visible })).toBeGreaterThanOrEqual(visible.top - 1);
    expect(rect.right, JSON.stringify({ rect, visible })).toBeLessThanOrEqual(visible.right + 1);
    expect(rect.bottom, JSON.stringify({ rect, visible })).toBeLessThanOrEqual(visible.bottom + 1);
  }
}

async function tapByHitTest(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
) {
  await target.scrollIntoViewIfNeeded();
  await settle(page);
  const point = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    const panel = element.closest('.dropdown-content, [role="dialog"]');
    const panelRect = panel?.getBoundingClientRect();
    return {
      x,
      y,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      panelRect: panelRect && {
        left: panelRect.left,
        top: panelRect.top,
        right: panelRect.right,
        bottom: panelRect.bottom,
      },
      isInsidePanel:
        panelRect !== undefined &&
        rect.left >= panelRect.left &&
        rect.top >= panelRect.top &&
        rect.right <= panelRect.right &&
        rect.bottom <= panelRect.bottom,
      hitTarget:
        hit instanceof Element
          ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${String(hit.className).replaceAll(' ', '.')}`
          : null,
      isHit: hit === element || (hit !== null && element.contains(hit)),
    };
  });
  const visible = await viewport(page);
  expect(point.rect.left, JSON.stringify({ point, visible })).toBeGreaterThanOrEqual(visible.left);
  expect(point.rect.right, JSON.stringify({ point, visible })).toBeLessThanOrEqual(visible.right);
  expect(point.rect.top, JSON.stringify({ point, visible })).toBeGreaterThanOrEqual(visible.top);
  expect(point.rect.bottom, JSON.stringify({ point, visible })).toBeLessThanOrEqual(visible.bottom);
  expect(point.isInsidePanel, JSON.stringify(point)).toBe(true);
  expect(
    point.isHit,
    `the visible center of the control receives the hit test: ${JSON.stringify({ point, visible })}`,
  ).toBe(true);
  await page.touchscreen.tap(point.x, point.y);
}

test('Current Status choice panels and temporary modifiers remain usable in touch landscape and pinch zoom', async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    viewport: { width: 568, height: 320 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  try {
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(`status-choice-${suffix()}@example.com`);
    await page.getByLabel(/display name/i).fill('Status Choice QA');
    await page.getByLabel(/^password\b/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).tap();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    const headers = { Authorization: `Bearer ${token}` };
    const created = await page.request.post('/api/v1/characters', {
      headers,
      data: { name: 'Landscape Status Probe', st: 15, dx: 15, iq: 15, ht: 15 },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const character = (await created.json()) as { id: string };
    await page.goto('/settings');
    await page.getByRole('checkbox', { name: 'Show posture in Current Status' }).check();
    await page.getByRole('checkbox', { name: 'Show maneuver in Current Status' }).check();
    await page.getByRole('checkbox', { name: 'Show conditions in Current Status' }).check();
    await page.goto(`/characters/${character.id}`);
    const bar = page.getByRole('complementary', { name: 'Current Status' });
    await expect(bar).toBeVisible();

    for (const size of [
      { width: 568, height: 320, label: 'landscape' },
      { width: 390, height: 844, label: 'portrait' },
      { width: 1279, height: 844, label: 'below-wide-breakpoint' },
      { width: 1280, height: 844, label: 'at-wide-breakpoint' },
      { width: 1281, height: 844, label: 'above-wide-breakpoint' },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await settle(page);
      for (const choice of [
        { name: 'posture', title: 'Posture', action: 'Prone' },
        { name: 'maneuver', title: 'Maneuver', action: 'Move' },
        { name: 'conditions', title: 'Conditions', action: 'Mortally wounded' },
      ]) {
        const trigger = bar.getByRole('button', { name: new RegExp(`^Change ${choice.name},`) });
        await trigger.tap();
        const panel = bar
          .getByRole('heading', { name: choice.title, exact: true })
          .locator('xpath=..');
        await expect(panel).toBeVisible();
        await expectOverlayContained(page, panel);
        const chip = panel.getByRole('button', { name: new RegExp(`^${choice.action}$`, 'i') });
        await expect(chip).toBeVisible();
        await expectTextContained(page, chip);
        await page.screenshot({
          path: testInfo.outputPath(`status-${choice.name}-${size.label}-open.png`),
          animations: 'disabled',
        });
        await tapByHitTest(page, chip);
        if (choice.name === 'conditions') {
          await tapByHitTest(page, panel.getByRole('button', { name: 'Done', exact: true }));
        }
        await expect(panel).toHaveCount(0);
      }
    }

    // A selected maneuver exposes one of the longest supported rules blurbs.
    await bar.getByRole('button', { name: /^Change maneuver,/ }).tap();
    const maneuverPanel = bar
      .getByRole('heading', { name: 'Maneuver', exact: true })
      .locator('xpath=..');
    await expect(maneuverPanel).toBeVisible();
    await maneuverPanel.getByRole('button', { name: 'All-Out Attack', exact: true }).tap();
    await bar.getByRole('button', { name: /^Change maneuver,/ }).tap();
    await expect(maneuverPanel).toBeVisible();
    await expect(maneuverPanel.getByText(/\+4 melee\/\+1 ranged to hit/)).toBeVisible();
    await page.keyboard.press('Escape');

    // Reach the final preset from the scrolled panel, then select it by touch.
    await page.setViewportSize({ width: 568, height: 320 });
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await settle(page);
    await page.keyboard.press('Escape');
    await bar.getByRole('button', { name: /^Change maneuver,/ }).tap();
    await expect(maneuverPanel).toBeVisible();
    const finalManeuver = maneuverPanel.getByRole('button', { name: 'Wait', exact: true });
    await finalManeuver.scrollIntoViewIfNeeded();
    await tapByHitTest(page, finalManeuver);
    await expect(maneuverPanel).toHaveCount(0);

    // Restore the long representative blurb for geometry and readable-text checks.
    await bar.getByRole('button', { name: /^Change maneuver,/ }).tap();
    await expect(maneuverPanel).toBeVisible();
    const longManeuver = maneuverPanel.getByRole('button', { name: 'All-Out Attack', exact: true });
    await longManeuver.scrollIntoViewIfNeeded();
    await tapByHitTest(page, longManeuver);
    await expect(maneuverPanel).toHaveCount(0);

    const pinchCases = [
      { width: 390, height: 844, name: 'portrait', scales: [2] },
      { width: 568, height: 320, name: 'landscape', scales: [1.5, 2] },
    ];
    for (const viewportSize of pinchCases) {
      await page.setViewportSize({ width: viewportSize.width, height: viewportSize.height });
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await settle(page);
      await bar.getByRole('button', { name: /^Change maneuver,/ }).tap();
      await expect(maneuverPanel).toBeVisible();
      for (const scale of viewportSize.scales) {
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
        await settle(page);
        await expectOverlayContained(page, maneuverPanel);
        await page.screenshot({
          path: testInfo.outputPath(
            `status-maneuver-${viewportSize.name}-pinch-${Math.round(scale * 100)}-open.png`,
          ),
          animations: 'disabled',
        });
        const longestBlurb = maneuverPanel.getByText(/\+4 melee\/\+1 ranged to hit/);
        await expect(longestBlurb).toBeVisible();
        await longestBlurb.scrollIntoViewIfNeeded();
        await settle(page);
        await expectTextContained(page, longestBlurb);
        await expectOverlayContained(page, maneuverPanel);
        await page.screenshot({
          path: testInfo.outputPath(
            `status-maneuver-${viewportSize.name}-pinch-${Math.round(scale * 100)}-blurb.png`,
          ),
          animations: 'disabled',
        });
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
        await settle(page);
      }
      await page.keyboard.press('Escape');
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    }

    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/characters/${character.id}`);
    const overview = page.getByRole('button', { name: /Sheet overview/ });
    if ((await overview.getAttribute('aria-expanded')) === 'false') await overview.tap();
    const modifierTrigger = page.getByRole('button', { name: 'Edit IQ modifiers' });
    await modifierTrigger.scrollIntoViewIfNeeded();
    await modifierTrigger.tap();
    const modifiers = page.getByRole('dialog', { name: 'Modifiers for IQ' });
    await expect(modifiers).toBeVisible();
    // Keep the real popover open as the viewport rotates to a short landscape
    // layout, then zoom it. The hook must recompute both bounds after resize.
    await page.setViewportSize({ width: 568, height: 320 });
    await settle(page);
    for (const scale of [1, 1.5, 2]) {
      await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
      await settle(page);
      await expectOverlayContained(page, modifiers);
      const modifierTitle = modifiers.getByText('IQ modifiers', { exact: true });
      await expect(modifierTitle).toBeVisible();
      await expectTextContained(page, modifierTitle);
      await tapByHitTest(page, modifierTitle);
      await page.screenshot({
        path: testInfo.outputPath(`status-modifier-pinch-${Math.round(scale * 100)}-open.png`),
        animations: 'disabled',
      });
      await modifiers.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await settle(page);
      const apply = modifiers.getByRole('button', { name: 'Apply' });
      await expect(apply).toBeVisible();
      await expectTextContained(page, apply);
      if (scale === 2) {
        await modifiers.getByRole('textbox', { name: 'Temporary IQ delta' }).fill('1');
      }
      await tapByHitTest(page, apply);
      await expect(modifiers).toHaveCount(0);
      if (scale !== 2) {
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
        await settle(page);
        await modifierTrigger.tap();
        await expect(modifiers).toBeVisible();
      }
    }
    await expect(modifierTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(modifierTrigger).toHaveClass(/text-warning/);
  } finally {
    await context.close();
  }
});
