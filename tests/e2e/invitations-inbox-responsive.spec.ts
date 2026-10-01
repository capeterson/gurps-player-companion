import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 568, height: 320 },
  { width: 639, height: 800 },
  { width: 640, height: 800 },
  { width: 641, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
];

test('campaign invitations and member rows wrap long names and emails responsively', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.ADMIN_E2E_DATABASE_URL,
    'Set ADMIN_E2E_DATABASE_URL so this test can remove its generated accounts and campaign',
  );
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString: process.env.ADMIN_E2E_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
  });
  const campaignName = 'I'.repeat(120);
  const playerName = 'P'.repeat(80);
  const gmName = 'G'.repeat(80);
  const tag = suffix();
  const playerEmail = `invitee-${'p'.repeat(190)}-${tag}@example.com`;
  const gmEmail = `inviter-${'g'.repeat(190)}-${tag}@example.com`;
  const password = 'CorrectHorseBatteryStaple1';
  let campaignId: string | undefined;

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/register');
    await page.getByLabel(/email/i).fill(playerEmail);
    await page.getByLabel(/display name/i).fill(playerName);
    await page.getByLabel(/^password\b/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });

    const gmRegistration = await page.request.post('/api/v1/auth/register', {
      data: { email: gmEmail, password, displayName: gmName },
    });
    expect(gmRegistration.status(), await gmRegistration.text()).toBe(201);
    const gmToken = ((await gmRegistration.json()) as { accessToken: string }).accessToken;
    const campaignResponse = await page.request.post('/api/v1/campaigns', {
      headers: { authorization: `Bearer ${gmToken}` },
      data: { name: campaignName },
    });
    expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
    campaignId = ((await campaignResponse.json()) as { id: string }).id;
    const invitationResponse = await page.request.post(
      `/api/v1/campaigns/${campaignId}/invitations`,
      {
        headers: { authorization: `Bearer ${gmToken}` },
        data: { handle: playerEmail, role: 'member' },
      },
    );
    expect(invitationResponse.status(), await invitationResponse.text()).toBe(201);

    const ownerPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await ownerPage.goto('/login');
    await ownerPage.getByLabel(/email/i).fill(gmEmail);
    await ownerPage.getByLabel(/^password\b/i).fill(password);
    await ownerPage.getByRole('button', { name: /sign in/i }).click();
    await expect(ownerPage.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
      timeout: 15_000,
    });
    await ownerPage.goto('/campaigns');
    await ownerPage.getByRole('button', { name: `Settings for ${campaignName}` }).click();
    const settings = ownerPage.getByRole('dialog', { name: campaignName });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'Members', exact: true }).click();
    await expect(settings.getByText(playerEmail, { exact: true })).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await test.step(`pending invitation and acceptance card at ${viewport.width}×${viewport.height}`, async () => {
        await page.setViewportSize(viewport);
        await page.goto('/campaigns');
        const inbox = page.locator('section').filter({
          has: page.getByRole('heading', { name: 'You have 1 pending invitation' }),
        });
        const workspaceLabel = page.getByText(`Workspace · ${playerName}`, { exact: true });
        await expect(inbox).toBeVisible();
        await expect(workspaceLabel).toBeVisible();
        await expect(inbox.getByText(campaignName, { exact: true })).toBeVisible();
        await expect(inbox.getByText(`from ${gmName}`, { exact: true })).toBeVisible();
        const accept = inbox.getByRole('button', { name: 'Accept' });
        const reject = inbox.getByRole('button', { name: 'Reject' });
        await expect(accept).toBeVisible();
        await expect(reject).toBeVisible();
        const boxes = await Promise.all(
          [
            inbox,
            workspaceLabel,
            inbox.getByText(campaignName, { exact: true }),
            inbox.getByText(`from ${gmName}`, { exact: true }),
            accept,
            reject,
          ].map((item) => item.boundingBox()),
        );
        for (const [index, box] of boxes.entries()) {
          expect(box, `visible inbox item ${index}`).not.toBeNull();
          if (!box) continue;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        }
        for (const action of [accept, reject]) {
          await action.scrollIntoViewIfNeeded();
          const actionBox = await action.boundingBox();
          const visible = await page.evaluate(() => {
            const visual = window.visualViewport;
            const left = visual?.offsetLeft ?? 0;
            const top = visual?.offsetTop ?? 0;
            const width = visual?.width ?? window.innerWidth;
            const height = visual?.height ?? window.innerHeight;
            return { left, top, right: left + width, bottom: top + height };
          });
          expect(actionBox).not.toBeNull();
          if (actionBox) {
            expect(actionBox.x).toBeGreaterThanOrEqual(visible.left - 1);
            expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(visible.right + 1);
            expect(actionBox.y).toBeGreaterThanOrEqual(visible.top - 1);
            expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(visible.bottom + 1);
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.width,
        );

        await ownerPage.setViewportSize(viewport);
        const invitationEmail = settings.getByText(playerEmail, { exact: true });
        await expect(settings.getByText(playerName, { exact: true })).toBeVisible();
        const cancelInvitation = settings.getByRole('button', {
          name: `Cancel invitation for ${playerName}`,
        });
        await cancelInvitation.scrollIntoViewIfNeeded();
        await expect(cancelInvitation).toBeVisible();
        const cancelBox = await cancelInvitation.boundingBox();
        expect(cancelBox).not.toBeNull();
        if (cancelBox) {
          expect(cancelBox.x).toBeGreaterThanOrEqual(0);
          expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(cancelBox.y).toBeGreaterThanOrEqual(0);
          expect(cancelBox.y + cancelBox.height).toBeLessThanOrEqual(viewport.height + 1);
        }
        if ([320, 568].includes(viewport.width)) {
          await settings.screenshot({
            path: testInfo.outputPath(`campaign-members-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
        const inviteTextMetrics = await invitationEmail.locator('xpath=..').evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          right: element.getBoundingClientRect().right,
        }));
        expect(inviteTextMetrics.scrollWidth).toBeLessThanOrEqual(
          inviteTextMetrics.clientWidth + 1,
        );
        expect(inviteTextMetrics.right).toBeLessThanOrEqual(viewport.width + 1);

        if ([320, 568].includes(viewport.width)) {
          await page.screenshot({
            path: testInfo.outputPath(`invitations-inbox-${viewport.width}x${viewport.height}.png`),
            animations: 'disabled',
          });
        }
      });
    }

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/campaigns');
    const finalInbox = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'You have 1 pending invitation' }),
    });
    await finalInbox.getByRole('button', { name: 'Accept' }).click();
    await expect(finalInbox).toHaveCount(0);

    await ownerPage.goto('/campaigns');
    await ownerPage.getByRole('button', { name: `Settings for ${campaignName}` }).click();
    const memberSettings = ownerPage.getByRole('dialog', { name: campaignName });
    await memberSettings.getByRole('button', { name: 'Members', exact: true }).click();
    for (const viewport of VIEWPORTS) {
      await ownerPage.setViewportSize(viewport);
      const memberEmail = memberSettings.getByText(playerEmail, { exact: true });
      await expect(memberSettings.getByText(playerName, { exact: true })).toBeVisible();
      await expect(memberEmail).toBeVisible();
      const removeMember = memberSettings.getByRole('button', { name: 'Remove', exact: true });
      await removeMember.scrollIntoViewIfNeeded();
      await expect(removeMember).toBeVisible();
      const removeBox = await removeMember.boundingBox();
      expect(removeBox).not.toBeNull();
      if (removeBox) {
        expect(removeBox.x).toBeGreaterThanOrEqual(0);
        expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(removeBox.y).toBeGreaterThanOrEqual(0);
        expect(removeBox.y + removeBox.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      const memberTextMetrics = await memberEmail.locator('xpath=..').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        right: element.getBoundingClientRect().right,
      }));
      expect(memberTextMetrics.scrollWidth).toBeLessThanOrEqual(memberTextMetrics.clientWidth + 1);
      expect(memberTextMetrics.right).toBeLessThanOrEqual(viewport.width + 1);
      expect(
        await ownerPage.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width);
    }
  } finally {
    try {
      if (campaignId) await pool.query('delete from campaigns where id=$1', [campaignId]);
      await pool.query('delete from users where email = any($1::text[])', [[playerEmail, gmEmail]]);
    } finally {
      await pool.end();
    }
  }
});
