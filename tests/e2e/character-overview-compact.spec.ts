import { type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

async function register(page: Page) {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto('/register');
  await page.getByLabel(/email/i).fill(`overview-${runId}@example.com`);
  await page.getByLabel(/display name/i).fill('Overview QA');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
}

test('overview stays compact and description and conditional effects work at supported widths', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const token = await register(page);
  async function create(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  async function update(path: string, data: object) {
    const response = await page.request.patch(`/api/v1${path}`, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }

  const campaign = await create('/campaigns', {
    name: 'Overview campaign',
    experimentalActiveEffects: true,
  });
  const longConditionLabel =
    'Focused stance against overwhelming odds while maintaining a defensive formation';
  const longLinkCaption = 'Open the full character reference and campaign rules';
  const traitDefinition = await create(`/campaigns/${campaign.id}/library/traits`, {
    name: 'Focused stance',
    kind: 'advantage',
    basePoints: 1,
    effects: [
      {
        target: 'dx',
        value: 2,
        scaling: 'flat',
        conditionGroup: 'focused',
        conditionLabel: longConditionLabel,
      },
    ],
  });
  const effectDefinition = await create(`/campaigns/${campaign.id}/library/active-effects`, {
    name: 'Adrenaline',
    effects: [
      {
        target: 'st',
        value: 1,
        conditionGroup: 'adrenaline',
        conditionLabel: 'Adrenaline',
      },
    ],
    stacking: { kind: 'additive', key: 'adrenaline' },
    duration: { kind: 'minutes', amount: 5 },
  });
  const character = await create('/characters', {
    name: 'Compact overview hero',
    campaignId: campaign.id,
  });
  await create(`/characters/${character.id}/traits`, {
    name: 'Focused stance',
    kind: 'advantage',
    points: 1,
    libraryTraitId: traitDefinition.id,
  });
  const now = new Date();
  const activeEffect = {
    id: crypto.randomUUID(),
    definitionId: effectDefinition.id,
    sourceRevision: effectDefinition.revision,
    sourceCampaignId: campaign.id,
    name: effectDefinition.name,
    description: effectDefinition.description,
    source: effectDefinition.source,
    tags: effectDefinition.tags,
    effects: effectDefinition.effects,
    capabilities: effectDefinition.capabilities,
    stacking: effectDefinition.stacking,
    state: 'active',
    appliedAt: now.toISOString(),
    duration: effectDefinition.duration,
    remainingRounds: null,
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    sourceInventoryId: null,
    notes: null,
  };
  await update(`/characters/${character.id}`, { activeEffects: [activeEffect] });

  await page.goto(`/characters/${character.id}`);
  await selectCharacterSection(page, 'Overview');
  await expect(page.getByRole('heading', { name: 'Attributes', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Secondary attributes', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
  for (const heading of ['Attributes', 'Secondary attributes', 'Status']) {
    await expect(page.getByRole('button', { name: heading, exact: true })).toHaveCount(0);
  }
  await expect(
    page.getByRole('heading', { name: 'Conditional effects', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Enable a condition to apply its modifiers.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(/Groups come from trait effects and Combat → Active Effects\./),
  ).toBeVisible();

  const descriptionView = page.getByRole('group', { name: 'Character description' });
  await expect(descriptionView).toBeVisible();
  await expect(descriptionView).toContainText('No description yet.');
  await context.route('https://example.com/overview-reference', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Reference</title>' }),
  );
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('button', { name: 'Edit raw markdown', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'description', exact: true });
  await expect(editor).toBeVisible();
  await editor.fill(`[${longLinkCaption}](https://example.com/overview-reference)`);
  await page.getByRole('button', { name: 'Done editing description', exact: true }).click();
  const queuedDescription = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Array<{ fieldPath?: string; attemptedValue?: string }>>(
        (resolve, reject) => {
          const request = db.transaction('outbox').objectStore('outbox').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        },
      );
    } finally {
      db.close();
    }
  });
  expect(queuedDescription).toContainEqual(
    expect.objectContaining({
      fieldPath: 'appearance',
      attemptedValue: `[${longLinkCaption}](https://example.com/overview-reference)`,
    }),
  );
  await context.setOffline(false);
  await expect(
    page.getByRole('button', { name: 'All changes saved', exact: true }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to rich text', exact: true })).toBeVisible();
  await expect(editor).toHaveValue(`[${longLinkCaption}](https://example.com/overview-reference)`);
  await page.getByRole('button', { name: 'Back to rich text', exact: true }).click();
  await page.getByRole('button', { name: 'Done editing description', exact: true }).click();
  const reference = page.getByRole('link', { name: longLinkCaption, exact: true });
  await expect(reference).toHaveAttribute('href', 'https://example.com/overview-reference');
  await reference.click();
  await expect(page).toHaveURL('https://example.com/overview-reference');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/characters/${character.id}$`));

  await context.route('**/api/v1/sync/operations', async (route) => {
    const request = route.request().postDataJSON() as {
      operations: Array<{ clientOpId: string }>;
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        outcomes: request.operations.map(({ clientOpId }) => ({
          clientOpId,
          status: 'rejected',
          reason: 'description rejected in UI test',
        })),
      }),
    });
  });
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('button', { name: 'Edit raw markdown', exact: true }).click();
  await editor.fill('[Rejected edit](https://example.com/rejected)');
  await page.getByRole('button', { name: 'Done editing description', exact: true }).click();
  await expect(
    page.getByText(/Couldn't sync description — description rejected in UI test/),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(descriptionView).toHaveAttribute('data-flashing', 'true', { timeout: 20_000 });
  await expect(descriptionView).toContainText(longLinkCaption);
  await context.unroute('**/api/v1/sync/operations');

  const focused = page.getByRole('checkbox', { name: longConditionLabel, exact: true });
  const adrenaline = page.getByRole('checkbox', { name: 'Adrenaline', exact: true });
  await expect(focused).not.toBeChecked();
  await expect(adrenaline).not.toBeChecked();
  await focused.check();
  await adrenaline.check();
  await expect(focused).toBeChecked();
  await expect(adrenaline).toBeChecked();
  const sheetOverview = page.getByRole('button', { name: /^Sheet overview/ });
  await sheetOverview.click();
  await expect(sheetOverview).toContainText('ST 11 · DX 12');
  await sheetOverview.click();

  const characterPath = new URL(page.url()).pathname;
  const foldNames = [/^Point ledger/, /^Encumbrance$/, /^Conditional effects$/];
  const widths = [320, 767, 768, 769, 1279, 1280, 1281];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of foldNames) {
      const fold = page.getByRole('button', { name });
      await expect(fold).toBeVisible();
      if (width === 320 && name instanceof RegExp && name.source === '^Conditional effects$') {
        if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
        await expect(
          page.getByRole('checkbox', { name: longConditionLabel, exact: true }),
        ).toBeVisible();
        const labelBox = await page.getByText(longConditionLabel, { exact: true }).boundingBox();
        expect(labelBox).not.toBeNull();
        if (labelBox) {
          expect(labelBox.x).toBeGreaterThanOrEqual(0);
          expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(width);
        }
      }
      if ((await fold.getAttribute('aria-expanded')) === 'true') await fold.click();
      await expect(fold).toHaveAttribute('aria-expanded', 'false');
      const panel = fold.locator('xpath=ancestor::section[1]');
      const [panelBox, headingBox] = await Promise.all([panel.boundingBox(), fold.boundingBox()]);
      expect(panelBox).not.toBeNull();
      expect(headingBox).not.toBeNull();
      if (panelBox && headingBox) {
        expect(panelBox.height - headingBox.height).toBeGreaterThanOrEqual(0);
        expect(panelBox.height - headingBox.height).toBeLessThanOrEqual(2);
      }
    }
    const utilities = page.locator('.flex.min-w-0.flex-col.gap-4').filter({
      has: page.getByRole('button', { name: /^Conditional effects$/ }),
    });
    const utilityItems = utilities.locator(':scope > *');
    for (let index = 0; index < (await utilityItems.count()) - 1; index += 1) {
      const [current, next] = await Promise.all([
        utilityItems.nth(index).boundingBox(),
        utilityItems.nth(index + 1).boundingBox(),
      ]);
      expect(current).not.toBeNull();
      expect(next).not.toBeNull();
      if (current && next) expect(next.y - (current.y + current.height)).toBeLessThanOrEqual(20);
    }
    const documentWidth = await page.locator('html').evaluate((node) => node.scrollWidth);
    expect(documentWidth).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`overview-${width}.png`) });
  }

  const emptyCharacter = await create('/characters', { name: 'No conditions hero' });
  await page.goto(`/characters/${emptyCharacter.id}`);
  await selectCharacterSection(page, 'Overview');
  await expect(page.getByRole('heading', { name: 'Attributes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Conditional effects', exact: true })).toHaveCount(
    0,
  );

  await page.goto(characterPath);
  await expect(page.getByRole('link', { name: longLinkCaption, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await page.getByRole('button', { name: 'Edit raw markdown', exact: true }).click();
  await editor.fill('');
  await page.getByRole('button', { name: 'Done editing description', exact: true }).click();
  await expect(descriptionView).toContainText('No description yet.');
  await page.getByRole('button', { name: 'Edit description', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to rich text', exact: true })).toBeVisible();
  await expect(editor).toHaveValue('');
  await page.getByRole('button', { name: 'Back to rich text', exact: true }).click();
  await page.getByRole('button', { name: 'Done editing description', exact: true }).click();
});
