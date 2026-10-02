import { afterEach, expect, it, vi } from 'vitest';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { tokenStore } from '../lib/tokenStore.ts';
import { journalCampaignMutation } from './onlineMutationLog.ts';
import { lastChangesSyncKey, redactSyncLogForCampaigns } from './syncLog.ts';
import { loadSyncLogEntry } from './syncLogPayload.ts';

afterEach(async () => {
  tokenStore.clear();
  vi.restoreAllMocks();
  await resetLocalDb();
});

const before = {
  id: 'campaign',
  name: 'Lantern Coast',
  revision: 41,
  skillPrerequisitePolicy: 'block',
  houseRules: { ruleSet: 'custom', forbidAcidMagic: false },
};
const body = { skillPrerequisitePolicy: 'warn', houseRules: before.houseRules };
const mutation = {
  entityId: 'campaign',
  command: 'patch',
  method: 'PATCH',
  path: '/campaigns/campaign',
  body,
  before,
  source: 'Campaign settings',
  humanName: 'campaign rules updated',
} as const;

it('records a settings upload with the actual request and only the changed settings', async () => {
  const response = { ...before, ...body, revision: 42, members: [] };
  expect(await journalCampaignMutation(mutation, async () => response)).toBe(response);
  const stored = (await getLocalDb().syncLog.toArray())[0];
  if (!stored) throw new Error('Expected campaign sync log');
  const entry = await loadSyncLogEntry(stored);
  expect(entry).toMatchObject({
    direction: 'push',
    result: 'synced',
    entityName: 'Lantern Coast',
    previousValue: { skillPrerequisitePolicy: 'block' },
    newValue: { skillPrerequisitePolicy: 'warn' },
    request: { method: 'PATCH', path: '/api/v1/campaigns/campaign', body },
    details: { newRevision: 42, response },
  });
  expect((await getLocalDb().syncMeta.get(lastChangesSyncKey()))?.value).toBe(entry.occurredAt);
});

it('records failed saves without claiming a successful operation', async () => {
  await expect(
    journalCampaignMutation(mutation, async () => {
      throw new Error('Network unavailable');
    }),
  ).rejects.toThrow('Network unavailable');
  const entry = (await getLocalDb().syncLog.toArray())[0];
  expect(entry).toMatchObject({
    direction: 'push',
    result: 'failed',
    reason: 'Network unavailable',
    request: { body },
  });
  expect(await getLocalDb().syncMeta.get(lastChangesSyncKey())).toBeUndefined();
});

it('does not journal a delayed response after the login session changes', async () => {
  tokenStore.write({ accessToken: 'first', refreshToken: 'r1', accessTokenExpiresIn: 60 });
  let finish!: (value: typeof before) => void;
  const pending = journalCampaignMutation(
    mutation,
    () =>
      new Promise<typeof before>((resolve) => {
        finish = resolve;
      }),
  );
  tokenStore.clear();
  tokenStore.write({ accessToken: 'second', refreshToken: 'r2', accessTokenExpiresIn: 60 });
  finish(before);
  await pending;
  expect(await getLocalDb().syncLog.count()).toBe(0);
});

it('removes recorded request and subject name when campaign access is revoked', async () => {
  await journalCampaignMutation(mutation, async () => ({ ...before, ...body, revision: 42 }));
  await redactSyncLogForCampaigns(['campaign']);
  const entry = (await getLocalDb().syncLog.toArray())[0];
  expect(entry?.redacted).toBe(true);
  expect(entry?.request).toBeUndefined();
  expect(entry?.entityName).toBeUndefined();
  expect(entry?.humanName).toBeUndefined();
});

it('bounds large import requests and retains aggregate response without inventing row diffs', async () => {
  await journalCampaignMutation(
    { ...mutation, source: 'Library import', body: { yaml: 'a'.repeat(20_000), mode: 'merge' } },
    async () => ({ spells: 25 }),
  );
  const stored = (await getLocalDb().syncLog.toArray())[0];
  if (!stored) throw new Error('Expected campaign sync log');
  const entry = await loadSyncLogEntry(stored);
  expect(entry.newValue).toBeUndefined();
  expect(entry.previousValue).toBeUndefined();
  expect(entry.request).toMatchObject({ body: { truncated: true, length: expect.any(Number) } });
  expect(entry.details).toMatchObject({ response: { spells: 25 } });
});

it('records campaign deletion as a removed row with its response kept separately', async () => {
  await journalCampaignMutation(
    {
      ...mutation,
      command: 'delete',
      method: 'DELETE',
      body: undefined,
      source: 'Campaign deletion',
      humanName: 'campaign deleted',
    },
    async () => ({ ok: true }),
  );
  const stored = (await getLocalDb().syncLog.toArray())[0];
  if (!stored) throw new Error('Expected deletion log');
  const entry = await loadSyncLogEntry(stored);
  expect(entry.previousValue).toMatchObject({ name: 'Lantern Coast' });
  expect(entry.newValue).toBeUndefined();
  expect(entry.request).toEqual({ method: 'DELETE', path: '/api/v1/campaigns/campaign' });
  expect(entry.details).toMatchObject({ response: { ok: true } });
});

it('records campaign creation with the returned entity id and no invented prior row', async () => {
  const response = { id: 'new-campaign', name: 'New campaign', revision: 1 };
  await journalCampaignMutation(
    {
      command: 'create',
      method: 'POST',
      path: '/campaigns',
      body: { name: 'New campaign' },
      source: 'Campaign creation',
      humanName: 'campaign created',
    },
    async () => response,
  );
  const stored = (await getLocalDb().syncLog.toArray())[0];
  if (!stored) throw new Error('Expected creation log');
  const entry = await loadSyncLogEntry(stored);
  expect(entry).toMatchObject({
    entityId: 'new-campaign',
    entityName: 'New campaign',
    request: { method: 'POST', path: '/api/v1/campaigns', body: { name: 'New campaign' } },
    newValue: { name: 'New campaign' },
    details: { response },
  });
  expect(entry.previousValue).toBeUndefined();
});

it('records ownership transfer as a focused owner change while retaining the submitted request', async () => {
  const response = { ...before, ownerId: 'new-owner', revision: 42 };
  await journalCampaignMutation(
    {
      entityId: 'campaign',
      command: 'patch',
      method: 'POST',
      path: '/campaigns/campaign/transfer',
      body: { newOwnerId: 'new-owner' },
      before: { ...before, ownerId: 'old-owner' },
      source: 'Campaign ownership',
      humanName: 'campaign ownership transferred',
    },
    async () => response,
  );
  const stored = (await getLocalDb().syncLog.toArray())[0];
  if (!stored) throw new Error('Expected ownership log');
  const entry = await loadSyncLogEntry(stored);
  expect(entry.previousValue).toEqual({ ownerId: 'old-owner' });
  expect(entry.newValue).toEqual({ ownerId: 'new-owner' });
  expect(entry.request).toMatchObject({ method: 'POST', body: { newOwnerId: 'new-owner' } });
  expect(entry.details).toMatchObject({ response });
});
