import { type Page, expect, test } from '@playwright/test';

const password = 'CorrectHorseBatteryStaple1';
const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const longName = 'Marin Vale the Uncommonly Long Named Adventurer with a Very Detailed Background';
const longCampaignName = 'The Long March Through the Uncharted Northern Kingdoms and Beyond';

async function api(page: Page, method: 'POST', path: string, data: object) {
  const accessToken = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok()) throw new Error(`${method} ${path} failed: ${await response.text()}`);
  return response.json() as Promise<{ id: string }>;
}

test('shared character cards work across home, characters, campaign, and GM pages', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1113, height: 900 });
  const id = suffix();
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`character-cards-${id}@example.com`);
  await page.getByLabel(/display name/i).fill('Character Cards QA');
  await page.getByLabel(/^password\b/i).fill(password);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const campaign = await api(page, 'POST', '/campaigns', { name: longCampaignName });
  const character = await api(page, 'POST', '/characters', {
    name: longName,
    campaignId: campaign.id,
    st: 11,
    dx: 12,
    iq: 13,
    ht: 14,
  });

  const surfaces = [
    { name: 'home', path: '/', card: page.locator('article').filter({ hasText: longName }) },
    {
      name: 'characters',
      path: '/characters',
      card: page.locator('article').filter({ hasText: longName }),
    },
    {
      name: 'campaign',
      path: `/campaigns/${campaign.id}`,
      card: page.locator('article').filter({ hasText: longName }),
    },
    {
      name: 'gm-dashboard',
      path: `/campaigns/${campaign.id}/gm`,
      card: page.locator('article').filter({ hasText: longName }),
    },
  ];
  const widths = [320, 767, 768, 769, 1113];

  for (const surface of surfaces) {
    await page.goto(surface.path);
    await expect(surface.card).toBeVisible({ timeout: 25_000 });
    const heading = surface.card.getByRole('heading', { level: 2, name: longName });
    await expect(heading).toBeVisible();
    const characterLink = surface.card.getByRole('link', { name: longName });
    await expect(characterLink).toHaveAttribute('href', `/characters/${character.id}`);
    if (surface.name === 'gm-dashboard') {
      await expect(characterLink).toHaveAttribute('target', '_blank');
    }
    const campaignLink = surface.card.getByRole('link', { name: longCampaignName });
    await expect(campaignLink).toHaveAttribute('href', `/campaigns/${campaign.id}`);
    for (const attribute of ['ST 11', 'DX 12', 'IQ 13', 'HT 14']) {
      await expect(surface.card.getByText(attribute, { exact: true })).toBeVisible();
    }

    for (const width of widths) {
      await page.setViewportSize({ width, height: 800 });
      await expect(surface.card).toBeVisible();
      await expect(heading).toBeVisible();
      await expect(campaignLink).toBeVisible();
      for (const attribute of ['ST 11', 'DX 12', 'IQ 13', 'HT 14']) {
        await expect(surface.card.getByText(attribute, { exact: true })).toBeVisible();
      }
      const box = await surface.card.boundingBox();
      expect(box, `${surface.name} card has no box at ${width}px`).not.toBeNull();
      if (box) {
        expect(box.x, `${surface.name} card starts outside at ${width}px`).toBeGreaterThanOrEqual(
          0,
        );
        expect(
          box.x + box.width,
          `${surface.name} card ends outside at ${width}px`,
        ).toBeLessThanOrEqual(width);
      }
      for (const label of [
        heading,
        campaignLink,
        ...['ST 11', 'DX 12', 'IQ 13', 'HT 14'].map((attribute) =>
          surface.card.getByText(attribute, { exact: true }),
        ),
      ]) {
        const labelBox = await label.boundingBox();
        expect(labelBox, `${surface.name} content has no box at ${width}px`).not.toBeNull();
        if (labelBox) {
          expect(
            labelBox.x,
            `${surface.name} content starts outside at ${width}px`,
          ).toBeGreaterThanOrEqual(0);
          expect(
            labelBox.x + labelBox.width,
            `${surface.name} content ends outside at ${width}px`,
          ).toBeLessThanOrEqual(width);
        }
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);
      if ([320, 769, 1113].includes(width)) {
        await surface.card.screenshot({
          path: testInfo.outputPath(`character-card-${surface.name}-${width}.png`),
          animations: 'disabled',
        });
      }
    }
  }

  await page.setViewportSize({ width: 1113, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /switch to dark mode/i }).click();
  for (const surface of surfaces.filter(({ name }) => ['campaign', 'characters'].includes(name))) {
    await page.goto(surface.path);
    await expect(surface.card).toBeVisible({ timeout: 25_000 });
    await surface.card.screenshot({
      path: testInfo.outputPath(`character-card-${surface.name}-1113-dark.png`),
      animations: 'disabled',
    });
  }

  await page.goto('/');
  await page.getByRole('link', { name: longCampaignName }).click();
  await expect(page).toHaveURL(`/campaigns/${campaign.id}`);

  await page.goto('/characters');
  await expect(page.getByRole('link', { name: longName })).toBeVisible();
  await page.getByRole('link', { name: longName }).click();
  await expect(page).toHaveURL(`/characters/${character.id}`);
  await expect(page.getByRole('textbox', { name: 'character name' }).first()).toHaveValue(longName);

  await page.goto(`/campaigns/${campaign.id}/gm`);
  await expect(page.getByRole('link', { name: longName })).toHaveAttribute('target', '_blank');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: longName }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`/characters/${character.id}`);
  await expect(popup.getByRole('textbox', { name: 'character name' }).first()).toHaveValue(
    longName,
  );
});
