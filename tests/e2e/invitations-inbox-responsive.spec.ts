import { expect, test } from '@playwright/test';

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

test('pending invitation inbox wraps long campaign names across supported widths', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const campaignName = 'I'.repeat(120);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/register');
  const playerEmail = `invitation-inbox-${suffix()}@example.com`;
  await page.getByLabel(/email/i).fill(playerEmail);
  await page.getByLabel(/display name/i).fill('Invitation Inbox QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible({
    timeout: 15_000,
  });

  const gmRegistration = await page.request.post('/api/v1/auth/register', {
    data: {
      email: `invitation-gm-${suffix()}@example.com`,
      password: 'CorrectHorseBatteryStaple1',
      displayName: 'Invitation GM QA',
    },
  });
  expect(gmRegistration.status(), await gmRegistration.text()).toBe(201);
  const gmToken = ((await gmRegistration.json()) as { accessToken: string }).accessToken;
  const campaignResponse = await page.request.post('/api/v1/campaigns', {
    headers: { authorization: `Bearer ${gmToken}` },
    data: { name: campaignName },
  });
  expect(campaignResponse.status(), await campaignResponse.text()).toBe(201);
  const campaign = (await campaignResponse.json()) as { id: string };
  const invitationResponse = await page.request.post(
    `/api/v1/campaigns/${campaign.id}/invitations`,
    {
      headers: { authorization: `Bearer ${gmToken}` },
      data: { handle: playerEmail, role: 'member' },
    },
  );
  expect(invitationResponse.status(), await invitationResponse.text()).toBe(201);

  const viewports = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 568, height: 320 },
    { width: 639, height: 800 },
    { width: 640, height: 800 },
    { width: 641, height: 800 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ];
  for (const viewport of viewports) {
    await test.step(`${viewport.width}×${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.goto('/campaigns');
      const inbox = page.locator('section').filter({
        has: page.getByRole('heading', { name: 'You have 1 pending invitation' }),
      });
      await expect(inbox).toBeVisible();
      await expect(inbox.getByText(campaignName, { exact: true })).toBeVisible();
      const accept = inbox.getByRole('button', { name: 'Accept' });
      const reject = inbox.getByRole('button', { name: 'Reject' });
      await expect(accept).toBeVisible();
      await expect(reject).toBeVisible();

      const inboxBox = await inbox.boundingBox();
      const campaignBox = await inbox.getByText(campaignName, { exact: true }).boundingBox();
      const acceptBox = await accept.boundingBox();
      const rejectBox = await reject.boundingBox();
      expect(inboxBox).not.toBeNull();
      expect(campaignBox).not.toBeNull();
      expect(acceptBox).not.toBeNull();
      expect(rejectBox).not.toBeNull();
      for (const [label, box] of [
        ['inbox', inboxBox],
        ['campaign name', campaignBox],
        ['accept button', acceptBox],
        ['reject button', rejectBox],
      ] as const) {
        if (!box) throw new Error(`Expected ${label} to have a bounding box`);
        expect(box.x, `${label} left at ${viewport.width}px`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${label} right at ${viewport.width}px`).toBeLessThanOrEqual(
          viewport.width,
        );
        expect(box.y, `${label} top at ${viewport.height}px`).toBeGreaterThanOrEqual(0);
        expect(
          box.y + box.height,
          `${label} bottom at ${viewport.height}px`,
        ).toBeLessThanOrEqual(viewport.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
      await page.screenshot({
        path: testInfo.outputPath(`invitations-inbox-${viewport.width}x${viewport.height}.png`),
        animations: 'disabled',
      });
    });
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/campaigns');
  const finalInbox = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'You have 1 pending invitation' }),
  });
  await finalInbox.getByRole('button', { name: 'Reject' }).click();
  await expect(finalInbox).toHaveCount(0);
});
