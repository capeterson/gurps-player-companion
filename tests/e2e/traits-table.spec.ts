import { type Locator, type Page, expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';

const PASSWORD = 'change-me-please-this-is-a-seed-account';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function openSeedCharacter(page: Page, name: string) {
  const characters = await page.evaluate(async () => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
    const response = await fetch('/api/v1/characters', {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    });
    if (!response.ok) throw new Error(`Character list returned ${response.status}`);
    return (await response.json()) as Array<{ id: string; name: string }>;
  });
  const character = characters.find((candidate) => candidate.name === name);
  expect(character, `${name} is missing from the seeded character list`).toBeDefined();
  await page.goto(`/characters/${character?.id}`);
  await selectCharacterSection(page, 'Traits');
  await expect(page.getByRole('table', { name: 'Traits' })).toBeVisible();
  return character?.id ?? '';
}

async function addBrowserTrait(
  page: Page,
  characterId: string,
  name: string,
  notes = 'A compact browser-test trait with searchable notes.',
  modifiers: Array<{
    name: string;
    category: 'enhancement' | 'limitation';
    costType: 'percent' | 'flat';
    costValue: number;
    description?: string;
  }> = [],
) {
  return page.evaluate(
    async ({ id, traitName, traitNotes, traitModifiers }) => {
      const raw = localStorage.getItem('gpc.tokenPair.v1');
      const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
      const response = await fetch(`/api/v1/characters/${id}/traits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          kind: 'perk',
          name: traitName,
          points: 1,
          notes: traitNotes,
          modifiers: traitModifiers,
          customEffects: [],
        }),
      });
      if (!response.ok) throw new Error(`Trait create returned ${response.status}`);
      return ((await response.json()) as { trait: { id: string } }).trait.id;
    },
    { id: characterId, traitName: name, traitNotes: notes, traitModifiers: modifiers },
  );
}

async function removeBrowserTrait(page: Page, characterId: string, traitId: string) {
  await page.evaluate(
    async ({ id, ownedTraitId }) => {
      const raw = localStorage.getItem('gpc.tokenPair.v1');
      const accessToken = raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : null;
      await fetch(`/api/v1/characters/${id}/traits/${ownedTraitId}`, {
        method: 'DELETE',
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      });
    },
    { id: characterId, ownedTraitId: traitId },
  );
}

async function expectInsideViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

test('trait table and expanded editor wrap long names, notes, and modifiers responsively', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'rowan@example.invalid');
  const characterId = await openSeedCharacter(page, 'Kestrel Vale');
  const traitName = `UnbrokenTraitName${'WithoutSpaces'.repeat(9)}`;
  const notes = `UnbrokenTraitNotes${'LongDescription'.repeat(9)}`;
  const modifierName = `UnbrokenEnhancementName${'AdditionalWords'.repeat(6)}`;
  const modifierDescription = `UnbrokenModifierDescription${'FurtherDetails'.repeat(8)}`;
  let traitId: string | undefined;
  try {
    traitId = await addBrowserTrait(page, characterId, traitName, notes, [
      {
        name: modifierName,
        category: 'enhancement',
        costType: 'percent',
        costValue: 25,
        description: modifierDescription,
      },
    ]);
    await page.reload();
    await selectCharacterSection(page, 'Traits');

    const viewports = [
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
    for (const viewport of viewports) {
      const { width } = viewport;
      await page.setViewportSize(viewport);
      const table = page.getByRole('table', { name: 'Traits' });
      await expectInsideViewport(page, table);
      await expect(page.getByRole('button', { name: '+ Add trait' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Trait' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Points' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sort by Level' })).toBeVisible();
      if (width < 640) {
        await expect(page.getByRole('button', { name: 'Sort by Type' })).toBeHidden();
      } else {
        await expect(page.getByRole('button', { name: 'Sort by Type' })).toBeVisible();
      }

      const row = table.getByRole('rowgroup', { name: traitName });
      const traitHandleBox = await row.getByRole('button', { name: /^Reorder / }).boundingBox();
      const pointsBefore = await page.getByRole('button', { name: 'Sort by Points' }).boundingBox();
      const levelBefore = await page.getByRole('button', { name: 'Sort by Level' }).boundingBox();
      await row.getByRole('button', { name: `Edit ${traitName}` }).click();
      const closeButton = row.getByRole('button', { name: `Close ${traitName}` });
      await expect(closeButton).toBeVisible();
      const actionCellBox = await closeButton.locator('xpath=..').boundingBox();
      const closeButtonBox = await closeButton.boundingBox();
      expect(actionCellBox).not.toBeNull();
      expect(closeButtonBox).not.toBeNull();
      if (actionCellBox && closeButtonBox) {
        expect(closeButtonBox.x).toBeGreaterThanOrEqual(actionCellBox.x);
        expect(closeButtonBox.x + closeButtonBox.width).toBeLessThanOrEqual(
          actionCellBox.x + actionCellBox.width,
        );
      }
      const editorHeading = page.getByRole('heading', { name: `Edit ${traitName}` });
      await expect(editorHeading).toBeVisible();
      const editor = editorHeading.locator('xpath=../..');
      await expectInsideViewport(page, editor);
      await expect(editor.getByLabel(`${traitName} name`)).toBeVisible();
      await expect(editor.getByLabel(`${traitName} points`)).toBeVisible();
      await expect(editor.getByLabel(`${traitName} description and notes`)).toBeVisible();
      await expect(editor.getByText('Source & rules')).toBeVisible();
      const notePreviewToggle = editor.getByRole('button', { name: 'Preview description' });
      if ((await notePreviewToggle.getAttribute('aria-expanded')) !== 'true') {
        await notePreviewToggle.click();
      }
      const renderedNotes = editor.locator('.markdown-body');
      await expect(renderedNotes).toContainText(notes);
      const noteMetrics = await renderedNotes.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(noteMetrics.scrollWidth).toBeLessThanOrEqual(noteMetrics.clientWidth + 1);
      const sourceRulesSummary = editor.locator('summary').filter({ hasText: 'Source & rules' });
      const sourceRulesOpen = await sourceRulesSummary.evaluate((element) =>
        Boolean(element.parentElement && (element.parentElement as HTMLDetailsElement).open),
      );
      if (!sourceRulesOpen) await sourceRulesSummary.click();
      const modifierRow = editor.getByText(modifierName, { exact: true }).locator('xpath=..');
      await expect(modifierRow).toContainText(modifierDescription);
      const modifierMetrics = await modifierRow.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(modifierMetrics.scrollWidth).toBeLessThanOrEqual(modifierMetrics.clientWidth + 1);
      await expect(editor.getByRole('button', { name: '+ Add effects' })).toBeVisible();
      if (width === 320) {
        await editor.getByRole('button', { name: '+ Add effects' }).click();
        await expect(editor.getByText('Effects', { exact: true })).toBeVisible();
        await editor.getByRole('button', { name: 'Remove effects' }).click();
        await expect(editor.getByRole('button', { name: '+ Add effects' })).toBeVisible();
      }
      const deleteTrait = editor.getByRole('button', { name: 'Delete trait' });
      const doneEditing = editor.getByRole('button', { name: 'Done' });
      await expect(deleteTrait).toBeVisible();
      const pointsAfter = await page.getByRole('button', { name: 'Sort by Points' }).boundingBox();
      const levelAfter = await page.getByRole('button', { name: 'Sort by Level' }).boundingBox();
      expect(pointsAfter?.x).toBeCloseTo(pointsBefore?.x ?? 0, 0);
      expect(levelAfter?.x).toBeCloseTo(levelBefore?.x ?? 0, 0);
      if (viewport.width === 320 || (viewport.width === 568 && viewport.height === 320)) {
        for (const action of [deleteTrait, doneEditing]) {
          await action.scrollIntoViewIfNeeded();
          await expect(action).toBeVisible();
          const [box, visible] = await Promise.all([
            action.boundingBox(),
            page.evaluate(() => {
              const visual = window.visualViewport;
              const left = visual?.offsetLeft ?? 0;
              const top = visual?.offsetTop ?? 0;
              const width = visual?.width ?? window.innerWidth;
              const height = visual?.height ?? window.innerHeight;
              return { left, top, right: left + width, bottom: top + height };
            }),
          ]);
          expect(box).not.toBeNull();
          if (box) {
            expect(box.x).toBeGreaterThanOrEqual(visible.left - 1);
            expect(box.y).toBeGreaterThanOrEqual(visible.top - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(visible.right + 1);
            expect(box.y + box.height).toBeLessThanOrEqual(visible.bottom + 1);
          }
        }
        await page.screenshot({
          path: testInfo.outputPath(`traits-editor-${width}x${viewport.height}.png`),
          animations: 'disabled',
        });
      }
      await doneEditing.click();

      await selectCharacterSection(page, 'Skills');
      const skillHandleBox = await page
        .getByRole('table', { name: 'Skills' })
        .getByRole('button', { name: /^Reorder / })
        .first()
        .boundingBox();
      expect(traitHandleBox?.x).toBeCloseTo(skillHandleBox?.x ?? 0, 0);
      expect(traitHandleBox?.width).toBeCloseTo(skillHandleBox?.width ?? 0, 0);
      await selectCharacterSection(page, 'Traits');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
  } finally {
    if (traitId) await removeBrowserTrait(page, characterId, traitId);
  }
});

test('trait browsing stays available without mutation controls for a read-only campaign viewer', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, 'rowan@example.invalid');
  const characterId = await openSeedCharacter(ownerPage, 'Kestrel Vale');
  const traitName = `Reader-visible trait ${Date.now()}`;
  const traitId = await addBrowserTrait(ownerPage, characterId, traitName);

  try {
    const readerContext = await browser.newContext({ viewport: { width: 390, height: 760 } });
    const readerPage = await readerContext.newPage();
    await signIn(readerPage, 'seed@example.invalid');
    await openSeedCharacter(readerPage, 'Kestrel Vale');

    for (const width of [390, 1280]) {
      await readerPage.setViewportSize({ width, height: width < 640 ? 760 : 900 });
      await readerPage.getByRole('searchbox', { name: 'Search traits' }).fill(traitName);
      const row = readerPage
        .getByRole('table', { name: 'Traits' })
        .getByRole('rowgroup', { name: traitName });
      await expect(row).toBeVisible();
      await expect(readerPage.getByRole('button', { name: 'Sort by Trait' })).toBeVisible();
      await expect(row.getByRole('button', { name: /^Reorder / })).toBeVisible();
      await expect(readerPage.getByRole('button', { name: '+ Add trait' })).toHaveCount(0);
      await expect(row.getByRole('button', { name: `Edit ${traitName}` })).toHaveCount(0);
      await row.getByRole('button', { name: `View ${traitName}` }).click();
      await expect(
        row.getByText('A compact browser-test trait with searchable notes.', { exact: true }),
      ).toBeVisible();
      await expect(readerPage.getByRole('button', { name: 'Delete trait' })).toHaveCount(0);
      await row.getByRole('button', { name: `Close ${traitName}` }).click();
      await expect
        .poll(() => readerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
    }
    await readerContext.close();
  } finally {
    await removeBrowserTrait(ownerPage, characterId, traitId);
    await ownerContext.close();
  }
});
