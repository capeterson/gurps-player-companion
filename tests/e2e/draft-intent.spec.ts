import { type Locator, type Page, expect } from '@playwright/test';
import { test } from './authenticated-fixture';
import { selectCharacterSection } from './character-navigation';

type Operation = {
  clientOpId: string;
  entityClass: string;
  entityId: string;
  parentId?: string;
  fieldPath?: string;
  attemptedValue?: unknown;
};
type Outcome = { clientOpId: string; status: string; reason?: string };
type Detail = {
  id: string;
  name: string;
  traits: Array<{ id: string; name: string }>;
  height: string | null;
};

async function token(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('gpc.tokenPair.v1');
    if (!raw) throw new Error('Missing synthetic session');
    return (JSON.parse(raw) as { accessToken: string }).accessToken;
  });
}

async function request(page: Page, method: 'GET' | 'POST' | 'PATCH', path: string, data?: object) {
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    data,
    headers: { authorization: `Bearer ${await token(page)}` },
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function createCharacter(page: Page): Promise<Detail> {
  return request(page, 'POST', '/characters', { name: 'Draft A' }) as Promise<Detail>;
}

async function openName(page: Page, id: string): Promise<Locator> {
  await page.goto(`/characters/${id}`);
  await selectCharacterSection(page, 'Overview');
  const input = page
    .getByRole('textbox', { name: 'character name' })
    .filter({ visible: true })
    .first();
  await expect(input).toBeVisible();
  return input;
}

/** Hold one matching real request, then deliver its unmodified server response. */
async function holdOperation(page: Page, entityClass: string, entityId: string, value: string) {
  let release!: () => void;
  let started!: (operation: Operation) => void;
  let finished!: (outcome: Outcome) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatched = new Promise<Operation>((resolve) => {
    started = resolve;
  });
  const result = new Promise<Outcome>((resolve) => {
    finished = resolve;
  });
  await page.route('**/api/v1/sync/operations', async (route) => {
    const body = route.request().postDataJSON() as { operations: Operation[] };
    const operation = body.operations.find(
      (op) =>
        op.entityClass === entityClass &&
        op.entityId === entityId &&
        op.fieldPath === 'name' &&
        op.attemptedValue === value,
    );
    if (!operation) return route.continue();
    started(operation);
    await gate;
    const response = await route.fetch();
    const data = (await response.json()) as { outcomes: Outcome[] };
    const outcome = data.outcomes.find((entry) => entry.clientOpId === operation.clientOpId);
    if (!outcome) throw new Error('Server omitted held operation outcome');
    await route.fulfill({ response });
    finished(outcome);
  });
  return { dispatched, result, release };
}

async function expectDurable(
  page: Page,
  id: string,
  select: (detail: Detail) => string | undefined,
  expected: string,
) {
  await expect
    .poll(async () => select((await request(page, 'GET', `/characters/${id}`)) as Detail), {
      timeout: 20_000,
    })
    .toBe(expected);
}

for (const kind of ['character', 'trait'] as const) {
  test(`retains newer unblurred ${kind} name across a real server rejection`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const character = await createCharacter(page);
    let entityId = character.id;
    if (kind === 'trait') {
      const created = (await request(page, 'POST', `/characters/${character.id}/traits`, {
        kind: 'perk',
        name: 'Trait A',
        points: 1,
        notes: '',
        modifiers: [],
        customEffects: [],
      })) as { trait: { id: string } };
      entityId = created.trait.id;
    }
    const characterName = await openName(page, character.id);
    let input = characterName;
    if (kind === 'trait') {
      await selectCharacterSection(page, 'Traits');
      await page.getByRole('button', { name: 'View Trait A' }).click();
      await page.getByRole('button', { name: 'Edit Trait A' }).click();
      input = page.locator('input[aria-label$=" name"]').filter({ visible: true }).last();
    }
    const tooLong = 'X'.repeat(250);
    const newer = kind === 'trait' ? 'Retained trait' : 'Retained character';
    const held = await holdOperation(
      page,
      kind === 'trait' ? 'character_trait' : 'character',
      entityId,
      tooLong,
    );
    await input.fill(tooLong);
    await input.press('Tab');
    const sent = await held.dispatched;
    expect(sent.attemptedValue).toBe(tooLong);
    if (kind === 'trait') expect(sent.parentId).toBe(character.id);
    await input.fill(newer);
    await expect(input).toBeFocused();
    held.release();
    const outcome = await held.result;
    expect(outcome.status).toBe('rejected');
    expect(outcome.reason).toBeTruthy();
    await expect(input).toHaveValue(newer);
    await expect(input).toHaveAttribute('data-flashing', 'true');
    await expect(input).toHaveCSS('animation-name', /field-rollback-flash-[ab]/);
    const toast = page.getByText(
      `Couldn't sync ${kind === 'trait' ? 'Trait A name' : 'name'} — ${outcome.reason}`,
      { exact: true },
    );
    await expect(toast).toBeVisible();
    const applied = watchApplied(
      page,
      kind === 'trait' ? 'character_trait' : 'character',
      entityId,
      newer,
    );
    await input.press('Tab');
    await applied;
    const select =
      kind === 'trait'
        ? (detail: Detail) => detail.traits.find((trait) => trait.id === entityId)?.name
        : (detail: Detail) => detail.name;
    await expectDurable(page, character.id, select, newer);
    await expect(toast).toBeVisible();
    await page.reload();
    if (kind === 'character') {
      await selectCharacterSection(page, 'Overview');
      await expect(
        page.getByRole('textbox', { name: 'character name' }).filter({ visible: true }).first(),
      ).toHaveValue(newer);
    } else {
      await selectCharacterSection(page, 'Traits');
      await expect(page.getByRole('button', { name: `View ${newer}` })).toBeVisible();
    }
    await expect(toast).toBeVisible({ timeout: 20_000 });
  });
}

