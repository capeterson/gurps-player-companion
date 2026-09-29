import { type Locator, type Page, expect, test } from '@playwright/test';

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const PASSWORD = 'CorrectHorseBatteryStaple1';

async function register(page: Page, email: string) {
  await page.goto('/register');
  const emailField = page.getByLabel(/email/i);
  await expect(emailField).toBeVisible({ timeout: 15_000 });
  await emailField.fill(email);
  await page.getByLabel(/display name/i).fill('Unsynced logout QA');
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /(create account|sign up|register)/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
}

async function setOnline(page: Page, online: boolean) {
  await page.context().setOffline(!online);
  await page.evaluate(
    (isOnline) => window.dispatchEvent(new Event(isOnline ? 'online' : 'offline')),
    online,
  );
}

async function localSnapshot(page: Page, characterId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('gurps-pc-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const storeNames = Array.from(db.objectStoreNames);
    const transaction = db.transaction(storeNames, 'readonly');
    const readRequest = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const characterRequest = readRequest<{ name?: string } | undefined>(
      transaction.objectStore('characters').get(id),
    );
    const outboxRequest = readRequest<number>(transaction.objectStore('outbox').count());
    const storeCountRequests = storeNames.map(async (name) => {
      const count = await readRequest<number>(transaction.objectStore(name).count());
      return [name, count] as const;
    });
    const [character, outboxCount, storeCounts] = await Promise.all([
      characterRequest,
      outboxRequest,
      Promise.all(storeCountRequests),
    ]);
    db.close();
    return {
      characterName: character?.name ?? null,
      outboxCount,
      storeCounts: Object.fromEntries(storeCounts),
    };
  }, characterId);
}

async function openLogoutDialog(page: Page, width: number) {
  if (width < 1280) {
    const navigation = page.getByRole('navigation', { name: 'Character and app navigation' });
    await navigation.getByLabel(/open navigation/i).click();
    await navigation.getByRole('button', { name: 'Logout', exact: true }).click();
  } else {
    await page.getByLabel('Open user menu').click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
  }
  return page.getByRole('dialog', { name: 'Discard unsaved changes and sign out?' });
}

async function expectOpaqueDialogSurface(dialog: Locator) {
  const surface = dialog.locator('.modal-box');
  await expect(dialog).toHaveCSS('opacity', '1');
  await expect(surface).toHaveCSS('opacity', '1');
  const backgroundAlpha = await surface.evaluate((element) => {
    const backgroundColor = getComputedStyle(element).backgroundColor;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create a canvas to inspect dialog opacity');
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] / 255;
  });
  expect(backgroundAlpha).toBe(1);
}

async function expectDialogInsideViewport(page: Page, width: number, height: number) {
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes and sign out?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/changes that have not been saved to the server/i)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Discard and sign out' })).toBeVisible();
  await expectOpaqueDialogSurface(dialog);
  const visibleBoxes = await Promise.all([
    dialog.locator('.modal-box').boundingBox(),
    dialog.getByRole('button', { name: 'Keep editing' }).boundingBox(),
    dialog.getByRole('button', { name: 'Discard and sign out' }).boundingBox(),
  ]);
  for (const box of visibleBoxes) {
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    }
  }
}

