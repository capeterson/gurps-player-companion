import { expect, test } from '@playwright/test';

test('log attachments default to Campaign, save private character notes, and explain visibility within the viewport', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`log-attachment-${suffix}@example.com`);
  await page.getByLabel(/display name/i).fill('Log attachment QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  const fixtures = await page.evaluate(async () => {
    const pair = JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}') as {
      accessToken: string;
    };
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${pair.accessToken}`,
    };
    const campaignResponse = await fetch('/api/v1/campaigns', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Attachment campaign' }),
    });
    if (!campaignResponse.ok) throw new Error('Campaign creation failed');
    const campaign = (await campaignResponse.json()) as { id: string };
    const characterResponse = await fetch('/api/v1/characters', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'The Very Long Named Wandering Chronicler of Distant Campaigns',
      }),
    });
    if (!characterResponse.ok) throw new Error('Character creation failed');
    const character = (await characterResponse.json()) as { id: string };
    return { campaignId: campaign.id, characterId: character.id };
  });
  await page.goto(`/campaigns/${fixtures.campaignId}/log`);
  await page.getByRole('button', { name: '+ New entry' }).click();
  const attachment = page.getByRole('combobox', { name: 'Attached to' });
  await expect(attachment).toHaveValue('');
  await expect(attachment.locator('option', { hasText: 'The Very Long Named' })).toHaveCount(1);
  for (const width of [320, 639, 640, 641, 767, 768, 769, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const trigger = page.getByRole('button', { name: 'About log attachments' });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('visible only to you');
    await expect(tooltip).toContainText('Point recipients are chosen separately');
    await expect(async () => {
      const box = await tooltip.boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(801);
    }).toPass();
    await page.screenshot({ path: testInfo.outputPath(`attachment-tooltip-${width}.png`) });
    await page.mouse.move(0, 0);
  }
  await attachment.selectOption(fixtures.characterId);
  await page.getByLabel('Title', { exact: true }).fill('A private chronicle');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  const entry = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'A private chronicle' }) });
  await expect(entry).toContainText(
    'private · The Very Long Named Wandering Chronicler of Distant Campaigns',
  );
  for (const width of [320, 639, 640, 641]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(entry.getByRole('button', { name: 'Edit A private chronicle' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({ path: testInfo.outputPath(`private-log-${width}.png`) });
  }
  await page.reload();
  await entry.getByRole('button', { name: 'Edit A private chronicle' }).click();
  await expect(attachment).toHaveValue(fixtures.characterId);
  await attachment.selectOption('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(entry.getByText(/^private(?: ·|$)/)).toHaveCount(0);
  await page.getByRole('button', { name: '+ New entry' }).click();
  await expect(attachment).toHaveValue('');
});
