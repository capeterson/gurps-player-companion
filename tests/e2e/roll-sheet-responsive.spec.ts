import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { selectCharacterSection } from './character-navigation';

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

test('Roll Sheet keeps long names, result and actions reachable across viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL so this test can remove its generated account and character',
  );
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `roll-sheet-responsive-${runId}@example.com`;
  const longSkill = `UnbrokenRollSkillName${'X'.repeat(96)}`;
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL ?? '',
    connectionTimeoutMillis: 5_000,
  });
  let characterId: string | undefined;

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Roll Sheet responsive QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    const headers = { Authorization: `Bearer ${token}` };
    const characterResponse = await page.request.post('/api/v1/characters', {
      data: { name: `Roll responsive ${runId}`, dx: 12 },
      headers,
    });
    expect(characterResponse.status(), await characterResponse.text()).toBe(201);
    characterId = ((await characterResponse.json()) as { id: string }).id;
    const skillResponse = await page.request.post(`/api/v1/characters/${characterId}/skills`, {
      data: { name: longSkill, attribute: 'DX', difficulty: 'E', points: 2 },
      headers,
    });
    expect(skillResponse.status(), await skillResponse.text()).toBe(201);
    await page.goto(`/characters/${characterId}`);
    await selectCharacterSection(page, 'Skills');
    const rollTrigger = page.getByRole('button', { name: `Roll ${longSkill}`, exact: true });
    await expect(rollTrigger).toBeVisible({ timeout: 20_000 });

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await expect(rollTrigger).toBeVisible();
        await rollTrigger.click();
        const sheet = page.getByRole('dialog', { name: `Roll ${longSkill}`, exact: true });
        const heading = sheet.locator('h2');
        await expect(heading).toHaveText(longSkill);
        const formScroller = sheet.locator('.card > div.overflow-y-auto').first();
        await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }));
        await expect(heading).toBeInViewport();
        const [headingBox, formScrollBox] = await Promise.all([
          heading.boundingBox(),
          formScroller.boundingBox(),
        ]);
        expect(headingBox).not.toBeNull();
        expect(formScrollBox).not.toBeNull();
        expect(headingBox?.y).toBeGreaterThanOrEqual(formScrollBox?.y ?? 0);
        expect((headingBox?.y ?? 0) + (headingBox?.height ?? 0)).toBeLessThanOrEqual(
          (formScrollBox?.y ?? 0) + (formScrollBox?.height ?? 0) + 1,
        );
        const titleGeometry = await heading.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return {
            x: box.x,
            right: box.right,
            width: box.width,
            height: box.height,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        });
        expect(titleGeometry.x).toBeGreaterThanOrEqual(0);
        expect(titleGeometry.right).toBeLessThanOrEqual(viewport.width);
        expect(titleGeometry.scrollWidth).toBeLessThanOrEqual(titleGeometry.clientWidth);
        expect(titleGeometry.height).toBeGreaterThan(24);

        const rollButton = sheet.getByRole('button', { name: /Roll vs \d+/ });
        await expect(rollButton).toBeVisible();
        const [sheetBox, rollBox] = await Promise.all([
          sheet.boundingBox(),
          rollButton.boundingBox(),
        ]);
        expect(sheetBox).not.toBeNull();
        expect(rollBox).not.toBeNull();
        expect(rollBox?.x).toBeGreaterThanOrEqual(0);
        expect((rollBox?.x ?? 0) + (rollBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
        expect(rollBox?.y).toBeGreaterThanOrEqual(0);
        expect((rollBox?.y ?? 0) + (rollBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height);

        await rollButton.click();
        const result = sheet.getByText(/^(Success|Failure) · margin/);
        await expect(result).toBeVisible();
        await result.scrollIntoViewIfNeeded();
        await expect(result).toBeInViewport();
        const resultGeometry = await result.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return {
            x: box.x,
            right: box.right,
            scrollWidth: element.scrollWidth,
            width: element.clientWidth,
          };
        });
        expect(resultGeometry.x).toBeGreaterThanOrEqual(0);
        expect(resultGeometry.right).toBeLessThanOrEqual(viewport.width);
        expect(resultGeometry.scrollWidth).toBeLessThanOrEqual(resultGeometry.width);
        await expect(rollButton).toBeVisible();

        if ([320, 568, 640, 768, 1024, 1440].includes(viewport.width)) {
          await page.screenshot({
            path: testInfo.outputPath(`roll-sheet-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
        await sheet.getByRole('button', { name: 'Close' }).last().click();
      });
    }
  } finally {
    try {
      if (characterId) await pool.query('delete from characters where id=$1', [characterId]);
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
