import { type Locator, type Page, expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

// The Sunbolt sun glow is anchored on the brand mark (--sun-x/--sun-y in
// theme.css), so the single-row desktop header must keep the mark's centre fixed.
const MARK_CENTRE = { x: 42, y: 30 };
const ROW_HEIGHT = 60;
// Tab order is the same code path at every width; check it at the extremes and the middle.
const FOCUS_WIDTHS = [1280, 1536, 1920];
const WIDTHS = [1280, 1281, 1440, 1535, 1536, 1791, 1792, 1920];
const LONG_NAME = 'Seraphina Alcántara-Whitlock the Unbowed of the Ninth Marches';

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value, 'element has a measurable box').not.toBeNull();
  return value as NonNullable<typeof value>;
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

const created: { headers: Record<string, string>; ids: string[] } = { headers: {}, ids: [] };

// Characters made for this spec go to the recycle bin afterwards.
test.afterEach(async ({ page }) => {
  for (const id of created.ids.splice(0)) {
    const removed = await page.request.delete(`/api/v1/characters/${id}`, {
      headers: created.headers,
    });
    expect(removed.ok(), await removed.text()).toBeTruthy();
  }
});

test('desktop character header keeps one row, the brand mark and keyboard order at any content width', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const auth = await page.evaluate(() => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    return raw ? ((JSON.parse(raw) as { accessToken?: string }).accessToken ?? '') : '';
  });
  const headers = { Authorization: `Bearer ${auth}` };
  created.headers = headers;
  const characters = (await (
    await page.request.get('/api/v1/characters', { headers })
  ).json()) as Array<{
    id: string;
    name: string;
  }>;
  const kestrelId = characters.find((character) => character.name === 'Kestrel Vale')?.id;
  expect(kestrelId).toBeTruthy();
  // Worst-case content: a name past the link's 320px cap and both pools at
  // their lowest supported values ("Death checks" / "Exhausted" warnings).
  async function createCharacter(name: string) {
    const response = await page.request.post('/api/v1/characters', {
      headers,
      data: { name, st: 15, dx: 15, iq: 15, ht: 15 },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const id = ((await response.json()) as { id: string }).id;
    created.ids.push(id);
    return id;
  }
  const stressId = await createCharacter(LONG_NAME);
  const shortId = await createCharacter('Ann');
  const patched = await page.request.patch(`/api/v1/characters/${stressId}/combat`, {
    headers,
    data: { currentHp: -1000, currentFp: -1000 },
  });
  expect(patched.ok(), await patched.text()).toBeTruthy();

  const header = page.locator('header').first();
  const mark = header.locator('.brand-mark:visible').first();
  const hp = header.getByRole('button', { name: /^Adjust HP,/ });
  const fp = header.getByRole('button', { name: /^Adjust FP,/ });
  const account = header.locator('summary[aria-label="Open user menu"]');
  const posture = header.getByRole('button', { name: /^Change posture,/ });
  const maneuver = header.getByRole('button', { name: /^Change maneuver,/ });
  const conditions = header.getByRole('button', { name: /^Change conditions,/ });
  const nameLink = header.locator('[data-header-name]');

  /** Row-1 controls in visual order, with their geometry. */
  async function rowBoxes() {
    const [markBox, nameBox, hpBox, fpBox, accountBox] = await Promise.all([
      box(mark),
      box(nameLink),
      box(hp),
      box(fp),
      box(account),
    ]);
    return { markBox, nameBox, hpBox, fpBox, accountBox };
  }

  async function checkRow(width: number, statusHeader: boolean, tag: string) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    const label = `${tag} ${width}px`;
    const { markBox, nameBox, hpBox, fpBox, accountBox } = await rowBoxes();
    expect(markBox.x + markBox.width / 2, `${label} mark x`).toBeCloseTo(MARK_CENTRE.x, 0);
    expect(markBox.y + markBox.height / 2, `${label} mark y`).toBeCloseTo(MARK_CENTRE.y, 0);

    // Nothing wraps: every row-1 control ends inside the 60px row.
    for (const control of [nameBox, hpBox, fpBox, accountBox]) {
      expect(control.y + control.height, `${label} stays on row 1`).toBeLessThanOrEqual(ROW_HEIGHT);
    }
    expect(hpBox.height, `${label} pool height`).toBeCloseTo(36, 0);
    expect(fpBox.height, `${label} pool height`).toBeCloseTo(36, 0);
    // No overlap, left to right: name, HP, FP, account inside the viewport.
    expect(nameBox.x + nameBox.width, `${label} name before HP`).toBeLessThanOrEqual(hpBox.x);
    expect(hpBox.x + hpBox.width, `${label} HP before FP`).toBeLessThanOrEqual(fpBox.x);
    expect(fpBox.x + fpBox.width, `${label} FP before account`).toBeLessThanOrEqual(accountBox.x);
    expect(accountBox.x + accountBox.width, `${label} account in viewport`).toBeLessThanOrEqual(
      width,
    );
    await expect(header.getByText('Current Status', { exact: true })).toHaveCount(0);
    const headerBox = await box(header);

    if (!statusHeader) {
      expect(headerBox.height, `${label} one-row header`).toBeLessThanOrEqual(ROW_HEIGHT + 2);
      await expect(posture).toHaveCount(0);
      return 'off' as const;
    }
    const triggers = await Promise.all([posture, maneuver, conditions].map(box));
    const inline = triggers.every((trigger) => trigger.y + trigger.height <= ROW_HEIGHT);
    const stripped = triggers.every((trigger) => trigger.y >= ROW_HEIGHT - 1);
    expect(inline || stripped, `${label} triggers are all inline or all in the strip`).toBe(true);
    for (const trigger of triggers) {
      expect(trigger.x).toBeGreaterThanOrEqual(0);
      expect(trigger.x + trigger.width).toBeLessThanOrEqual(width);
    }
    if (inline) {
      expect(headerBox.height, `${label} inline header`).toBeLessThanOrEqual(ROW_HEIGHT + 2);
      const [first, , last] = triggers;
      expect((last?.x ?? 0) + (last?.width ?? 0), `${label} inline before HP`).toBeLessThanOrEqual(
        hpBox.x,
      );
      expect(first?.x ?? 0).toBeGreaterThan(nameBox.x + nameBox.width);
    }
    return inline ? ('inline' as const) : ('strip' as const);
  }

  /** Tab through row 1 from the Campaign link; focus must advance left to right. */
  async function expectFocusFollowsVisualOrder(tag: string, strip: boolean) {
    await header.getByRole('link', { name: 'Campaign', exact: true }).focus();
    const stops: Array<{ x: number; y: number; name: string }> = [];
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const rect = element?.getBoundingClientRect();
        return {
          x: rect?.x ?? 0,
          y: rect?.y ?? 0,
          name: element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? '',
        };
      });
      if (stop.y > ROW_HEIGHT) break;
      stops.push(stop);
      if (/user menu/i.test(stop.name)) break;
    }
    // A strip below the row is reached after the account menu, never before it.
    if (strip) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''),
        `${tag} the strip follows the account menu`,
      ).toMatch(/^Change posture,/);
    }
    expect(stops.map((stop) => stop.name).join(' | '), `${tag} reaches the account menu`).toMatch(
      /user menu/i,
    );
    for (let index = 1; index < stops.length; index += 1) {
      expect(
        stops[index]?.x ?? 0,
        `${tag}: "${stops[index]?.name}" must be right of "${stops[index - 1]?.name}"`,
      ).toBeGreaterThan(stops[index - 1]?.x ?? 0);
    }
  }

  await page.goto('/settings');
  const statusHeader = page.getByRole('checkbox', { name: 'Show status header' });
  await expect(statusHeader).not.toBeChecked();

  for (const [id, tag] of [
    [kestrelId as string, 'ordinary'],
    [stressId, 'worst-case'],
  ] as const) {
    await page.goto(`/characters/${id}`);
    await expect(hp).toBeVisible();
    for (const width of WIDTHS) await checkRow(width, false, tag);
  }
  await captureReviewScreenshot(page, { path: 'test-results/desktop-header-off-worst-1920.png' });

  await page.goto('/settings');
  await statusHeader.check();
  const modes = new Map<string, string>();
  for (const [id, tag] of [
    [kestrelId as string, 'ordinary'],
    [stressId, 'worst-case'],
  ] as const) {
    await page.goto(`/characters/${id}`);
    await expect(posture).toBeVisible();
    for (const width of WIDTHS) {
      const mode = await checkRow(width, true, tag);
      modes.set(`${tag}-${width}`, mode);
      if (FOCUS_WIDTHS.includes(width)) {
        await expectFocusFollowsVisualOrder(`${tag} ${width}px ${mode}`, mode === 'strip');
      }
      await captureReviewScreenshot(page, {
        path: `test-results/desktop-header-on-${tag}-${width}.png`,
      });
    }
  }
  // The measured switch: ordinary content has room inline at 1920px, the
  // worst case does not at 1280px, and narrower never beats wider.
  expect(modes.get('ordinary-1920')).toBe('inline');
  expect(modes.get('worst-case-1280')).toBe('strip');
  // Narrower never beats wider: once a width is inline every wider width is too.
  for (const tag of ['ordinary', 'worst-case']) {
    const sequence = WIDTHS.map((width) => modes.get(`${tag}-${width}`));
    const firstInline = sequence.indexOf('inline');
    if (firstInline >= 0) {
      expect(sequence.slice(firstInline), `${tag} stays inline once wide enough`).not.toContain(
        'strip',
      );
    }
  }

  // A very short name leaves the left group at its 28rem minimum; sweeping the
  // boundary must never put an inline strip on a wrapped (taller) row.
  await page.goto(`/characters/${shortId}`);
  await expect(posture).toBeVisible();
  for (let width = 1280; width <= 2000; width += 48) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    const { hpBox, fpBox, accountBox } = await rowBoxes();
    for (const control of [hpBox, fpBox, accountBox]) {
      expect(control.y + control.height, `Ann ${width}px stays on row 1`).toBeLessThanOrEqual(
        ROW_HEIGHT,
      );
    }
    const triggers = await Promise.all([posture, maneuver, conditions].map(box));
    if (triggers.every((trigger) => trigger.y + trigger.height <= ROW_HEIGHT)) {
      expect((await box(header)).height, `Ann ${width}px inline header height`).toBeLessThanOrEqual(
        ROW_HEIGHT + 2,
      );
    }
  }

  // Stepping HP up and down (as a player does) must never move the strip between
  // the row and its own line: the layout depends on content, not on current HP.
  await page.goto(`/characters/${shortId}`);
  await expect(posture).toBeVisible();
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    await hp.click();
    const panel = header.getByRole('group', { name: 'HP adjustment' });
    await expect(panel).toBeVisible();
    const modeNow = async () =>
      (await box(posture)).y + (await box(posture)).height <= ROW_HEIGHT ? 'inline' : 'strip';
    const first = await modeNow();
    for (const [name, steps] of [
      ['−5 HP', 6],
      ['+5 HP', 6],
    ] as const) {
      for (let step = 0; step < steps; step += 1) {
        await panel.getByRole('button', { name }).click();
        await settle(page);
        expect(await modeNow(), `HP step at ${width}px keeps the ${first} layout`).toBe(first);
        // The layout budgets HP at its probe, so the real button is never wider.
        const widths = await page.evaluate(() => {
          const probe = document.querySelector<HTMLElement>('[data-pool-probe]');
          const button = probe?.parentElement?.querySelector<HTMLElement>('button');
          return { probe: probe?.offsetWidth ?? 0, button: button?.offsetWidth ?? 0 };
        });
        expect(widths.button, 'HP button is measured').toBeGreaterThan(0);
        expect(widths.probe, `HP probe covers the button at ${width}px`).toBeGreaterThanOrEqual(
          widths.button,
        );
      }
    }
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  }

  // Overlays: HP, and the choice panels in whichever mode applies, stay inside
  // the viewport and open at the single row's bottom edge.
  await page.goto(`/characters/${kestrelId}`);
  for (const width of [1280, 1440, 1792, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    for (const [trigger, name] of [
      [hp, 'HP adjustment'],
      [posture, 'Posture'],
      [maneuver, 'Maneuver'],
      [conditions, 'Conditions'],
    ] as const) {
      await trigger.click();
      const panel =
        name === 'HP adjustment'
          ? header.getByRole('group', { name })
          : header.getByRole('heading', { name, exact: true }).locator('xpath=..');
      await expect(panel).toBeVisible();
      const [panelBox, headerBox, triggerBox] = await Promise.all([
        box(panel),
        box(header),
        box(trigger),
      ]);
      expect(panelBox.x, `${name} ${width}px left`).toBeGreaterThanOrEqual(0);
      expect(panelBox.x + panelBox.width, `${name} ${width}px right`).toBeLessThanOrEqual(width);
      expect(panelBox.y + panelBox.height, `${name} ${width}px bottom`).toBeLessThanOrEqual(900);
      expect(panelBox.y, `${name} ${width}px below its trigger`).toBeGreaterThanOrEqual(
        triggerBox.y + triggerBox.height,
      );
      expect(panelBox.y, `${name} ${width}px near the header edge`).toBeLessThanOrEqual(
        Math.max(headerBox.y + headerBox.height, triggerBox.y + triggerBox.height + 14) + 2,
      );
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
    }
  }

  // Below 1280px the compact bar is unchanged and its sun anchor is 30/26.
  await page.setViewportSize({ width: 1279, height: 700 });
  await settle(page);
  const compactMark = await box(mark);
  expect(compactMark.x + compactMark.width / 2).toBeCloseTo(30, 0);
  expect(compactMark.y + compactMark.height / 2).toBeCloseTo(26, 0);
});
