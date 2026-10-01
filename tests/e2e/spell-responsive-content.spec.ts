import { type Locator, expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { expectCharacterNavigationReady, selectCharacterSection } from './character-navigation';
import { attachReviewScreenshot } from './review-artifacts';

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
const PASSWORD = 'CorrectHorseBatteryStaple1';
const SPELL_NAME = 'UnbrokenArcaneInvocationName'.repeat(4);
const LONG_DESCRIPTION = 'UnbrokenSpellDescriptionSegment'.repeat(18);

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Visible spell content has no bounding box');
  return box;
}

test('unbroken spell names and descriptions remain readable in the sheet and cast dialog', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL to this worktree test database so generated fixtures can be removed',
  );
  test.setTimeout(120_000);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `spell-responsive-content-${runId}@example.com`;
  const campaignName = `Spell responsive content ${runId}`;
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL ?? '',
    connectionTimeoutMillis: 5_000,
  });
  let campaignId: string | undefined;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Spell Responsive QA');
    await page.getByLabel(/^password\b/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
    );
    const campaignResponse = await page.request.post('/api/v1/campaigns', {
      data: { name: campaignName },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(campaignResponse.ok(), await campaignResponse.text()).toBeTruthy();
    const campaign = (await campaignResponse.json()) as { id: string };
    campaignId = campaign.id;

    const libraryResponse = await page.request.post(
      `/api/v1/campaigns/${campaign.id}/library/spells`,
      {
        data: {
          key: 'unbroken-spell-responsive-content',
          name: SPELL_NAME,
          college: 'UnbrokenSpellCollegeName'.repeat(3),
          difficulty: 'H',
          baseEnergyCost: 2,
          maintenanceCost: 1,
          castingTime: '40 seconds',
          duration: 'UnbrokenSpellDurationUnbrokenSpell'.slice(0, 40),
          description: `${LONG_DESCRIPTION}\n\n${LONG_DESCRIPTION}`,
          status: 'complete',
          role: 'definition',
        },
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(libraryResponse.ok(), await libraryResponse.text()).toBeTruthy();

    await page.goto(`/campaigns/${campaign.id}`);
    await expect(page.getByRole('heading', { name: campaignName, exact: true })).toBeVisible();
    await page.goto(`/campaigns/${campaign.id}/library?section=spells`);
    await expect(page.getByText(SPELL_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.goto('/characters');
    await page.getByLabel(/new character name/i).fill('Long Spell Layout Caster');
    await page.getByRole('button', { name: /^create$/i }).click();
    await expectCharacterNavigationReady(page);
    const characterUrl = page.url();

    await selectCharacterSection(page, 'Overview');
    await page.getByLabel('campaign', { exact: true }).selectOption({ label: campaignName });
    await selectCharacterSection(page, 'Traits');
    await page.getByRole('button', { name: '+ Add trait' }).click();
    await page.getByLabel('Trait name').fill('Magery');
    await page.getByRole('button', { name: /^add$/i }).click();

    await selectCharacterSection(page, 'Magic');
    await page.getByRole('button', { name: '+ Add spell' }).click();
    const addForm = page.getByLabel(/^spell$/i).locator('xpath=ancestor::form');
    await page.getByLabel(/^spell$/i).fill(SPELL_NAME);
    await expect(page.getByRole('option', { name: new RegExp(SPELL_NAME) })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('option', { name: new RegExp(SPELL_NAME) }).click();
    await addForm.getByRole('button', { name: /^add$/i }).click();
    const spellRow = page.getByRole('rowgroup', { name: SPELL_NAME, exact: true });
    await expect(spellRow).toBeVisible();
    const readButton = spellRow.getByRole('button', { name: `Read ${SPELL_NAME}`, exact: true });
    const castButton = spellRow.getByRole('button', { name: `Cast ${SPELL_NAME}`, exact: true });
    await expect(readButton).toBeVisible();
    await expect(castButton).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        const nameBounds = await bounds(readButton);
        expect(nameBounds.x).toBeGreaterThanOrEqual(0);
        expect(nameBounds.x + nameBounds.width).toBeLessThanOrEqual(viewport.width + 1);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(viewport.width);

        await readButton.click();
        const reference = page.getByRole('dialog', { name: `Spell reference: ${SPELL_NAME}` });
        const referenceBox = reference.locator('.modal-box');
        await expect(reference).toBeVisible();
        await expect(
          reference.getByRole('heading', { name: SPELL_NAME, exact: true }),
        ).toBeVisible();
        const description = referenceBox
          .locator('.markdown-body')
          .getByText(LONG_DESCRIPTION, {
            exact: true,
          })
          .first();
        await description.scrollIntoViewIfNeeded();
        await expect(description).toBeVisible();
        const referenceHeader = referenceBox.locator('header');
        let headerBounds = await bounds(referenceHeader);
        let descriptionBounds = await bounds(description);
        if (descriptionBounds.y < headerBounds.y + headerBounds.height) {
          await referenceBox.evaluate(
            (element, delta) => {
              element.scrollTop -= delta;
            },
            headerBounds.y + headerBounds.height - descriptionBounds.y + 2,
          );
          headerBounds = await bounds(referenceHeader);
          descriptionBounds = await bounds(description);
        }
        const referenceBounds = await bounds(referenceBox);
        expect(descriptionBounds.y).toBeGreaterThanOrEqual(
          headerBounds.y + headerBounds.height - 1,
        );
        expect(descriptionBounds.y).toBeLessThan(referenceBounds.y + referenceBounds.height);
        const finalDescription = referenceBox.locator('.markdown-body p').last();
        await referenceBox.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const finalLine = await finalDescription.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rects = range.getClientRects();
          const last = rects.item(rects.length - 1);
          return last ? { y: last.y, height: last.height } : null;
        });
        expect(finalLine).not.toBeNull();
        if (!finalLine) throw new Error('The final spell description line is not rendered');
        headerBounds = await bounds(referenceHeader);
        expect(Math.abs(headerBounds.y - referenceBounds.y)).toBeLessThanOrEqual(1);
        expect(finalLine.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height - 1);
        expect(finalLine.y + finalLine.height).toBeLessThanOrEqual(
          referenceBounds.y + referenceBounds.height + 1,
        );
        expect(referenceBounds.x).toBeGreaterThanOrEqual(0);
        expect(referenceBounds.x + referenceBounds.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(referenceBounds.y).toBeGreaterThanOrEqual(0);
        expect(referenceBounds.y + referenceBounds.height).toBeLessThanOrEqual(viewport.height + 1);
        const markdownMetrics = await reference.locator('.markdown-body').evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(markdownMetrics.scrollWidth).toBeLessThanOrEqual(markdownMetrics.clientWidth + 1);
        const referenceClose = reference.getByRole('button', { name: 'Close spell reference' });
        const referenceCloseBounds = await bounds(referenceClose);
        expect(referenceCloseBounds.width).toBeGreaterThanOrEqual(44);
        expect(referenceCloseBounds.height).toBeGreaterThanOrEqual(44);
        expect(referenceCloseBounds.x).toBeGreaterThanOrEqual(0);
        expect(referenceCloseBounds.x + referenceCloseBounds.width).toBeLessThanOrEqual(
          viewport.width + 1,
        );
        expect(referenceCloseBounds.y).toBeGreaterThanOrEqual(0);
        expect(referenceCloseBounds.y + referenceCloseBounds.height).toBeLessThanOrEqual(
          viewport.height + 1,
        );
        if ([320, 568, 640, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `spell-reference-${viewport.width}x${viewport.height}`,
            { animations: 'disabled' },
          );
        }
        await referenceClose.click();

        await castButton.click();
        const castDialog = page.getByRole('dialog', { name: `Cast ${SPELL_NAME}` });
        const castBox = castDialog.locator('.modal-box');
        await expect(castDialog).toBeVisible();
        await expect(
          castDialog.getByRole('heading', { name: SPELL_NAME, exact: true }),
        ).toBeVisible();
        await expect(castDialog.getByLabel('Energy to spend')).toBeVisible();
        const castBounds = await bounds(castBox);
        expect(castBounds.x).toBeGreaterThanOrEqual(0);
        expect(castBounds.x + castBounds.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(castBounds.y).toBeGreaterThanOrEqual(0);
        expect(castBounds.y + castBounds.height).toBeLessThanOrEqual(viewport.height + 1);
        const payButton = castDialog.getByRole('button', { name: 'Pay 2 energy', exact: true });
        await payButton.scrollIntoViewIfNeeded();
        await expect(payButton).toBeVisible();
        const payBounds = await bounds(payButton);
        expect(payBounds.x).toBeGreaterThanOrEqual(0);
        expect(payBounds.x + payBounds.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(payBounds.y).toBeGreaterThanOrEqual(0);
        expect(payBounds.y + payBounds.height).toBeLessThanOrEqual(viewport.height + 1);
        if ([320, 568, 640, 1440].includes(viewport.width)) {
          await attachReviewScreenshot(
            page,
            testInfo,
            `spell-cast-${viewport.width}x${viewport.height}`,
            { animations: 'disabled' },
          );
        }
        await castDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(castDialog).not.toBeVisible();
      });
    }

    await expect(page).toHaveURL(characterUrl);
  } finally {
    try {
      if (campaignId) {
        const token = await page
          .evaluate(
            () =>
              JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
          )
          .catch(() => undefined);
        if (token) {
          await page.request.delete(`/api/v1/campaigns/${campaignId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      }
      await pool.query(
        'delete from campaigns where name=$1 and owner_id=(select id from users where email=$2)',
        [campaignName, email],
      );
      await pool.query('delete from users where email=$1', [email]);
    } finally {
      await pool.end();
    }
  }
});