function watchApplied(
  page: Page,
  entityClass: string,
  entityId: string,
  value: unknown,
  field = 'name',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      page.off('response', listener);
      reject(new Error(`No applied sync outcome for ${value}`));
    }, 20_000);
    const listener = async (response: import('@playwright/test').Response) => {
      if (!response.url().endsWith('/api/v1/sync/operations')) return;
      const body = response.request().postDataJSON() as { operations: Operation[] };
      const op = body.operations.find(
        (item) =>
          item.entityClass === entityClass &&
          item.entityId === entityId &&
          item.fieldPath === field &&
          item.attemptedValue === value,
      );
      if (!op) return;
      const data = (await response.json()) as { outcomes: Outcome[] };
      const outcome = data.outcomes.find((entry) => entry.clientOpId === op.clientOpId);
      if (outcome?.status !== 'applied') return;
      clearTimeout(timeout);
      page.off('response', listener);
      resolve();
    };
    page.on('response', listener);
  });
}

async function localCharacterName(page: Page, id: string): Promise<string | null> {
  return page.evaluate(async (characterId) => {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === 'gurps-pc-local'))
      throw new Error('Expected the existing local database');
    return new Promise<string | null>((resolve, reject) => {
      const open = indexedDB.open('gurps-pc-local');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db
          .transaction('characters', 'readonly')
          .objectStore('characters')
          .get(characterId);
        read.onerror = () => {
          db.close();
          reject(read.error);
        };
        read.onsuccess = () => {
          const name = (read.result as { name?: string } | undefined)?.name ?? null;
          db.close();
          resolve(name);
        };
      };
    });
  }, id);
}

