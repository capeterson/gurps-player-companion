import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import sharp from 'sharp';
import { captureReviewScreenshot } from './review-artifacts';

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 568, height: 320 },
  { width: 568, height: 499 },
  { width: 568, height: 500 },
  { width: 568, height: 501 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

const runId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function removeFixture(pool: Pool, email: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'delete from characters where owner_id = (select id from users where email = $1)',
      [email],
    );
    await client.query(
      'delete from campaigns where owner_id = (select id from users where email = $1)',
      [email],
    );
    await client.query('delete from users where email = $1', [email]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release(error as Error);
    throw error;
  }
  client.release();
}

test('portrait and campaign cover editors keep controls reachable across viewports', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL so this test can remove its generated account',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const id = runId();
  const email = `media-dialog-responsive-${id}@example.com`;
  const longName = `Asterion${'TheForgottenNorthernCoastExpedition'.repeat(2)} ${id}`;
  const bytes = await sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 61, g: 118, b: 170 } },
  })
    .png()
    .toBuffer();

  try {
    // Keep this geometry run local-only: selection and preview are real, while
    // the upload endpoint is blocked before it can create a server media row.
    await page.route('**/api/v1/media/uploads/bytes**', (route) => route.abort());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/display name/i).fill('Media Dialog Responsive QA');
    await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
    await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
    await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

    await page.goto('/characters');
    await page.getByLabel(/new character name/i).fill(longName);
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page).toHaveURL(/\/characters\/[a-f0-9-]+$/, { timeout: 15_000 });
    const characterUrl = page.url();
    const characterId = characterUrl.split('/').at(-1);
    if (!characterId) throw new Error('character route did not include an id');

    const portraitTrigger = page.getByRole('button', { name: `Edit portrait for ${longName}` });
    await portraitTrigger.click();
    const portraitDialog = page.getByRole('dialog', { name: 'Character portrait' });
    const portraitInput = portraitDialog.getByLabel('Upload portrait');
    await expect(portraitInput).toBeVisible({ timeout: 15_000 });
    await portraitInput.setInputFiles({
      name: `${'PortraitSourceWithLongUnbrokenFilename'.repeat(3)}.png`,
      mimeType: 'image/png',
      buffer: bytes,
    });
    await expect(portraitDialog.getByText('Image queued for upload')).toBeVisible({
      timeout: 10_000,
    });
    await expect(portraitDialog.getByRole('img', { name: `${longName} portrait` })).toHaveAttribute(
      'src',
      /^blob:/,
    );

    for (const viewport of viewports) {
      await test.step(`portrait ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await portraitDialog.locator('.modal-box').evaluate((element) => {
          element.scrollTop = 0;
        });
        await expect(
          portraitDialog.getByRole('heading', { name: 'Character portrait' }),
        ).toBeVisible();
        const box = await portraitDialog.locator('.modal-box').boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        }
        await portraitInput.scrollIntoViewIfNeeded();
        await expect(portraitInput).toBeVisible();
        await portraitDialog
          .getByRole('button', { name: 'Done', exact: true })
          .scrollIntoViewIfNeeded();
        await expect(
          portraitDialog.getByRole('button', { name: 'Done', exact: true }),
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        if ([320, 568].includes(viewport.width)) {
          await captureReviewScreenshot(portraitDialog, {
            path: testInfo.outputPath(`portrait-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
      });
    }
    await portraitDialog.getByRole('button', { name: 'Close portrait editor' }).click();

    await page.goto('/campaigns');
    await page.getByRole('button', { name: /new campaign/i }).click();
    await page.getByLabel('Campaign name').fill(longName);
    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('link', { name: longName })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: longName }).click();
    await expect(page.getByRole('heading', { name: longName })).toBeVisible({ timeout: 15_000 });
    const campaignUrl = page.url();
    const campaignId = campaignUrl.split('/').at(-1);
    if (!campaignId) throw new Error('campaign route did not include an id');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: longName });
    const coverInput = settings.getByLabel('Upload campaign cover');
    await expect(coverInput).toBeVisible({ timeout: 15_000 });
    await coverInput.setInputFiles({
      name: `${'CampaignCoverImageWithVeryLongSourceFilename'.repeat(3)}.png`,
      mimeType: 'image/png',
      buffer: bytes,
    });
    const cover = settings.getByRole('img', { name: `${longName} cover` });
    await expect(cover).toHaveAttribute('src', /^blob:/);

    for (const viewport of viewports) {
      await test.step(`cover ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
        );
        const box = await settings.locator('.modal-box').boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        }
        if (viewport.height <= 500) {
          const headerName = settings.locator('.campaign-settings-dialog__header-name');
          const contextName = settings.locator('.campaign-settings-dialog__context');
          const close = settings.getByRole('button', { name: 'Close', exact: true });
          const body = settings.locator('.campaign-settings-dialog__body');
          await body.evaluate((element) => {
            element.scrollTop = 0;
          });
          await expect(settings.getByText('Campaign settings', { exact: true })).toBeVisible();
          await expect(headerName).toBeHidden();
          await expect(contextName).toHaveText(longName);
          await expect(contextName).toBeVisible();
          await expect(
            settings.getByRole('navigation', { name: 'Settings sections' }),
          ).toBeVisible();

          const closeBox = await close.boundingBox();
          expect(closeBox).not.toBeNull();
          expect(closeBox?.width).toBeGreaterThanOrEqual(44);
          expect(closeBox?.height).toBeGreaterThanOrEqual(44);

          const workingHeight = await body.evaluate((element) => element.clientHeight);
          expect(workingHeight).toBeGreaterThanOrEqual(120);
          const [bodyBox, contextBox] = await Promise.all([
            body.boundingBox(),
            contextName.boundingBox(),
          ]);
          expect(contextBox).not.toBeNull();
          if (bodyBox && contextBox) {
            expect(contextBox.y).toBeGreaterThanOrEqual(bodyBox.y);
            expect(contextBox.y + contextBox.height).toBeLessThanOrEqual(
              bodyBox.y + bodyBox.height,
            );
          }
          await coverInput.scrollIntoViewIfNeeded();
          await expect(coverInput).toBeVisible();
          const [scrolledBodyBox, inputBox] = await Promise.all([
            body.boundingBox(),
            coverInput.boundingBox(),
          ]);
          expect(scrolledBodyBox).not.toBeNull();
          expect(inputBox).not.toBeNull();
          if (scrolledBodyBox && inputBox) {
            expect(inputBox.x).toBeGreaterThanOrEqual(scrolledBodyBox.x);
            expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(
              scrolledBodyBox.x + scrolledBodyBox.width,
            );
            expect(inputBox.y).toBeGreaterThanOrEqual(scrolledBodyBox.y);
            expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(
              scrolledBodyBox.y + scrolledBodyBox.height,
            );
          }
          if ([320, 499].includes(viewport.height)) {
            await captureReviewScreenshot(settings, {
              path: testInfo.outputPath(`cover-568x${viewport.height}-input.png`),
              animations: 'disabled',
            });
          }
        } else {
          await expect(settings.locator('.campaign-settings-dialog__header-name')).toBeVisible();
          await expect(settings.locator('.campaign-settings-dialog__context')).toBeHidden();
          await coverInput.scrollIntoViewIfNeeded();
          await expect(coverInput).toBeVisible();
        }
        const save = settings.getByRole('button', { name: 'Save', exact: true });
        const cancel = settings.getByRole('button', { name: 'Cancel', exact: true });
        await expect(save).toBeVisible();
        await expect(cancel).toBeVisible();
        for (const action of [save, cancel]) {
          const actionBox = await action.boundingBox();
          expect(actionBox).not.toBeNull();
          expect(actionBox?.y).toBeGreaterThanOrEqual(0);
          expect((actionBox?.y ?? 0) + (actionBox?.height ?? 0)).toBeLessThanOrEqual(
            viewport.height,
          );
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );
        if ([320, 568].includes(viewport.width)) {
          await captureReviewScreenshot(settings, {
            path: testInfo.outputPath(`cover-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
      });
    }
  } finally {
    try {
      // Parents use RESTRICT ownership references, so remove only this exact
      // generated user's character and campaign rows before deleting the user.
      await removeFixture(pool, email);
    } finally {
      await pool.end();
    }
  }
});
