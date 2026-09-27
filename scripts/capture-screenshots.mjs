/** Real application screenshots shared by README and the public landing page.
 * Start and seed an isolated local dev stack first; never use production data.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
  throw new Error('Screenshot capture requires a local seeded development server.');
}
const output = resolve('public/screenshots');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({
  baseURL,
  viewport: { width: 1440, height: 3000 },
  deviceScaleFactor: 1,
});
page.setDefaultTimeout(20_000);
try {
  await page.addInitScript(() => localStorage.setItem('gpc.theme', 'dark'));
  await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByLabel(/email/i).fill('rowan@example.invalid');
  await page
    .getByLabel(/password/i)
    .fill(process.env.SCREENSHOT_SEED_PASSWORD ?? 'change-me-please-this-is-a-seed-account');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/');
  console.log('Signed in to local demo');
  await page.goto('/characters');
  await page
    .getByRole('link', { name: /Kestrel Vale/ })
    .first()
    .click();
  await section('Combat');
  await page.getByText("Wayfarer's sword", { exact: true }).waitFor();
  await page
    .getByRole('region', { name: 'Incoming attack' })
    .getByLabel(/^Damage type/)
    .selectOption('cut');
  await ready();
  const armor = page.getByRole('region', { name: 'Incoming attack' }).locator('../..');
  await armor.scrollIntoViewIfNeeded();
  await armor.screenshot({ path: resolve(output, 'armor-desktop.png'), animations: 'disabled' });
  console.log('Armor captured');
  await page.setViewportSize({ width: 430, height: 932 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await ready();
  await page.screenshot({ path: resolve(output, 'combat-mobile.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /Incoming damage…/ }).click();
  const damage = page.getByRole('dialog', { name: 'Incoming damage' });
  await damage.getByLabel('Basic damage').fill('10');
  await ready();
  await page.screenshot({ path: resolve(output, 'damage-mobile.png'), animations: 'disabled' });
  await damage.getByRole('button', { name: 'Cancel' }).click();
  console.log('Mobile captures saved; damage not applied');
  await page.setViewportSize({ width: 1440, height: 2200 });
  await section('Inventory');
  await page.getByRole('button', { name: 'Switch to Light mode', exact: true }).click();
  await page.getByText('Trail pack', { exact: true }).waitFor();
  const expand = page.getByRole('button', { name: 'Expand contents', exact: true });
  while (await expand.count()) await expand.first().click();
  await ready();
  const inventory = page
    .getByRole('heading', { name: 'Inventory', exact: true })
    .last()
    .locator('..');
  await inventory.scrollIntoViewIfNeeded();
  await inventory.screenshot({
    path: resolve(output, 'inventory-desktop.png'),
    animations: 'disabled',
  });
  console.log('Inventory captured');
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.goto('/campaigns');
  await page
    .getByRole('link', { name: /The Lantern Coast/ })
    .first()
    .click();
  await page.getByRole('heading', { name: 'Characters', exact: true }).waitFor();
  await page.getByText('Bram Stonebridge', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Switch to Light mode', exact: true }).click();
  await ready();
  await page.screenshot({ path: resolve(output, 'campaign-desktop.png'), animations: 'disabled' });
  for (const file of [
    'armor-desktop',
    'combat-mobile',
    'damage-mobile',
    'inventory-desktop',
    'campaign-desktop',
  ]) {
    const bytes = await readFile(resolve(output, `${file}.png`));
    console.log(`${file}.png: ${bytes.readUInt32BE(16)} × ${bytes.readUInt32BE(20)}`);
  }
} finally {
  await browser.close();
}
async function ready() {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}
async function section(name) {
  const dock = page.locator('.sheet-dock');
  await dock.getByRole('button', { name, exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).first().waitFor();
}
