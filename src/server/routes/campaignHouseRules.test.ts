import { describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { HOUSE_RULE_DEFINITIONS } from '../../shared/domain/campaignRules.ts';
import type { CampaignOut } from '../../shared/schemas/campaign.ts';
import type { CharacterDetail } from '../../shared/schemas/character.ts';
import type { SyncCursorResponse } from '../../shared/schemas/sync.ts';
import { parseLibraryYaml } from '../../shared/yaml/library.ts';
import { createApp } from '../app.ts';
import { getDb } from '../db/client.ts';
import { entityHistory } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);
async function user() {
  const email = `house-rules-${crypto.randomUUID()}@example.com`;
  const response = await app.request('/api/v1/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPassword1!', displayName: 'GM' }),
  });
  const body = (await response.json()) as { accessToken: string };
  return { ...body, email };
}
function request(token: string, path: string, method = 'GET', body?: unknown) {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('campaign house rules', () => {
  it('materializes named bundles and preserves their values when saved as Custom', async () => {
    const owner = await user();
    const created = await request(owner.accessToken, '/campaigns', 'POST', {
      name: 'Named rules',
      houseRules: { ruleSet: 'j_talisar' },
    });
    expect(created.status).toBe(201);
    const campaign = (await created.json()) as CampaignOut;
    expect(campaign.houseRules.ruleSet).toBe('j_talisar');
    for (const { key } of HOUSE_RULE_DEFINITIONS) expect(campaign.houseRules[key]).toBe(true);

    const customized = await request(owner.accessToken, `/campaigns/${campaign.id}`, 'PATCH', {
      houseRules: {
        ...campaign.houseRules,
        ruleSet: 'custom',
        forbidAcidMagic: false,
      },
    });
    expect(customized.status).toBe(200);
    const saved = (await customized.json()) as CampaignOut;
    expect(saved.houseRules.ruleSet).toBe('custom');
    expect(saved.houseRules.forbidAcidMagic).toBe(false);
    expect(saved.houseRules.forbidDistantBlow).toBe(true);
    expect(saved.houseRules.eyeMissHitsFace).toBe(true);
  });

  it('defaults on; owner updates persist in REST, cursor, character details, history, and YAML', async () => {
    const owner = await user();
    const created = await request(owner.accessToken, '/campaigns', 'POST', { name: 'House rules' });
    expect(created.status).toBe(201);
    const campaign = (await created.json()) as CampaignOut;
    expect(campaign.houseRules).toMatchObject({ ruleSet: 'custom', protectNaturalDr: true });
    const patched = await request(owner.accessToken, `/campaigns/${campaign.id}`, 'PATCH', {
      houseRules: { protectNaturalDr: false },
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as CampaignOut).houseRules.protectNaturalDr).toBe(false);
    expect(
      (
        (await (
          await request(owner.accessToken, `/campaigns/${campaign.id}`)
        ).json()) as CampaignOut
      ).houseRules.protectNaturalDr,
    ).toBe(false);
    const cursor = await request(owner.accessToken, '/sync/cursor', 'POST', {
      cursors: [{ entityClass: 'campaign', sinceRevision: campaign.revision }],
    });
    const changes = ((await cursor.json()) as SyncCursorResponse).changes;
    expect(changes.find((change) => change.entityId === campaign.id)).toMatchObject({
      data: { houseRules: { protectNaturalDr: false } },
    });
    const characterRes = await request(owner.accessToken, '/characters', 'POST', {
      name: 'Hero',
      campaignId: campaign.id,
    });
    expect(characterRes.status).toBe(201);
    const character = (await characterRes.json()) as CharacterDetail;
    expect(character.houseRules).toMatchObject({ ruleSet: 'custom', protectNaturalDr: false });
    expect(character.houseRulesKnown).toBe(true);
    const events = await getDb()
      .select()
      .from(entityHistory)
      .where(eq(entityHistory.entityId, campaign.id));
    expect(
      events.some(
        (event) =>
          event.op === 'update' &&
          event.actorUserId === campaign.ownerId &&
          (event.newRow as { house_rules?: { protectNaturalDr: boolean } } | null)?.house_rules
            ?.protectNaturalDr === false,
      ),
    ).toBe(true);
    const exported = await request(owner.accessToken, `/campaigns/${campaign.id}/library/export`);
    expect(parseLibraryYaml(await exported.text()).campaign?.houseRules).toMatchObject({
      ruleSet: 'custom',
      protectNaturalDr: false,
    });
  });

  it('rejects invalid values and prevents members from changing house rules', async () => {
    const owner = await user();
    const member = await user();
    const campaign = (await (
      await request(owner.accessToken, '/campaigns', 'POST', { name: 'Protected settings' })
    ).json()) as CampaignOut;
    await request(owner.accessToken, `/campaigns/${campaign.id}/members`, 'POST', {
      email: member.email,
    });
    const forbidden = await request(member.accessToken, `/campaigns/${campaign.id}`, 'PATCH', {
      houseRules: { protectNaturalDr: false },
    });
    expect(forbidden.status).toBe(403);
    for (const houseRules of [{ protectNaturalDr: 'false' }, { unrecognizedRule: true }, null]) {
      const invalid = await request(owner.accessToken, `/campaigns/${campaign.id}`, 'PATCH', {
        houseRules,
      });
      expect(invalid.status).toBeGreaterThanOrEqual(400);
      expect(invalid.status).toBeLessThan(500);
    }
    expect(
      (
        (await (
          await request(owner.accessToken, `/campaigns/${campaign.id}`)
        ).json()) as CampaignOut
      ).houseRules.protectNaturalDr,
    ).toBe(true);
  });

  it('imports explicit house rules only with campaign settings opted in; legacy YAML preserves them', async () => {
    const owner = await user();
    const campaign = (await (
      await request(owner.accessToken, '/campaigns', 'POST', {
        name: 'Import settings',
        houseRules: { protectNaturalDr: false },
      })
    ).json()) as CampaignOut;
    const base = 'version: 6\nlibrary: {}\ncampaign:\n  description: Imported\n';
    for (const [yaml, applyCampaignSettings, expected] of [
      [base, true, false],
      [`${base}  houseRules:\n    protectNaturalDr: true\n`, false, false],
      [`${base}  houseRules:\n    protectNaturalDr: true\n`, true, true],
    ] as const) {
      const imported = await request(
        owner.accessToken,
        `/campaigns/${campaign.id}/library/import`,
        'POST',
        { yaml, applyCampaignSettings },
      );
      expect(imported.status).toBe(200);
      expect(
        (
          (await (
            await request(owner.accessToken, `/campaigns/${campaign.id}`)
          ).json()) as CampaignOut
        ).houseRules.protectNaturalDr,
      ).toBe(expected);
    }
  });
});
