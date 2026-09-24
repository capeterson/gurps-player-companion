import { expect, test } from '@playwright/test';

const PASSWORD = 'change-me-please-this-is-a-seed-account';

test('skill reference suggestions stay inside the viewport at supported widths', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('seed@example.invalid');
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('link', { name: 'The Lantern Coast' }).first().click();
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByRole('button', { name: /^\+ Add trait$/ }).click();
  await page.getByRole('button', { name: '+ Add effect' }).click();
  await page.getByLabel('Effect 1 target').selectOption('skill');

  const input = page.getByRole('combobox', { name: 'Skill name' });
  await expect(input).toBeVisible();

  for (const width of [320, 767, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 760 : 900 });
    await input.click();
    await input.fill('');
    await input.pressSequentially('s');
    await input.press('ArrowDown');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await expect(listbox.getByText(/Stealth|Swimming/).first()).toBeVisible();
    await expect(listbox.getByText('Armoury', { exact: true })).toHaveCount(0);
    const popup = listbox.locator('xpath=..');
    const box = await popup.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.height).toBeLessThanOrEqual(321);
    }
    expect(await popup.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
      await popup.evaluate((element) => element.clientHeight),
    );
    await page.screenshot({ path: `test-results/skill-reference-${width}.png`, fullPage: false });
    await page.keyboard.press('Escape');
  }

  await input.click();
  await input.fill('');
  await input.pressSequentially('s');
  await input.press('ArrowDown');
  const selected = page
    .getByRole('listbox')
    .getByText(/Stealth|Swimming|Staff|Shield/)
    .first();
  await expect(selected).toBeVisible();
  const selectedLabel = await selected.textContent();
  await selected.click();
  await expect(input).toHaveValue(selectedLabel?.trim() ?? '');
});