test('a deliberate return to A after remote C is written while B remains unblurred', async ({
  page,
}) => {
  const character = await createCharacter(page);
  const input = await openName(page, character.id);
  await expect(input).toHaveValue('Draft A');
  await input.fill('Unblurred B');
  const cursor = page.waitForResponse(
    async (response) => {
      if (!response.url().endsWith('/api/v1/sync/cursor') || !response.ok()) return false;
      const body = (await response.json()) as {
        changes: Array<{ entityClass: string; entityId: string; data?: { name?: string } }>;
      };
      return body.changes.some(
        (change) =>
          change.entityClass === 'character' &&
          change.entityId === character.id &&
          change.data?.name === 'Remote C',
      );
    },
    { timeout: 40_000 },
  );
  await request(page, 'PATCH', `/characters/${character.id}`, { name: 'Remote C' });
  await cursor;
  await expect
    .poll(() => localCharacterName(page, character.id), { timeout: 20_000 })
    .toBe('Remote C');
  await expect(input).toHaveValue('Unblurred B');
  const applied = watchApplied(page, 'character', character.id, 'Draft A');
  await input.fill('Draft A');
  await input.press('Tab');
  await applied;
  await expectDurable(page, character.id, (detail) => detail.name, 'Draft A');
  await page.reload();
  await selectCharacterSection(page, 'Overview');
  await expect(
    page.getByRole('textbox', { name: 'character name' }).filter({ visible: true }).first(),
  ).toHaveValue('Draft A');
});

test('a queued name and independent nullable field survive a delayed save', async ({ page }) => {
  const character = await createCharacter(page);
  const name = await openName(page, character.id);
  const height = page.getByRole('textbox', { name: 'height', exact: true });
  const held = await holdOperation(page, 'character', character.id, 'First name');
  await name.fill('First name');
  await name.press('Tab');
  await held.dispatched;
  await name.fill('Later name');
  await name.press('Tab');
  await height.fill('180 cm');
  await height.press('Tab');
  await expect(name).toHaveValue('Later name');
  await expect(height).toHaveValue('180 cm');
  const nameApplied = watchApplied(page, 'character', character.id, 'Later name');
  const heightApplied = watchApplied(page, 'character', character.id, '180 cm', 'height');
  held.release();
  expect((await held.result).status).toBe('applied');
  await Promise.all([nameApplied, heightApplied]);
  await expectDurable(page, character.id, (detail) => detail.name, 'Later name');
  await expectDurable(page, character.id, (detail) => detail.height ?? undefined, '180 cm');
  const clearApplied = watchApplied(page, 'character', character.id, null, 'height');
  await height.fill('');
  await height.press('Tab');
  await clearApplied;
  await expect
    .poll(
      async () => ((await request(page, 'GET', `/characters/${character.id}`)) as Detail).height,
    )
    .toBeNull();
  await page.reload();
  await selectCharacterSection(page, 'Overview');
  await expect(page.getByRole('textbox', { name: 'height', exact: true })).toHaveValue('');
});

test('a prompt server rejection visibly rolls an unchanged draft back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const character = await createCharacter(page);
  const input = await openName(page, character.id);
  const tooLong = 'Y'.repeat(250);
  const responsePromise = page.waitForResponse((response) => {
    if (!response.url().endsWith('/api/v1/sync/operations')) return false;
    const body = response.request().postDataJSON() as { operations: Operation[] };
    return body.operations.some(
      (op) =>
        op.entityClass === 'character' &&
        op.entityId === character.id &&
        op.fieldPath === 'name' &&
        op.attemptedValue === tooLong,
    );
  });
  await input.fill(tooLong);
  await input.press('Tab');
  const response = await responsePromise;
  const sent = response.request().postDataJSON() as { operations: Operation[] };
  const op = sent.operations.find(
    (item) => item.entityId === character.id && item.attemptedValue === tooLong,
  );
  if (!op) throw new Error('Missing rejected name operation');
  const body = (await response.json()) as { outcomes: Outcome[] };
  const outcome = body.outcomes.find((entry) => entry.clientOpId === op.clientOpId);
  expect(outcome?.status).toBe('rejected');
  expect(outcome?.reason).toBeTruthy();
  await expect(input).toHaveValue('Draft A');
  await expect(input).toHaveAttribute('data-flashing', 'true');
  await expect(input).toHaveCSS('animation-name', /field-rollback-flash-[ab]/);
  await expect(
    page.getByText(`Couldn't sync name — ${outcome?.reason}`, { exact: true }),
  ).toBeVisible();
  await expectDurable(page, character.id, (detail) => detail.name, 'Draft A');
});
