import { randomUUID } from 'node:crypto';
import { expect, test as rawTest } from '@playwright/test';
import { test } from './authenticated-fixture';

test('a signed-out inventory bookmark returns to the revealed row after sign-in', async ({
  page,
  browser,
  workerAccount,
}) => {
  const accessToken = await page.evaluate(() => {
    const stored = localStorage.getItem('gpc.tokenPair.v1');
    if (!stored) throw new Error('Missing synthetic session');
    return (JSON.parse(stored) as { accessToken: string }).accessToken;
  });
  const headers = { authorization: `Bearer ${accessToken}` };
  const created = await page.request.post('/api/v1/characters', {
    headers,
    data: { name: 'Bookmark test' },
  });
  expect(created.ok()).toBeTruthy();
  const character = (await created.json()) as { id: string };
  const added = await page.request.post(`/api/v1/characters/${character.id}/inventory`, {
    headers,
    data: { name: 'Bookmark lantern' },
  });
  expect(added.ok()).toBeTruthy();
  const { item } = (await added.json()) as { item: { id: string } };
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const signedOut = await context.newPage();
    const target = `/characters/${character.id}?section=inventory#inventory-${item.id}`;
    await signedOut.goto(target);
    await expect(signedOut).toHaveURL(/\/login$/);
    await signedOut.getByLabel('Email').fill(workerAccount.email);
    await signedOut.getByLabel('Password').fill(workerAccount.password);
    await signedOut.getByRole('button', { name: /^Sign in$/ }).click();
    await expect(signedOut).toHaveURL(
      new RegExp(`/characters/${character.id}\\?section=inventory#inventory-${item.id}$`),
    );
    await expect(signedOut.locator(`[id="inventory-${item.id}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(signedOut.locator(`[id="inventory-${item.id}"]`)).toContainText(
      'Bookmark lantern',
    );
  } finally {
    await context.close();
  }
});

rawTest('a passkey sign-in returns to an inventory bookmark', async ({ page, context }) => {
  const email = `bookmark-passkey-${randomUUID()}@example.com`;
  const registration = await page.request.post('/api/v1/auth/register', {
    data: { email, password: 'CorrectHorseBatteryStaple1', displayName: 'Passkey bookmark' },
  });
  expect(registration.status()).toBe(201);
  const tokens = (await registration.json()) as {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresIn: number;
  };
  const headers = { authorization: `Bearer ${tokens.accessToken}` };
  const created = await page.request.post('/api/v1/characters', {
    headers,
    data: { name: 'Passkey bookmark' },
  });
  expect(created.ok()).toBeTruthy();
  const character = (await created.json()) as { id: string };
  const added = await page.request.post(`/api/v1/characters/${character.id}/inventory`, {
    headers,
    data: { name: 'Passkey lantern' },
  });
  expect(added.ok()).toBeTruthy();
  const { item } = (await added.json()) as { item: { id: string } };
  const session = await context.newCDPSession(page);
  await session.send('WebAuthn.enable');
  await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  await page.goto('/login');
  await page.evaluate((pair) => localStorage.setItem('gpc.tokenPair.v1', JSON.stringify(pair)), {
    ...tokens,
    sessionId: randomUUID(),
    version: 0,
    refreshRequestId: randomUUID(),
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Add passkey' }).click();
  await expect(page.getByText('Passkey added')).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('gpc.tokenPair.v1'));
  const target = `/characters/${character.id}#inventory-${item.id}`;
  await page.goto(target);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Use a passkey' }).click();
  await expect(page).toHaveURL(new RegExp(`/characters/${character.id}#inventory-${item.id}$`));
  await expect(page.locator(`[id="inventory-${item.id}"]`)).toContainText('Passkey lantern', {
    timeout: 20_000,
  });
  await session.detach();
});
