import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation.ts';
import { captureReviewScreenshot } from './review-artifacts';

const PASSWORD = 'CorrectHorseBatteryStaple1';
const API = '/api/v1';

async function createLibrarySpell(
  page: import('@playwright/test').Page,
  campaignId: string,
  body: Record<string, unknown>,
) {
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const response = await page.request.post(`${API}/campaigns/${campaignId}/library/spells`, {
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

test('library preserves special text and each Unicode group jump reaches its own group', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`special-library-${Date.now()}@example.com`);
  await page.getByLabel(/display name/i).fill('Special Library QA');
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  const registrationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/register') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /create account/i }).click();
  expect((await registrationResponse).status()).toBe(201);
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const campaignResponse = await page.request.post(`${API}/campaigns`, {
    data: { name: 'Special character QA campaign' },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(campaignResponse.status()).toBe(201);
  const { id: campaignId } = (await campaignResponse.json()) as { id: string };

  const canary = '<img src=x onerror="window.__gpcCanary=1">';
  const visibleName = `Spell "quotes" & <angle> \\ % _ # café 東京 אבג 😀 ${canary}`;
  const visibleDescription = `Damage > 10; HP < 5; **Bold** & "quotes" \\ % _ # café 東京 אבג 😀`;
  const collapsedDescription = `Damage > 10; HP < 5; **Bold** & "quotes" \\ % _ # café 東京 אבג 😀`;
  const { id: librarySpellId } = await createLibrarySpell(page, campaignId, {
    key: 'qa-special-text',
    name: visibleName,
    college: '火',
    difficulty: 'H',
    baseEnergyCost: 1,
    description: visibleDescription,
    source: 'B & " < > \\ café 😀',
    status: 'complete',
    role: 'definition',
    extraction: { rawText: canary, reviewNotes: 'metadata & accents café 東京 אבג 😀' },
  });

  // These groups ensure the last college sits far enough down the page to
  // make a wrong getElementById target visible in browser geometry.
  for (let index = 0; index < 16; index += 1) {
    await createLibrarySpell(page, campaignId, {
      key: `qa-college-${String(index).padStart(2, '0')}`,
      name: `Group spell ${String(index).padStart(2, '0')}`,
      college: `College ${String(index).padStart(2, '0')}`,
      difficulty: 'H',
      baseEnergyCost: 1,
    });
  }
  await createLibrarySpell(page, campaignId, {
    key: 'qa-fire-emoji',
    name: 'Emoji college spell',
    college: '🔥',
    difficulty: 'H',
    baseEnergyCost: 1,
  });
  for (let index = 1; index < 8; index += 1) {
    await createLibrarySpell(page, campaignId, {
      key: `qa-fire-emoji-${index}`,
      name: `Emoji college spell ${index}`,
      college: '🔥',
      difficulty: 'H',
      baseEnergyCost: 1,
    });
    await createLibrarySpell(page, campaignId, {
      key: `qa-fire-cjk-${index}`,
      name: `CJK college spell ${index}`,
      college: '火',
      difficulty: 'H',
      baseEnergyCost: 1,
    });
  }
  await createLibrarySpell(page, campaignId, {
    key: 'qa-punctuation',
    name: 'Punctuation college spell',
    college: '!',
    difficulty: 'H',
    baseEnergyCost: 1,
  });
  const taggedSkillName = 'Skill with searchable tags';
  const tag = 'Tag_#%& café 東京 🔥';
  const skillResponse = await page.request.post(`${API}/campaigns/${campaignId}/library/skills`, {
    data: {
      key: 'qa-special-tags',
      name: taggedSkillName,
      attribute: 'IQ',
      difficulty: 'H',
      description: 'A skill whose tags contain Unicode and punctuation.',
      source: 'B & " < > \\ café 😀',
      groups: ['注記_#%&🔥'],
      tags: [tag],
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(skillResponse.status(), await skillResponse.text()).toBe(201);

  await page.goto(`/campaigns/${campaignId}/library?section=spells`);
  await expect(page.getByRole('button', { name: visibleName, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(collapsedDescription, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: visibleName, exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const spellSearch = page.getByRole('searchbox', { name: 'Search library' });
  await spellSearch.fill('東京');
  await expect(page.getByRole('button', { name: visibleName, exact: true })).toBeVisible();
  await spellSearch.fill('');
  const headings = page.locator('.library-group-heading');
  await expect(headings).toHaveCount(19);
  const ids = await headings.evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const fireJump = page
    .getByRole('navigation', { name: 'Jump to spell group' })
    .getByRole('button', { name: /^🔥 8$/ });
  await fireJump.click();
  const fireHeading = headings.filter({ hasText: /^🔥\s*8$/ });
  await expect
    .poll(async () => {
      const target = await fireHeading.boundingBox();
      const toolbar = await page.locator('.library-toolbar').boundingBox();
      return target && toolbar ? target.y - (toolbar.y + toolbar.height) : Number.NEGATIVE_INFINITY;
    })
    .toBeGreaterThan(0);
  const geometry = await fireHeading.evaluate((target) => {
    const toolbar = document.querySelector('.library-toolbar');
    const header = document.querySelector('.app-header');
    return {
      targetTop: target.getBoundingClientRect().top,
      toolbarBottom: toolbar?.getBoundingClientRect().bottom ?? 0,
      headerBottom: header?.getBoundingClientRect().bottom ?? 0,
      visible:
        target.getBoundingClientRect().bottom > 0 &&
        target.getBoundingClientRect().top < innerHeight,
    };
  });
  expect(geometry.visible).toBe(true);
  expect(geometry.targetTop).toBeGreaterThan(geometry.toolbarBottom);
  expect(geometry.targetTop - geometry.toolbarBottom).toBeLessThan(24);
  expect(geometry.toolbarBottom).toBeGreaterThan(geometry.headerBottom);
  await captureReviewScreenshot(page, {
    path: testInfo.outputPath('special-library-group-jump.png'),
  });

  await page.getByRole('button', { name: visibleName, exact: true }).click();
  await expect(page.locator('.markdown-body')).toContainText(
    `Damage > 10; HP < 5; Bold & "quotes" \\ % _ # café 東京 אבג 😀`,
  );
  const renderedSafety = await page.evaluate(() => ({
    canary: (window as Window & { __gpcCanary?: number }).__gpcCanary ?? null,
    injectedImages: document.querySelectorAll('img[src="x"][onerror]').length,
    injectedHandlers: document.querySelectorAll('[onerror]').length,
  }));
  expect(renderedSafety).toEqual({ canary: null, injectedImages: 0, injectedHandlers: 0 });

  await page.goto(`/campaigns/${campaignId}/library?section=skills`);
  const librarySearch = page.getByRole('searchbox', { name: 'Search library' });
  await librarySearch.fill('東京');
  await expect(page.getByRole('button', { name: taggedSkillName, exact: true })).toBeVisible();
  await librarySearch.fill('');

  await page.goto(`/campaigns/${campaignId}/library-transfer`);
  await expect(page.getByRole('heading', { name: 'Import & export' })).toBeVisible();
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export YAML' }).click();
  const download = await exportDownload;
  const yamlPath = testInfo.outputPath('special-library.yaml');
  await download.saveAs(yamlPath);
  const exportedYaml = await readFile(yamlPath, 'utf8');
  expect(exportedYaml).toContain(visibleName);
  expect(exportedYaml).toContain(visibleDescription);
  expect(exportedYaml).toContain(tag);
  expect(exportedYaml).toContain(canary);
  await page.getByLabel('YAML file').setInputFiles(yamlPath);
  await page.getByRole('button', { name: 'Review import' }).click();
  const importDialog = page.getByRole('dialog', { name: /Import special-library\.yaml/i });
  await expect(importDialog).toBeVisible();
  const modalBox = importDialog.locator('.modal-box');
  await expect(modalBox).toHaveCSS('opacity', '1');
  for (const width of [320, 639, 640, 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(page.getByRole('heading', { name: 'Import & export' })).toBeVisible();
    await expect(importDialog.getByRole('button', { name: 'Merge library' })).toBeVisible();
    await expect(modalBox).toHaveCSS('opacity', '1');
    const box = await modalBox.boundingBox();
    if (!box) throw new Error('Import dialog has no visible bounding box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(720);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    if (width === 320)
      await captureReviewScreenshot(page, {
        path: testInfo.outputPath('library-transfer-mobile.png'),
        animations: 'disabled',
      });
  }
  await page.getByRole('button', { name: 'Merge library' }).click();
  await expect(page.getByText(/Imported|Merged|created|updated/i)).toBeVisible({ timeout: 15_000 });
  await page.goto(`/campaigns/${campaignId}/library?section=spells`);
  await expect(page.getByRole('button', { name: visibleName, exact: true })).toBeVisible();

  const characterResponse = await page.request.post(`${API}/characters`, {
    data: { name: 'Special library adoption QA', campaignId },
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(characterResponse.status(), await characterResponse.text()).toBe(201);
  const { id: characterId } = (await characterResponse.json()) as { id: string };
  await page.goto(`/characters/${characterId}`);
  await selectCharacterSection(page, 'Magic');
  const spellInput = page.getByRole('textbox', { name: 'Spell' });
  await spellInput.fill(visibleName);
  const option = page.getByRole('option').filter({ hasText: visibleName });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  await expect(spellInput).toHaveValue(visibleName);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const adoptedSpellName = page.getByRole('textbox', {
    name: `${visibleName} name`,
    exact: true,
  });
  await expect(adoptedSpellName).toHaveValue(visibleName, { timeout: 15_000 });
  const adoptedSafety = await page.evaluate(() => ({
    canary: (window as Window & { __gpcCanary?: number }).__gpcCanary ?? null,
    injectedImages: document.querySelectorAll('img[src="x"][onerror]').length,
    injectedHandlers: document.querySelectorAll('[onerror]').length,
  }));
  expect(adoptedSafety).toEqual({ canary: null, injectedImages: 0, injectedHandlers: 0 });

  await expect
    .poll(async () => {
      const response = await page.request.get(`${API}/characters/${characterId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok()) return false;
      const detail = (await response.json()) as {
        spells?: Array<{ name: string; librarySpellId: string | null; notes: string | null }>;
      };
      return detail.spells?.some(
        (spell) =>
          spell.name === visibleName &&
          spell.librarySpellId === librarySpellId &&
          spell.notes === visibleDescription,
      );
    })
    .toBe(true);

  await selectCharacterSection(page, 'History');
  await expect(page.getByText(`Learned spell ${visibleName}`, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
});
