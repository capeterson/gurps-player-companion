/**
 * Integration tests for the adventure-log routes: session number and
 * location columns (migration 0030) — create round-trip, list projection,
 * edit-preserves, explicit-null clears, and validation bounds.
 *
 * Requires a running Postgres test DB configured by ../testConfig.ts.
 */

import { describe, expect, it } from 'bun:test';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();

const app = createApp(integrationTestConfig);

function jsonHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

async function registerUser(suffix: string) {
  const email = `log-test-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: `Test ${suffix}` }),
  });
  const body = (await res.json()) as { accessToken: string };
  return { accessToken: body.accessToken, email };
}

async function createCampaign(accessToken: string): Promise<string> {
  const res = await app.request('/api/v1/campaigns', {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ name: `Campaign ${Date.now()}-${Math.random()}` }),
  });
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function createEntry(
  accessToken: string,
  campaignId: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
    method: 'POST',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({
      sessionDate: '2026-01-15',
      title: 'Session 13 — The Hollow Beneath Greymoor',
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

describe('adventure-log sessionNumber + location', () => {
  it('creates an entry with both fields and returns them verbatim', async () => {
    const { accessToken } = await registerUser('log-create');
    const campaignId = await createCampaign(accessToken);
    const entry = await createEntry(accessToken, campaignId, {
      sessionNumber: 13,
      location: 'The Hollow Beneath Greymoor',
    });
    expect(entry.sessionNumber).toBe(13);
    expect(entry.location).toBe('The Hollow Beneath Greymoor');
  });

  it('defaults both fields to null when omitted', async () => {
    const { accessToken } = await registerUser('log-defaults');
    const campaignId = await createCampaign(accessToken);
    const entry = await createEntry(accessToken, campaignId);
    expect(entry.sessionNumber).toBeNull();
    expect(entry.location).toBeNull();
  });

  it('list returns the fields alongside existing columns', async () => {
    const { accessToken } = await registerUser('log-list');
    const campaignId = await createCampaign(accessToken);
    await createEntry(accessToken, campaignId, {
      sessionNumber: 7,
      location: 'Tal Cabal',
    });
    await createEntry(accessToken, campaignId, { title: 'No metadata' });

    const res = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      headers: jsonHeaders(accessToken),
    });
    expect(res.status).toBe(200);
    const entries = (await res.json()) as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    const withMeta = entries.find((e) => e.sessionNumber === 7);
    const withoutMeta = entries.find((e) => e.title === 'No metadata');
    expect(withMeta?.location).toBe('Tal Cabal');
    expect(withoutMeta?.sessionNumber).toBeNull();
    expect(withoutMeta?.location).toBeNull();
  });

  it('PATCH updates the fields and preserves them on later partial edits', async () => {
    const { accessToken } = await registerUser('log-patch');
    const campaignId = await createCampaign(accessToken);
    const entry = await createEntry(accessToken, campaignId, {
      sessionNumber: 3,
      location: 'Old ruins',
    });

    // A patch that touches neither new field preserves both.
    const res = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ title: 'Retitled' }),
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as Record<string, unknown>;
    expect(updated.title).toBe('Retitled');
    expect(updated.sessionNumber).toBe(3);
    expect(updated.location).toBe('Old ruins');

    // Updating just one leaves the other alone.
    const res2 = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ sessionNumber: 4 }),
    });
    const updated2 = (await res2.json()) as Record<string, unknown>;
    expect(updated2.sessionNumber).toBe(4);
    expect(updated2.location).toBe('Old ruins');

    // Explicit null clears; the unrelated field survives.
    const res3 = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ location: null }),
    });
    const updated3 = (await res3.json()) as Record<string, unknown>;
    expect(updated3.location).toBeNull();
    expect(updated3.sessionNumber).toBe(4);
  });

  it('rejects out-of-range and over-length values (422)', async () => {
    const { accessToken } = await registerUser('log-validation');
    const campaignId = await createCampaign(accessToken);

    const badNumber = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ sessionDate: '2026-01-15', title: 'T', sessionNumber: 0 }),
    });
    expect(badNumber.status).toBe(422);

    const badLocation = await app.request(`/api/v1/campaigns/${campaignId}/log`, {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({
        sessionDate: '2026-01-15',
        title: 'T',
        location: 'x'.repeat(201),
      }),
    });
    expect(badLocation.status).toBe(422);
  });

  it('a non-author member cannot edit another member’s entry', async () => {
    const owner = await registerUser('log-access-owner');
    const author = await registerUser('log-access-author');
    const other = await registerUser('log-access-other');
    const campaignId = await createCampaign(owner.accessToken);
    // owner created the campaign; invite author + other member.
    for (const u of [author, other]) {
      const res = await app.request(`/api/v1/campaigns/${campaignId}/members`, {
        method: 'POST',
        headers: jsonHeaders(owner.accessToken),
        body: JSON.stringify({ email: u.email }),
      });
      expect(res.status).toBe(200);
    }

    const entry = await createEntry(author.accessToken, campaignId, {
      sessionNumber: 1,
      location: 'Somewhere',
    });

    const res = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(other.accessToken),
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(res.status).toBe(403);

    // The campaign owner can still edit it.
    const res2 = await app.request(`/api/v1/campaigns/${campaignId}/log/${entry.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(owner.accessToken),
      body: JSON.stringify({ location: 'Somewhere else' }),
    });
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as Record<string, unknown>).location).toBe('Somewhere else');
  });
});
