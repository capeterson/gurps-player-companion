import { type Page, expect, test } from '@playwright/test';
import { Pool } from 'pg';

const LONG_NAME = 'UnbrokenEncounterName'.repeat(5);
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

async function register(page: Page, email: string, existingAccount = false) {
  if (existingAccount) {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/^password$/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    return;
  }
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/display name/i).fill('Encounter list responsive QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function api(page: Page, path: string, method: 'POST' | 'DELETE', data?: unknown) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}

test('encounter initiative and effect rows contain long names at supported widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const email =
    process.env.ENCOUNTER_E2E_EMAIL ?? `encounter-list-responsive-${Date.now()}@example.com`;
  const pool = process.env.ADMIN_E2E_DATABASE_URL
    ? new Pool({
        connectionString: process.env.ADMIN_E2E_DATABASE_URL,
        connectionTimeoutMillis: 5_000,
      })
    : null;
  await page.setViewportSize({ width: 320, height: 568 });
  let campaignId: string | undefined;
  try {
    await register(page, email, Boolean(process.env.ENCOUNTER_E2E_EMAIL));
    const campaign = (await api(page, '/campaigns', 'POST', {
      name: 'Responsive encounter list',
      experimentalTurnTracker: true,
    })) as { id: string };
    campaignId = campaign.id;
    const encounter = (await api(page, `/campaigns/${campaign.id}/encounters`, 'POST', {
      name: 'Responsive encounter',
    })) as { id: string };
    const combatant = (await api(
      page,
      `/campaigns/${campaign.id}/encounters/${encounter.id}/combatants`,
      'POST',
      {
        kind: 'npc',
        name: LONG_NAME,
        basicSpeed: 5,
        dx: 10,
        maxHp: 12,
      },
    )) as { id: string };
    await api(page, `/campaigns/${campaign.id}/encounters/${encounter.id}/effects`, 'POST', {
      targetCombatantId: combatant.id,
      name: LONG_NAME,
      duration: { unit: 'rounds', amount: 3 },
    });
    await page.goto(`/campaigns/${campaign.id}/encounters/${encounter.id}`);

    const initiative = page.getByRole('heading', { name: 'Initiative' });
    const combatantCard = page.getByRole('article').filter({ hasText: LONG_NAME }).first();
    const effectCard = page.getByRole('article').filter({ hasText: LONG_NAME }).last();
    const combatantName = combatantCard.locator('strong');
    const effectName = effectCard.locator('strong');
    await expect(initiative).toBeVisible();
    await expect(combatantName).toHaveText(LONG_NAME);
    await expect(effectName).toHaveText(LONG_NAME);
    await expect(effectCard.getByText(/3 rds · started round 1/)).toBeVisible();
    for (const button of ['HP -1', 'Edit', 'Remove', 'Move up', 'Move down', 'Wait']) {
      await expect(combatantCard.getByRole('button', { name: button, exact: true })).toBeVisible();
    }
    await expect(effectCard.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(effectCard.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await combatantCard.scrollIntoViewIfNeeded();
        const geometry = await Promise.all(
          [combatantCard, effectCard, combatantName, effectName].map((locator) =>
            locator.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return {
                x: box.x,
                right: box.right,
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
              };
            }),
          ),
        );
        const controls = await Promise.all(
          [combatantCard, effectCard].map((card) =>
            card.getByRole('button').evaluateAll((elements) =>
              elements.map((element) => {
                const box = element.getBoundingClientRect();
                return { x: box.x, right: box.right };
              }),
            ),
          ),
        );
        for (const box of geometry) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(viewport.width);
        }
        for (const nameBox of geometry.slice(2)) {
          expect(nameBox.scrollWidth).toBeLessThanOrEqual(nameBox.clientWidth + 1);
        }
        for (const buttonBox of controls.flat()) {
          expect(buttonBox.x).toBeGreaterThanOrEqual(0);
          expect(buttonBox.right).toBeLessThanOrEqual(viewport.width);
        }
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(viewport.width);
        await expect(
          combatantCard.getByRole('button', { name: 'Edit', exact: true }),
        ).toBeVisible();
        await expect(effectCard.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
        if ([320, 568, 640, 768, 1024, 1440].includes(viewport.width)) {
          await page.screenshot({
            path: testInfo.outputPath(`encounter-list-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
            fullPage: true,
          });
        }
      });
    }
  } finally {
    try {
      if (campaignId) await api(page, `/campaigns/${campaignId}`, 'DELETE');
      if (pool) {
        await pool.query(
          'delete from campaigns where name=$1 and owner_id=(select id from users where email=$2)',
          ['Responsive encounter list', email],
        );
        if (!process.env.ENCOUNTER_E2E_EMAIL || process.env.ENCOUNTER_E2E_DELETE_ACCOUNT === 'true')
          await pool.query('delete from users where email=$1', [email]);
      }
    } finally {
      await pool?.end();
    }
  }
});
