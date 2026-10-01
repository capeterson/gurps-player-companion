import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type {} from '../fixtures/mcp-app-host.ts';
import {
  bladeId,
  bladeName,
  mcpCharacter,
  mcpInventoryItem,
  mcpLibrarySkill,
  mcpMinimalCharacter,
} from '../fixtures/mcp-character.ts';

let hostScript: string;
let html: string;
let temporary: string;
test.beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), 'gpc-mcp-app-host-'));
  const output = join(temporary, 'host.js');
  execFileSync('bun', [
    'build',
    'tests/fixtures/mcp-app-host.ts',
    '--target',
    'browser',
    '--outfile',
    output,
  ]);
  hostScript = readFileSync(output, 'utf8');
  html = readFileSync('dist/mcp-ui/character.html', 'utf8');
});
test.afterAll(() => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});

test('MCP Apps bridge renders shared sheet details in an opaque sandbox, with bounded overlays', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const network: string[] = [];
  page.on('request', (request) => network.push(request.url()));
  await page.setContent(
    '<iframe id="app" title="Character details" sandbox="allow-scripts" style="width:100%;height:900px;border:0"></iframe><style>body{margin:0}</style>',
  );
  await page.addScriptTag({ content: hostScript });
  const fixture = mcpCharacter();
  await page.evaluate(
    ({ html, fixture }) =>
      window.mcpTestHost.mount(html, {
        content: [{ type: 'text', text: 'HTTP 200' }],
        structuredContent: { status: 200, body: fixture },
      }),
    { html, fixture },
  );
  const app = page.frameLocator('#app');
  await expect(app.getByRole('heading', { name: fixture.name })).toBeVisible();
  await expect(app.getByRole('heading', { name: 'Attributes', exact: true })).toBeVisible();
  await expect(
    app.getByText('ST', { exact: true }).locator('..').getByText('15', { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.mcpTestHost.theme('light'));
  await expect(app.locator('html')).toHaveAttribute('data-theme', 'illuminated-manuscript');

  for (const width of [320, 639, 640, 641, 767, 768, 769]) {
    await page.setViewportSize({ width, height: 1000 });
    await app.getByRole('button', { name: 'Skills', exact: true }).click();
    await expect(app.getByText('Broadsword', { exact: true })).toBeVisible();
    await app.getByRole('button', { name: 'View Broadsword' }).click();
    await expect(app.getByText('blade', { selector: 'strong' })).toBeVisible();
    await app.getByRole('button', { name: 'Close Broadsword' }).click();
    await expect(app.getByRole('button', { name: '+ Add skill' })).toHaveCount(0);
    await app.getByRole('button', { name: /Sort by Skill/ }).click({ button: 'right' });
    const menu = app.getByRole('dialog', { name: 'Filter Skill' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900 + 1);
    }
    await page.screenshot({ path: test.info().outputPath(`mcp-ui-${width}.png`) });
    await menu.press('Escape');
    await expect(menu).toBeHidden();
    await app.getByRole('button', { name: 'Inventory', exact: true }).click();
    const expand = app.getByRole('button', { name: 'Expand contents' });
    if (await expand.count()) await expand.click();
    await expect(app.getByText(bladeName, { exact: true })).toBeVisible();
    const details = app.getByRole('button', { name: `View ${bladeName}` });
    if ((await details.getAttribute('aria-expanded')) === 'false') await details.click();
    await expect(app.getByText('balanced', { selector: 'strong' })).toBeVisible();
    await expect(app.getByText(/Damage sw\+1 cut/)).toBeVisible();
    await expect(app.getByRole('button', { name: `Edit ${bladeName}` })).toHaveCount(0);
    expect(await app.locator('html').evaluate((root) => root.scrollWidth <= root.clientWidth)).toBe(
      true,
    );
  }
  await app.getByRole('button', { name: 'Magic', exact: true }).click();
  await expect(app.getByText('No spells learned yet.')).toBeVisible();
  await app.getByRole('button', { name: 'Traits', exact: true }).click();
  await expect(app.getByText('Combat Reflexes', { exact: true })).toBeVisible();
  await app.getByRole('button', { name: 'View Combat Reflexes' }).click();
  await expect(app.getByText('alert', { selector: 'strong' })).toBeVisible();
  await expect(app.getByRole('button', { name: '+ Add trait' })).toHaveCount(0);
  await page.evaluate(() => {
    window.mcpTestHost.nextResult = {
      content: [{ type: 'text', text: 'Forbidden' }],
      isError: true,
      structuredContent: { status: 403, body: { error: 'forbidden' } },
    };
  });
  await app.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(app.getByRole('alert')).toContainText('Character details are unavailable');
  await expect(app.getByRole('heading', { name: fixture.name })).toHaveCount(0);
  const minimal = mcpMinimalCharacter();
  await page.evaluate((minimal) => {
    window.mcpTestHost.nextResult = {
      content: [],
      structuredContent: { status: 200, body: minimal },
    };
  }, minimal);
  await app.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(app.getByText(/Limited view/)).toBeVisible();
  await expect(app.getByText('Public description')).toBeVisible();
  await expect(app.getByRole('button', { name: 'Skills', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.mcpTestHost.calls.map(({ name, arguments: args }) => ({ name, arguments: args })),
    ),
  ).toEqual([
    { name: 'get_character', arguments: { path: { id: fixture.id } } },
    { name: 'get_character', arguments: { path: { id: fixture.id } } },
  ]);
  expect(network).toEqual([]);
  expect(errors).toEqual([]);
});

for (const kind of ['item', 'container', 'library skill'] as const) {
  test(`focused ${kind} card renders only the requested subject and refreshes the same tool`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const data =
      kind === 'library skill'
        ? mcpLibrarySkill()
        : mcpInventoryItem(kind === 'item' ? bladeId : undefined);
    const call =
      data.kind === 'library_skill'
        ? {
            name: 'get_campaign_library_skill',
            arguments: { path: { id: data.skill.campaignId, skillId: data.skill.id } },
          }
        : {
            name: 'get_character_inventory_item',
            arguments: { path: { id: data.characterId, itemId: data.item.id } },
          };
    const title = data.kind === 'library_skill' ? data.skill.name : data.item.name;
    await page.setContent(
      '<iframe id="app" sandbox="allow-scripts" style="display:block;width:100%;height:1200px;border:0"></iframe><style>body{margin:0}</style>',
    );
    await page.addScriptTag({ content: hostScript });
    await page.evaluate(
      ({ html, data, args }) =>
        window.mcpTestHost.mount(
          html,
          { content: [], structuredContent: { status: 200, body: data } },
          args,
        ),
      { html, data, args: call.arguments },
    );
    const app = page.frameLocator('#app');
    await page.evaluate(() => window.mcpTestHost.theme('light'));
    for (const width of [320, 639, 640, 641, 767, 768, 769]) {
      await page.setViewportSize({ width, height: 1200 });
      await expect(app.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(app.getByRole('navigation')).toHaveCount(0);
      await expect(app.getByRole('button', { name: 'Overview', exact: true })).toHaveCount(0);
      await expect(app.getByRole('heading', { name: 'Attributes', exact: true })).toHaveCount(0);
      if (kind === 'container') {
        await expect(app.getByRole('heading', { name: 'Contents' })).toBeVisible();
        await expect(app.getByText(bladeName, { exact: true })).toBeVisible();
        const button = app.getByRole('button', { name: `View ${bladeName}` });
        if ((await button.getAttribute('aria-expanded')) === 'false') await button.click();
        await expect(app.getByText('balanced', { selector: 'strong' })).toBeVisible();
      } else if (kind === 'item') {
        await expect(app.getByText('balanced', { selector: 'strong' })).toBeVisible();
        await expect(app.getByText(/Damage sw\+1 cut/)).toBeVisible();
        await expect(app.getByText('Travelling pack')).toHaveCount(0);
      } else {
        await expect(app.getByText('Campaign library skill')).toBeVisible();
        await expect(app.getByText('balanced sword', { selector: 'strong' })).toBeVisible();
        await expect(app.getByText('Source · Synthetic Core p. 12')).toBeVisible();
        await expect(app.getByText('Prerequisites · A suitable weapon.')).toBeVisible();
      }
      expect(
        await app.locator('html').evaluate((root) => root.scrollWidth <= root.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`focused-${kind.replaceAll(' ', '-')}-${width}.png`),
      });
    }
    await app.locator('main').screenshot({
      path: test.info().outputPath(`focused-${kind.replaceAll(' ', '-')}-card.png`),
    });
    await app.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(app.getByRole('heading', { name: title, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() =>
        window.mcpTestHost.calls.map(({ name, arguments: args }) => ({ name, arguments: args })),
      ),
    ).toEqual([call]);
    await page.evaluate(() => {
      window.mcpTestHost.nextResult = {
        content: [],
        isError: true,
        structuredContent: { status: 403, body: { error: 'forbidden' } },
      };
    });
    await app.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(app.getByRole('alert')).toContainText('Details are unavailable');
    await expect(app.getByRole('heading', { name: title, exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
