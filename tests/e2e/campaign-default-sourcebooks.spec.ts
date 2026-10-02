import { expect, test } from '@playwright/test';
import { captureReviewScreenshot } from './review-artifacts';

test('new campaigns show revised sources and citations on collapsed library rows', async ({
  page,
}, testInfo) => {
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`revised-sources-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Sourcebook QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.goto('/campaigns');
  await page.getByRole('button', { name: '+ New campaign', exact: true }).click();
  await page.getByLabel('Campaign name').fill('Revised sourcebooks QA');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/campaigns') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const response = await created;
  expect(response.status(), await response.text()).toBe(201);
  const { id } = (await response.json()) as { id: string };

  await page.evaluate((campaignId) => {
    localStorage.setItem(
      `gpc:fold:${campaignId}:library:sources`,
      JSON.stringify(['Publications', '']),
    );
  }, id);

  await page.goto(`/campaigns/${id}/library?section=sources`);
  const source = page.getByRole('button', {
    name: 'GURPS Basic Set, Fourth Edition Revised',
    exact: true,
  });
  await expect(source).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /^Publications/ })).toHaveCount(0);
  await expect(page.getByText('Publications', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'GURPS Magic', exact: true })).toBeVisible();
  await expect(source.locator('.badge')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'GURPS Basic Set: Characters', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'GURPS Basic Set: Campaigns', exact: true }),
  ).toHaveCount(0);
  await source.click();
  await expect(source).toHaveAttribute('aria-expanded', 'true');
  const details = page.locator(`[id="${await source.getAttribute('aria-controls')}"]`);
  await expect(details).toBeVisible();
  await expect(details.locator('.badge')).toHaveCount(0);
  await expect(source.locator('xpath=ancestor::tr').getByText('B · Priority 100')).toBeVisible();
  for (const label of ['Legacy source', 'complete', 'definition']) {
    await expect(details.getByText(label, { exact: true })).toHaveCount(0);
  }
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('revised-basic-set-sourcebook.png'),
    fullPage: true,
  });

  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const entries = [
    {
      name: 'Library badge QA advantage',
      kind: 'advantage',
      basePoints: 5,
      description: 'Visible advantage description.',
      source: 'B71',
      status: 'complete',
      role: 'definition',
      preferredEdition: true,
    },
    {
      name: 'Library badge QA reference',
      kind: 'disadvantage',
      basePoints: -5,
      description: 'Visible reference description.',
      source: 'B71–72, Appendix: revised addenda',
      status: 'needs_review',
      role: 'example',
      restricted: true,
    },
  ];
  for (const entry of entries) {
    const saved = await page.request.post(`/api/v1/campaigns/${id}/library/traits`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...entry, sourceKey: 'basic-set-fourth-edition-revised' },
    });
    expect(saved.status(), await saved.text()).toBe(201);
  }
  await page.goto(`/campaigns/${id}/library?section=traits`);
  for (const entry of entries) {
    const button = page.getByRole('button', { name: entry.name, exact: true });
    await expect(button).toBeVisible({ timeout: 20_000 });
    await expect(button.locator('.badge')).toHaveCount(0);
    const row = button.locator('xpath=ancestor::tr');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(row.getByText(entry.source, { exact: true })).toBeVisible();
    await button.click();
    const entryDetails = page.locator(`[id="${await button.getAttribute('aria-controls')}"]`);
    await expect(entryDetails.getByText(entry.description, { exact: true })).toBeVisible();
    await expect(entryDetails.getByText(`Source · ${entry.source}`, { exact: true })).toHaveCount(
      0,
    );
    await expect(row.getByText(entry.source, { exact: true })).toBeVisible();
    await expect(entryDetails.locator('.badge')).toHaveCount(0);
    for (const label of [
      'Legacy source',
      'complete',
      'needs review',
      'definition',
      'example',
      'Preferred edition',
      'Default edition',
      'Restricted · GM only',
    ]) {
      await expect(entryDetails.getByText(label, { exact: true })).toHaveCount(0);
    }
  }
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('library-content-without-badges.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: entries[1].name, exact: true }).click();
  for (const width of [320, 639, 640, 641, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const entry of entries) {
      const button = page.getByRole('button', { name: entry.name, exact: true });
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      const row = button.locator('xpath=ancestor::tr');
      const citation = row.getByText(entry.source, { exact: true });
      await expect(citation).toBeVisible();
      const summary = row.getByText(
        entry.basePoints > 0 ? 'Advantage · 5 pt' : 'Disadvantage · -5 pt',
      );
      await expect(summary).toBeVisible();
      const box = await citation.boundingBox();
      if (!box) throw new Error('citation is not visible');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (width === 1280) {
        const summaryBox = await summary.boundingBox();
        if (!summaryBox) throw new Error('summary is not visible');
        expect(Math.abs(box.y - summaryBox.y)).toBeLessThanOrEqual(1);
        expect(box.x).toBeGreaterThanOrEqual(summaryBox.x + summaryBox.width);
      }
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width);
    if (width === 320 || width === 640 || width === 1280) {
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath(`collapsed-citations-${width}.png`),
        fullPage: true,
      });
    }
  }

  // Confirm the current source-key field creates the actual publication link.
  await page.getByRole('button', { name: `Edit ${entries[0].name}`, exact: true }).click();
  await page
    .locator('summary')
    .filter({ hasText: /^Source and completeness/ })
    .click();
  await expect(page.getByLabel('Source key', { exact: true })).toHaveValue(
    'basic-set-fourth-edition-revised',
  );
  await page.getByLabel('Source key', { exact: true }).fill('magic');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect
    .poll(async () => {
      const saved = await page.request.get(`/api/v1/campaigns/${id}/library`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const library = await saved.json();
      return library.traits.find((trait: { name: string }) => trait.name === entries[0].name)
        ?.sourceKey;
    })
    .toBe('magic');
});
