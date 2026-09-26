/**
 * The campaign library at realistic scale: hundreds of skills and spells
 * across many colleges must stay navigable (groups, jump strip, sorting,
 * deep links, sticky toolbar), render Markdown only for opened entries, and
 * keep working offline because the library is sync-backed.
 *
 * One account and page are reused for every width (rate-limited sign-up).
 */
import { type Page, expect, test } from '@playwright/test';

const COLLEGES = Array.from(
  { length: 20 },
  (_, index) => `College ${String(index).padStart(2, '0')}`,
);
const WIDTHS = [390, 639, 640, 641, 1280];

async function register(page: Page) {
  await page.goto('/register');
  await page
    .getByLabel(/email/i)
    .fill(`library-scale-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByLabel(/display name/i).fill('Library GM');
  await page.getByLabel(/^password\b/i).fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/(\/|\/characters)$/, { timeout: 15_000 });
}

async function token(page: Page): Promise<string> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}').accessToken as string,
  );
}

async function request(page: Page, method: 'GET' | 'POST', path: string, data?: object) {
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    ...(data ? { data } : {}),
    headers: { Authorization: `Bearer ${await token(page)}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function seedLargeLibrary(page: Page): Promise<string> {
  const campaign = await request(page, 'POST', '/campaigns', { name: 'Scale campaign' });
  const skills = Array.from({ length: 300 }, (_, index) => ({
    name: `Skill ${String(index).padStart(3, '0')}`,
    attribute: ['ST', 'DX', 'IQ', 'HT', 'Will', 'Per'][index % 6],
    difficulty: ['E', 'A', 'H', 'VH'][index % 4],
    description: `Practised **technique** number ${index} with a long explanatory paragraph that should stay on one line when collapsed.`,
  }));
  const spells = Array.from({ length: 300 }, (_, index) => ({
    name: `Spell ${String(index).padStart(3, '0')}`,
    college: COLLEGES[index % COLLEGES.length],
    difficulty: index % 2 ? 'VH' : 'H',
    baseEnergyCost: (index % 9) + 1,
    description: `Casts **effect ${index}** at range.`,
  }));
  // JSON is valid YAML, and one import keeps seeding to a single request.
  const yaml = JSON.stringify({ version: 11, library: { traits: [], skills, items: [], spells } });
  await request(page, 'POST', `/campaigns/${campaign.id}/library/import`, { yaml, mode: 'merge' });
  return campaign.id as string;
}

async function expectNoPageOverflow(page: Page, width: number) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width);
}

test('navigates a large library at every breakpoint and edits it offline', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await register(page);
  const campaignId = await seedLargeLibrary(page);
  const library = (await request(page, 'GET', `/campaigns/${campaignId}/library`)) as {
    spells: { id: string; name: string }[];
    skills: { id: string; name: string }[];
  };
  const target = library.spells.find((spell) => spell.name === 'Spell 257');
  if (!target) throw new Error('seeded spell missing');

  await page.goto(`/campaigns/${campaignId}/library?section=spells`);
  await expect(page.getByRole('status')).toHaveText(/300 of 300 spells/, { timeout: 30_000 });

  for (const width of WIDTHS) {
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const table = page.getByRole('table', { name: 'spells' });
      const strip = page.getByRole('navigation', { name: 'Jump to spell group' });

      // One heading and one jump link per college, with its count.
      await expect(table.getByRole('button', { name: /^College \d\d 15$/ })).toHaveCount(20);
      await expect(strip.getByRole('button')).toHaveCount(20);
      await expect(strip.getByRole('button', { name: 'College 19 15' })).toBeAttached();

      // The strip scrolls inside itself; it never widens the page.
      const stripBox = await strip.boundingBox();
      expect(stripBox?.x).toBeGreaterThanOrEqual(0);
      expect((stripBox?.x ?? 0) + (stripBox?.width ?? 0)).toBeLessThanOrEqual(width);
      await expectNoPageOverflow(page, width);

      // Jumping lands the college heading just below the sticky toolbar.
      await strip.getByRole('button', { name: 'College 19 15' }).click();
      const heading = page.locator('#library-group-spells-college-19');
      await expect(heading).toBeInViewport();
      const toolbar = page.locator('.library-toolbar');
      const [toolbarBox, headingBox] = await Promise.all([
        toolbar.boundingBox(),
        heading.boundingBox(),
      ]);
      // The toolbar stayed pinned while the page scrolled.
      expect(toolbarBox?.y).toBeGreaterThanOrEqual(0);
      expect(toolbarBox?.y).toBeLessThan(200);
      expect(headingBox?.y).toBeGreaterThanOrEqual(
        (toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0) - 1,
      );
      await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeInViewport();

      // Rows fit: name cell, cost and actions never overlap.
      const row = page.getByRole('button', { name: 'Spell 019', exact: true });
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      const editBox = await page.getByRole('button', { name: 'Edit Spell 019' }).boundingBox();
      expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0)).toBeLessThanOrEqual(editBox?.x ?? 0);
      expect((editBox?.x ?? 0) + (editBox?.width ?? 0)).toBeLessThanOrEqual(width);
    });
  }

  await test.step('sorting by cost reorders spells within each college', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const firstGroupRows = page
      .locator('#library-group-spells-college-00')
      .locator('xpath=ancestor::tbody/following-sibling::tbody[1]')
      .getByRole('button', { expanded: false })
      .first();
    await expect(firstGroupRows).toHaveText('Spell 000');
    await page.getByRole('button', { name: 'Sort by Cost' }).click();
    await page.getByRole('button', { name: 'Sort by Cost' }).click();
    // College 00 holds spells 0, 20, 40…; cost 9 is the first with index % 9 = 8.
    await expect(firstGroupRows).toHaveText('Spell 080');
    await expect(page.getByRole('columnheader', { name: /Cost/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  await test.step('opening an entry renders its Markdown; a deep link reopens it', async () => {
    await page.goto(`/campaigns/${campaignId}/library?section=spells&open=${target.id}`);
    const row = page.getByRole('button', { name: 'Spell 257', exact: true });
    await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });
    await expect(row).toBeInViewport();
    await expect(page.locator('.markdown-body strong')).toHaveText('effect 257');
    // Only the opened entry mounted a Markdown renderer.
    await expect(page.locator('.markdown-body')).toHaveCount(1);
  });

  await test.step('an offline edit is kept locally and syncs after reconnecting', async () => {
    await page.goto(`/campaigns/${campaignId}/library?section=skills&q=Skill+042`);
    await expect(page.getByRole('status')).toHaveText(/1 of 300 skills match/, {
      timeout: 30_000,
    });
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.getByRole('button', { name: 'Edit Skill 042' }).click();
    await page.getByRole('button', { name: 'Edit raw markdown' }).click();
    await page
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('Edited **offline**');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Edited offline', { exact: true })).toBeVisible();

    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const skillId = library.skills.find((entry) => entry.name === 'Skill 042')?.id;
    await expect
      .poll(
        async () => {
          const current = (await request(page, 'GET', `/campaigns/${campaignId}/library`)) as {
            skills: { id: string; description: string | null }[];
          };
          return current.skills.find((entry) => entry.id === skillId)?.description;
        },
        { timeout: 30_000 },
      )
      .toBe('Edited **offline**');
  });
});