test('logout keeps queued edits on cancel and explicitly discards them on confirmation', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = `logout-unsynced-${suffix()}@example.com`;
  await register(page, email);

  await page.goto('/characters');
  await expect(page.getByRole('heading', { name: /your characters/i })).toBeVisible({
    timeout: 15_000,
  });
  const originalName = `Logout target ${suffix()}`;
  await page.getByLabel(/new character name/i).fill(originalName);
  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page).toHaveURL(/\/characters\/([a-f0-9-]+)$/i, { timeout: 15_000 });
  const characterId = page.url().match(/\/characters\/([a-f0-9-]+)$/i)?.[1];
  if (!characterId) throw new Error('Character creation did not provide an id');
  await expect(page.getByLabel(/all changes saved/i).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });
  // Open the database before taking the page offline, so the native IndexedDB
  // assertions below need no app or module network requests.
  await localSnapshot(page, characterId);
  // Settings is a lazy route chunk. Visit it through SPA navigation so the
  // offline password change cancellation exercises the guard rather than an
  // uncached development chunk.
  await page.getByLabel('Open user menu').click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/characters/${characterId}$`));
  await expect(page.getByRole('textbox', { name: 'character name' }).first()).toBeVisible({
    timeout: 15_000,
  });

  const firstEdit = `${originalName} kept offline`;
  await setOnline(page, false);
  const nameInput = page.getByRole('textbox', { name: /character name/i }).first();
  await nameInput.fill(firstEdit);
  await nameInput.blur();
  await expect(nameInput).toHaveValue(firstEdit);
  await expect
    .poll(async () => (await localSnapshot(page, characterId)).outboxCount)
    .toBeGreaterThan(0);

  // The cancel paths are exercised at narrow widths with the same account and page.
  for (const width of [390, 320]) {
    const height = 844;
    await page.setViewportSize({ width, height });
    const dialog = await openLogoutDialog(page, width);
    await expect(dialog).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`logout-confirm-${width}.png`),
    });
    await expectDialogInsideViewport(page, width, height);
    if (width === 390) {
      await page.keyboard.press('Escape');
    } else {
      await page.getByRole('button', { name: 'Keep editing' }).click();
    }
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(nameInput).toHaveValue(firstEdit);
    await expect
      .poll(async () => (await localSnapshot(page, characterId)).outboxCount)
      .toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('gpc.tokenPair.v1')))
      .not.toBeNull();
  }

  // Password change uses the same guard. A cancel must not issue the password request.
  let passwordRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/auth/password') && request.method() === 'POST') {
      passwordRequests++;
    }
  });
  const mobileNavigation = page.getByRole('navigation', { name: 'Character and app navigation' });
  await mobileNavigation.getByLabel(/open navigation/i).click();
  await mobileNavigation.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill('AnotherCorrectHorseBattery2');
  await page.getByLabel('Confirm new password').fill('AnotherCorrectHorseBattery2');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  const passwordDialog = page.getByRole('dialog', {
    name: 'Discard unsaved changes and change password?',
  });
  await expect(passwordDialog).toBeVisible();
  await expect(
    passwordDialog.getByText('Discard unsaved changes and change password?', { exact: true }),
  ).toBeVisible();
  await expect(passwordDialog.getByRole('button', { name: 'Keep editing' })).toBeVisible();
  await expect(
    passwordDialog.getByRole('button', { name: 'Discard and change password' }),
  ).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('password-confirm-320.png'),
  });
  await expectOpaqueDialogSurface(passwordDialog);
  const passwordDialogBoxes = await Promise.all([
    passwordDialog.locator('.modal-box').boundingBox(),
    passwordDialog.getByRole('button', { name: 'Keep editing' }).boundingBox(),
    passwordDialog.getByRole('button', { name: 'Discard and change password' }).boundingBox(),
  ]);
  for (const box of passwordDialogBoxes) {
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(321);
      expect(box.y + box.height).toBeLessThanOrEqual(845);
    }
  }
  await page.keyboard.press('Escape');
  await expect(passwordDialog).toBeHidden();
  expect(passwordRequests).toBe(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('gpc.tokenPair.v1')))
    .not.toBeNull();
  await expect
    .poll(async () => (await localSnapshot(page, characterId)).outboxCount)
    .toBeGreaterThan(0);

  await setOnline(page, true);
  await expect(page.getByLabel(/all changes saved/i).filter({ visible: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`/characters/${characterId}`);
  await expect(page.getByRole('textbox', { name: 'character name' }).first()).toHaveValue(
    firstEdit,
  );
  const serverAfterReplay = await page.evaluate(async (id) => {
    const pair = JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}') as {
      accessToken?: string;
    };
    const response = await fetch(`/api/v1/characters/${id}`, {
      headers: pair.accessToken ? { authorization: `Bearer ${pair.accessToken}` } : {},
    });
    if (!response.ok) throw new Error(`Character read returned ${response.status}`);
    return ((await response.json()) as { name: string }).name;
  }, characterId);
  expect(serverAfterReplay).toBe(firstEdit);
  await expect.poll(async () => (await localSnapshot(page, characterId)).outboxCount).toBe(0);

  // Queue a second value and inspect the dialog around the desktop navigation
  // breakpoint, reusing this account and page for each width.
  const discardedEdit = `${originalName} discarded offline`;
  await setOnline(page, false);
  const currentNameInput = page.getByRole('textbox', { name: /character name/i }).first();
  await currentNameInput.fill(discardedEdit);
  await currentNameInput.blur();
  await expect(currentNameInput).toHaveValue(discardedEdit);
  await expect
    .poll(async () => (await localSnapshot(page, characterId)).outboxCount)
    .toBeGreaterThan(0);
  for (const width of [1279, 1280, 1281]) {
    const height = 900;
    await page.setViewportSize({ width, height });
    const dialog = await openLogoutDialog(page, width);
    await expect(dialog).toBeVisible();
    await page.screenshot({
      animations: 'disabled',
      path: testInfo.outputPath(`logout-confirm-${width}.png`),
    });
    await expectDialogInsideViewport(page, width, height);
    if (width < 1281) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(currentNameInput).toHaveValue(discardedEdit);
    }
  }
  await page.getByRole('button', { name: 'Discard and sign out' }).click();
  await expect(page).toHaveURL(/\/login(?:\?.*)?$/, { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem('gpc.tokenPair.v1'))).toBeNull();
  const purged = await localSnapshot(page, characterId);
  expect(purged.characterName).toBeNull();
  expect(purged.outboxCount).toBe(0);
  expect(Object.values(purged.storeCounts).every((count) => count === 0)).toBe(true);

  await setOnline(page, true);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password\b/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 15_000 });
  await page.goto(`/characters/${characterId}`);
  await expect(page.getByRole('textbox', { name: 'character name' }).first()).toHaveValue(
    firstEdit,
    { timeout: 15_000 },
  );
  expect(
    await page.evaluate(async (id) => {
      const pair = JSON.parse(localStorage.getItem('gpc.tokenPair.v1') ?? '{}') as {
        accessToken?: string;
      };
      const response = await fetch(`/api/v1/characters/${id}`, {
        headers: pair.accessToken ? { authorization: `Bearer ${pair.accessToken}` } : {},
      });
      return response.ok ? ((await response.json()) as { name: string }).name : null;
    }, characterId),
  ).toBe(firstEdit);
});
