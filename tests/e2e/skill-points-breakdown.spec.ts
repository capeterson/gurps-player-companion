import { expect, test } from '@playwright/test';
import { selectCharacterSection } from './character-navigation';
import { captureReviewScreenshot } from './review-artifacts';

test('draft skill points show a live linked breakdown inside the viewport', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page.getByLabel(/^password\b/i).fill('change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  const token = await page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
  const headers = { authorization: `Bearer ${token}` };
  const name = 'Precision fieldcraft';
  const sourceName = `Related fieldcraft ${'S'.repeat(135)}`;
  const traitName = `Fieldcraft talent ${'T'.repeat(135)}`;
  async function post(path: string, data: object) {
    const response = await page.request.post(`/api/v1${path}`, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const character = await post('/characters', { name: 'Skill preview surveyor' });
  const characterId = character.id as string;
  try {
    const source = await post(`/characters/${characterId}/skills`, {
      name: sourceName,
      attribute: 'DX',
      difficulty: 'A',
      points: 20,
    });
    const target = await post(`/characters/${characterId}/skills`, {
      name,
      attribute: 'DX',
      difficulty: 'A',
      points: 1,
      defaults: [{ kind: 'skill', name: sourceName, modifier: -2 }],
    });
    const trait = await post(`/characters/${characterId}/traits`, {
      name: traitName,
      kind: 'advantage',
      points: 0,
      modifiers: [],
      customEffects: [
        { target: 'dx', value: 1, scaling: 'flat' },
        { target: 'skill', skillName: name, value: 2, scaling: 'flat' },
      ],
    });
    const sourceId = (source.skill ?? source).id as string;
    const targetId = (target.skill ?? target).id as string;
    const traitId = (trait.trait ?? trait).id as string;
    await page.goto(`/characters/${characterId}`);
    await selectCharacterSection(page, 'Skills');
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    const input = page.getByRole('textbox', { name: `${name} points`, exact: true });
    const tooltip = page.getByRole('tooltip');
    await input.fill('4');
    await expect(tooltip).toContainText('Net skill level: 17');
    await expect(tooltip).toContainText('Default credit: 12 points');
    await expect(tooltip).toContainText('Base skill level: 15');
    await expect(tooltip.getByRole('link', { name: sourceName, exact: true })).toHaveAttribute(
      'href',
      new RegExp(`#skill-${sourceId}$`),
    );
    await expect(tooltip.getByRole('link', { name: traitName, exact: true })).toHaveCount(2);
    await expect(
      tooltip.getByRole('link', { name: traitName, exact: true }).first(),
    ).toHaveAttribute('href', new RegExp(`#trait-${traitId}$`));
    const savedResponse = await page.request.get(`/api/v1/characters/${characterId}`, { headers });
    expect(
      (await savedResponse.json()).skills.find((skill: { id: string }) => skill.id === targetId)
        .points,
    ).toBe(1);

    const sizes = [
      { width: 320, height: 568 },
      { width: 375, height: 812 },
      { width: 568, height: 320 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 767, height: 800 },
      { width: 768, height: 800 },
      { width: 769, height: 800 },
      { width: 1279, height: 900 },
      { width: 1280, height: 900 },
      { width: 1281, height: 900 },
    ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await input.scrollIntoViewIfNeeded();
      await input.focus();
      await expect(tooltip).toContainText('Net skill level: 17');
      await expect
        .poll(async () => {
          const box = await tooltip.boundingBox();
          return (
            !!box &&
            box.x >= -1 &&
            box.y >= -1 &&
            box.x + box.width <= size.width + 1 &&
            box.y + box.height <= size.height + 1
          );
        })
        .toBe(true);
      const inputBox = await input.boundingBox();
      const popupBox = await tooltip.boundingBox();
      expect(inputBox).not.toBeNull();
      expect(popupBox).not.toBeNull();
      if (inputBox && popupBox) {
        expect(
          popupBox.y + popupBox.height <= inputBox.y + 1 ||
            popupBox.y >= inputBox.y + inputBox.height - 1,
        ).toBe(true);
      }
      const lastSource = tooltip.getByRole('link', { name: traitName, exact: true }).last();
      await lastSource.scrollIntoViewIfNeeded();
      await expect
        .poll(async () =>
          lastSource.evaluate((link) => {
            const rect = link.getBoundingClientRect();
            const hit = document.elementFromPoint(
              rect.left + Math.min(4, rect.width / 2),
              rect.top + rect.height / 2,
            );
            return link.contains(hit);
          }),
        )
        .toBe(true);
      await tooltip.evaluate((element) => {
        element.scrollTop = 0;
      });
      if ([320, 568, 768, 1280].includes(size.width))
        await captureReviewScreenshot(page, {
          path: `test-results/skill-points-${size.width}.png`,
          fullPage: false,
        });
    }
    await input.fill('8');
    await expect(tooltip).toContainText('Net skill level: 18');
    await input.fill('0');
    await expect(tooltip).toContainText('Net skill level: 16');
    await input.fill('');
    await expect(tooltip).toContainText('Enter whole points');
    await input.fill('4');
    await expect(tooltip).toContainText('Net skill level: 17');
    await tooltip.getByRole('link', { name: traitName, exact: true }).last().click();
    await expect(page).toHaveURL(new RegExp(`#trait-${traitId}$`));
    await expect(page.locator(`#trait-${traitId}`)).toBeVisible();
    await selectCharacterSection(page, 'Skills');
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    await input.focus();
    await expect(input).toHaveValue('4');
    await tooltip.getByRole('link', { name: sourceName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#skill-${sourceId}$`));
    await expect(page.locator(`#skill-${sourceId}`)).toBeVisible();
    await input.focus();
    await tooltip.getByRole('link', { name: 'DX', exact: true }).first().click();
    await expect(page).toHaveURL(/#attribute-DX$/);
    await expect(page.locator('#attribute-DX')).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/characters/${characterId}`, { headers });
  }
});
