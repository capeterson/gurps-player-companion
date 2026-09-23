import { expect, test } from '@playwright/test';

test('user preferences control the Current Status height and visible controls at responsive widths', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const characterId = await page.evaluate(async () => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
    const response = await fetch('/api/v1/characters', {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
    if (!response.ok) throw new Error(`Character list returned ${response.status}`);
    const characters = (await response.json()) as Array<{ id: string; name: string }>;
    return characters.find((character) => character.name === 'Kestrel Vale')?.id;
  });
  expect(characterId).toBeTruthy();

  await page.goto('/settings');
  const posture = page.getByRole('checkbox', { name: 'Show posture in Current Status' });
  const maneuver = page.getByRole('checkbox', { name: 'Show maneuver in Current Status' });
  const conditions = page.getByRole('checkbox', { name: 'Show conditions in Current Status' });
  await expect(posture).not.toBeChecked();
  await expect(maneuver).not.toBeChecked();
  await expect(conditions).not.toBeChecked();

  const widths = [320, 359, 360, 390, 479, 480, 767, 768, 769, 1023, 1024, 1025, 1279, 1280, 1281];
  const offHeights = new Map<number, number>();
  await page.goto(`/characters/${characterId}`);
  const bar = page.getByRole('complementary', { name: 'Current Status' });
  const header = page.locator('header').first();
  for (const [width, name] of [
    [320, 'off-320'],
    [390, 'off-390'],
    [1280, 'off-1280'],
  ] as const) {
    await page.setViewportSize({ width, height: width < 1280 ? 568 : 900 });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      return new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await expect(bar).toBeVisible();
    if (width >= 1280) {
      await expect(header.locator('.app-header-normal').first()).toBeVisible();
      await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      const headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      if (headerBox) {
        expect(headerBox.y).toBeGreaterThanOrEqual(0);
        expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(900);
      }
    }
    await page.screenshot({ path: `test-results/status-bar-${name}.png`, fullPage: false });
  }
  for (const width of widths) {
    const height = width < 1280 ? 568 : 900;
    await page.setViewportSize({ width, height });
    await expect(bar.getByRole('button', { name: /^Adjust HP,/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Adjust FP,/ })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Change posture,/ })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: /^Change maneuver,/ })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: /^Change conditions,/ })).toHaveCount(0);
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();
    offHeights.set(width, (await header.boundingBox())?.height ?? 0);
    if (width < 1280) {
      const navigation = header.getByRole('navigation', { name: 'Character and app navigation' });
      await expect(navigation).toBeVisible();
      await expect(
        header.getByRole('button', {
          name: /All changes saved|Syncing changes|Some changes failed to sync|Offline/,
        }),
      ).toBeVisible();
      const mobileControls = [
        navigation.getByLabel('Open navigation for Kestrel Vale'),
        bar.getByRole('button', { name: /^Adjust HP,/ }),
        bar.getByRole('button', { name: /^Adjust FP,/ }),
        header.getByRole('button', {
          name: /All changes saved|Syncing changes|Some changes failed to sync|Offline/,
        }),
        bar.getByLabel(/Notifications/),
      ];
      for (const control of mobileControls) {
        const controlBox = await control.boundingBox();
        expect(controlBox).not.toBeNull();
        if (controlBox) {
          expect(controlBox.width, `${width}px control width`).toBeGreaterThanOrEqual(44);
          expect(controlBox.height, `${width}px control height`).toBeGreaterThanOrEqual(44);
          expect(controlBox.x).toBeGreaterThanOrEqual(0);
          expect(controlBox.x + controlBox.width).toBeLessThanOrEqual(width);
        }
      }
      const menuTrigger = navigation.getByLabel('Open navigation for Kestrel Vale');
      const hpBox = await bar.getByRole('button', { name: /^Adjust HP,/ }).boundingBox();
      const fpBox = await bar.getByRole('button', { name: /^Adjust FP,/ }).boundingBox();
      const triggerBox = await menuTrigger.boundingBox();
      expect(hpBox).not.toBeNull();
      expect(fpBox).not.toBeNull();
      expect(triggerBox).not.toBeNull();
      if (triggerBox && hpBox && fpBox) {
        expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(hpBox.x);
        expect(hpBox.x + hpBox.width).toBeLessThanOrEqual(fpBox.x);
      }
      expect((await header.boundingBox())?.height).toBeLessThanOrEqual(64);
      await navigation.getByLabel('Open navigation for Kestrel Vale').click();
      const menu = navigation.getByRole('list');
      await expect(menu.getByText('Kestrel Vale', { exact: true })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Campaigns' })).toBeVisible();
      await expect(menu.getByRole('link', { name: 'Settings' })).toBeVisible();
      const menuBox = await menu.boundingBox();
      expect(menuBox).not.toBeNull();
      if (menuBox) {
        expect(menuBox.x).toBeGreaterThanOrEqual(0);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
        expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(height);
      }
      const menuTextBox = await menu.getByText('Kestrel Vale', { exact: true }).boundingBox();
      expect(menuTextBox).not.toBeNull();
      if (menuTextBox && menuBox) {
        expect(menuTextBox.x).toBeGreaterThanOrEqual(menuBox.x);
        expect(menuTextBox.x + menuTextBox.width).toBeLessThanOrEqual(menuBox.x + menuBox.width);
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      if (width === 320) {
        await page.evaluate(async () => {
          await import('/db/dexie.ts');
        });
        await page.context().setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        const snapshots = await page.evaluate(async (id) => {
          const { getLocalDb } = await import('/db/dexie.ts');
          const db = getLocalDb();
          const character = await db.characters.get(id);
          const combat = await db.characterCombat.get(id);
          if (!character || !combat) throw new Error('Expected local character and combat rows');
          await db.characters.update(id, { st: 1000, ht: 1000, hpMod: 0, fpMod: 0 });
          await db.characterCombat.update(id, { currentHp: -1000, currentFp: -1000 });
          return { character, combat };
        }, characterId);
        try {
          await expect(
            bar.getByRole('button', { name: 'Adjust HP, current -1000 of 1000, Death checks' }),
          ).toBeVisible();
          await expect(
            bar.getByRole('button', { name: 'Adjust FP, current -1000 of 1000, Exhausted' }),
          ).toBeVisible();
          await page.screenshot({
            path: 'test-results/status-bar-extreme-320.png',
            fullPage: false,
          });
          const extremeMetrics = await page.evaluate(() => {
            const status = document.querySelector<HTMLElement>('[aria-label="Current Status"]');
            if (!status) return null;
            const statusBox = status.getBoundingClientRect();
            return [
              ...status.querySelectorAll<HTMLButtonElement>('button[aria-label^="Adjust "]'),
            ].map((button) => {
              const value = [...button.querySelectorAll<HTMLElement>('.num')].find(
                (element) => getComputedStyle(element).display !== 'none',
              );
              const warning = [...button.querySelectorAll<HTMLElement>('.text-warning')].find(
                (element) => getComputedStyle(element).display !== 'none',
              );
              const box = button.getBoundingClientRect();
              let warningTextWidth = 0;
              if (warning) {
                const range = document.createRange();
                range.selectNodeContents(warning);
                warningTextWidth = range.getBoundingClientRect().width;
              }
              return {
                clientWidth: button.clientWidth,
                scrollWidth: button.scrollWidth,
                valueClientWidth: value?.clientWidth ?? 0,
                valueScrollWidth: value?.scrollWidth ?? 0,
                warningClientWidth: warning?.clientWidth ?? 0,
                warningScrollWidth: warning?.scrollWidth ?? 0,
                warningTextWidth,
                left: box.left,
                right: box.right,
                statusLeft: statusBox.left,
                statusRight: statusBox.right,
              };
            });
          });
          expect(extremeMetrics).not.toBeNull();
          for (const metric of extremeMetrics ?? []) {
            expect(metric.scrollWidth).toBeLessThanOrEqual(metric.clientWidth + 1);
            expect(metric.valueScrollWidth).toBeLessThanOrEqual(metric.valueClientWidth + 1);
            expect(metric.warningScrollWidth).toBeLessThanOrEqual(metric.warningClientWidth + 1);
            expect(metric.warningTextWidth).toBeLessThanOrEqual(metric.warningClientWidth + 1);
            expect(metric.left).toBeGreaterThanOrEqual(metric.statusLeft);
            expect(metric.right).toBeLessThanOrEqual(metric.statusRight);
          }
        } finally {
          await page.evaluate(
            async ({ snapshots }) => {
              const { getLocalDb } = await import('/db/dexie.ts');
              const db = getLocalDb();
              await db.characters.put(snapshots.character);
              await db.characterCombat.put(snapshots.combat);
              window.dispatchEvent(new Event('online'));
            },
            { id: characterId, snapshots },
          );
          await page.context().setOffline(false);
          await page.reload();
          await expect(bar).toBeVisible();
        }
      }
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }

  await page.goto('/settings');
  await posture.check();
  await maneuver.check();
  await conditions.check();
  await page.reload();
  await expect(posture).toBeChecked();
  await expect(maneuver).toBeChecked();
  await expect(conditions).toBeChecked();
  await page.goto(`/characters/${characterId}`);
  for (const [width, name] of [
    [320, 'on-320'],
    [390, 'on-390'],
    [1280, 'on-1280'],
  ] as const) {
    await page.setViewportSize({ width, height: width < 1280 ? 568 : 900 });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      return new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    await expect(bar).toBeVisible();
    if (width >= 1280) {
      await expect(header.locator('.app-header-normal').first()).toBeVisible();
      await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      const headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      if (headerBox) {
        expect(headerBox.y).toBeGreaterThanOrEqual(0);
        expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(900);
      }
    }
    await page.screenshot({ path: `test-results/status-bar-${name}.png`, fullPage: false });
  }
  for (const width of widths) {
    const height = width < 1280 ? 568 : 900;
    await page.setViewportSize({ width, height });
    if (width >= 1280) {
      await expect(header.locator('.app-header-normal').first()).toBeVisible();
      await expect(header.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
      const headerBox = await header.boundingBox();
      expect(headerBox).not.toBeNull();
      if (headerBox) expect(headerBox.y).toBeGreaterThanOrEqual(0);
    }
    for (const [name, title] of [
      ['Change posture,', 'Posture'],
      ['Change maneuver,', 'Maneuver'],
      ['Change conditions,', 'Conditions'],
    ] as const) {
      const control = bar.getByRole('button', { name: new RegExp(`^${name}`) });
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        if (width < 1280) {
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }
      await control.click();
      const panel = bar.getByRole('heading', { name: title, exact: true }).locator('xpath=..');
      await expect(panel).toBeVisible();
      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      if (panelBox) {
        expect(panelBox.x).toBeGreaterThanOrEqual(0);
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
        expect(panelBox.y).toBeGreaterThanOrEqual(0);
        expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(height);
      }
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
    }
    const box = await header.boundingBox();
    expect(box?.height).toBeGreaterThan(offHeights.get(width) ?? 0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
  }

  await page.goto('/settings');
  await posture.uncheck();
  await maneuver.uncheck();
  await expect(conditions).toBeChecked();
  await page.goto(`/characters/${characterId}`);
  await expect(bar.getByRole('button', { name: /^Change posture,/ })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: /^Change maneuver,/ })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: /^Change conditions,/ })).toBeVisible();
});
