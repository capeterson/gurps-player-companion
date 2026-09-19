import { expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { instantiateEffect } from '../../shared/domain/activeEffects.ts';
import { activeEffectDefinitionCreate } from '../../shared/schemas/activeEffects.ts';
import { parseLibraryYaml } from '../../shared/yaml/library.ts';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);
async function request(token: string, path: string, method = 'GET', body?: unknown) {
  return app.request(`/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function user() {
  const email = `effects-${randomUUID()}@example.com`;
  const response = await request('', '/auth/register', 'POST', {
    email,
    password: 'TestPassword1!',
    displayName: 'Effects',
  });
  expect(response.status).toBe(201);
  return { email, ...(await response.json()) };
}
async function create(token: string, path: string, body: unknown) {
  const response = await request(token, path, 'POST', body);
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json();
}
it('shares active effect CRUD, snapshots, sync authorization, privacy, transfer and YAML semantics', async () => {
  const owner = await user();
  const player = await user();
  const other = await user();
  const token = owner.accessToken;
  const campaign = await create(token, '/campaigns', {
    name: 'Effects',
    shareCharacterSheets: false,
  });
  for (const member of [player, other])
    expect(
      (await request(token, `/campaigns/${campaign.id}/members`, 'POST', { email: member.email }))
        .status,
    ).toBe(200);
  const path = `/campaigns/${campaign.id}/library/active-effects`;
  const definition = activeEffectDefinitionCreate.parse({
    name: 'Battle Potion',
    stacking: { kind: 'additive', key: 'battle' },
    effects: [{ target: 'st', value: 2 }],
    duration: { kind: 'minutes', amount: 10 },
    capabilities: [{ kind: 'sense', key: 'true_sight', label: 'True Sight' }],
  });
  expect((await request(player.accessToken, path, 'POST', definition)).status).toBe(403);
  const saved = await create(token, path, definition);
  const character = await create(player.accessToken, '/characters', {
    name: 'Hero',
    campaignId: campaign.id,
  });
  let instance = {
    ...instantiateEffect(definition, randomUUID(), new Date().toISOString()),
    definitionId: saved.id,
    sourceCampaignId: campaign.id,
    sourceRevision: 0,
    effects: [{ target: 'st', value: 99, scaling: 'flat' }],
  };
  const response = await request(player.accessToken, `/characters/${character.id}`, 'PATCH', {
    activeEffects: [instance],
  });
  expect(response.status).toBe(200);
  let detail = await response.json();
  expect(detail.derived.effectiveSt).toBe(12);
  expect(detail.capabilities[0].capability.label).toBe('True Sight');
  instance = detail.activeEffects[0];
  const sync = async (actor: string, value: unknown, fieldPath = 'activeEffects') =>
    (
      await request(actor, '/sync/operations', 'POST', {
        operations: [
          {
            clientOpId: randomUUID(),
            entityClass: 'character',
            entityId: character.id,
            command: 'patch',
            createdAt: new Date().toISOString(),
            fieldPath,
            attemptedValue: value,
          },
        ],
      })
    ).json();
  expect(
    (
      await request(other.accessToken, `/characters/${character.id}`, 'PATCH', {
        activeEffects: [],
      })
    ).status,
  ).toBe(403);
  expect((await sync(other.accessToken, [])).outcomes[0].status).toBe('unauthorized');
  expect(
    (await sync(player.accessToken, [{ ...instance, state: 'inactive' }])).outcomes[0].status,
  ).toBe('applied');
  detail = await (await request(player.accessToken, `/characters/${character.id}`)).json();
  expect(detail.derived.effectiveSt).toBe(10);
  await sync(player.accessToken, [{ ...instance, state: 'active' }]);
  const masked = await (await request(other.accessToken, `/characters/${character.id}`)).json();
  expect(masked.view).toBe('minimal');
  expect(masked.activeEffects).toBeUndefined();
  const cursor = await (
    await request(other.accessToken, '/sync/cursor', 'POST', {
      cursors: [{ entityClass: 'character', sinceRevision: 0 }],
    })
  ).json();
  expect(JSON.stringify(cursor)).not.toContain('True Sight');
  await request(token, `${path}/${saved.id}`, 'PATCH', { effects: [{ target: 'st', value: 3 }] });
  detail = await (await request(player.accessToken, `/characters/${character.id}`)).json();
  expect(detail.derived.effectiveSt).toBe(13);
  expect(detail.activeEffects[0].sourceRevision).toBeGreaterThan(instance.sourceRevision);
  const exported = await (await request(token, `/campaigns/${campaign.id}/library/export`)).text();
  expect(parseLibraryYaml(exported).library.activeEffects?.[0]?.name).toBe('Battle Potion');
  expect((await request(token, `${path}/${saved.id}`, 'DELETE')).status).toBe(204);
  detail = await (await request(player.accessToken, `/characters/${character.id}`)).json();
  expect(detail.activeEffects[0].definitionId).toBeNull();
  expect(detail.derived.effectiveSt).toBe(13);
  const replacement = await create(token, path, definition);
  detail = await (await request(player.accessToken, `/characters/${character.id}`)).json();
  expect(detail.activeEffects[0].definitionId).toBeNull();
  await sync(player.accessToken, [{ ...instance, definitionId: replacement.id }]);
  await request(player.accessToken, `/characters/${character.id}`, 'PATCH', { campaignId: null });
  detail = await (await request(player.accessToken, `/characters/${character.id}`)).json();
  expect(detail.activeEffects[0].definitionId).toBeNull();
  expect(detail.derived.effectiveSt).toBe(12);
  const history = await (
    await request(player.accessToken, `/characters/${character.id}/history`)
  ).text();
  expect(history).toContain('Applied Battle Potion');
}, 30000);
it('captures skill procedures in owned snapshots and recalculates benefits after point edits', async () => {
  const owner = await user();
  const token = owner.accessToken;
  const campaign = await create(token, '/campaigns', { name: 'Rules' });
  const skill = await create(token, `/campaigns/${campaign.id}/library/skills`, {
    name: 'Arbitrary skill',
    attribute: 'DX',
    difficulty: 'A',
    procedures: {
      modifiers: [
        {
          id: 'task',
          label: 'On foot',
          appliesTo: 'task_roll',
          value: { kind: 'fixed', value: 5 },
        },
      ],
      actions: [
        {
          id: 'recover',
          label: 'Recovery',
          roll: { basis: 'skill' },
          time: { amount: { kind: 'constant', value: 10 }, unit: 'minutes' },
        },
      ],
      benefits: [
        {
          id: 'trained',
          label: 'Trained defense',
          when: { minimumRelativeLevel: 1 },
          effects: [{ target: 'parry', value: 1 }],
        },
      ],
    },
  });
  const character = await create(token, '/characters', {
    name: 'Learner',
    campaignId: campaign.id,
  });
  const learned = await create(token, `/characters/${character.id}/skills`, {
    name: skill.name,
    attribute: 'DX',
    difficulty: 'A',
    points: 2,
    librarySkillId: skill.id,
  });
  let detail = await (await request(token, `/characters/${character.id}`)).json();
  expect(detail.skills[0].effectiveLevel).toBe(10);
  expect(detail.skills[0].procedures.actions[0].label).toBe('Recovery');
  expect(detail.skills[0].benefitStatus[0].unlocked).toBe(false);
  await request(token, `/characters/${character.id}/skills/${learned.skill.id}`, 'PATCH', {
    points: 4,
  });
  detail = await (await request(token, `/characters/${character.id}`)).json();
  expect(detail.skills[0].effectiveLevel).toBe(11);
  expect(detail.skills[0].benefitStatus[0].unlocked).toBe(true);
  expect(detail.effects.find((e: { target: string }) => e.target === 'parry').value).toBe(1);
  const legacyEdit = await request(
    token,
    `/campaigns/${campaign.id}/library/skills/${skill.id}`,
    'PATCH',
    { situationalModifiers: [{ name: 'Tools', modifier: -2 }] },
  );
  expect(legacyEdit.status).toBe(200);
  const editedSkill = await legacyEdit.json();
  expect(editedSkill.procedures.actions[0].label).toBe('Recovery');
  expect(editedSkill.procedures.modifiers.some((r: { id: string }) => r.id === 'legacy-1')).toBe(
    true,
  );
  await request(token, `/campaigns/${campaign.id}/library/skills/${skill.id}`, 'DELETE');
  detail = await (await request(token, `/characters/${character.id}`)).json();
  expect(detail.skills[0].procedures.actions[0].label).toBe('Recovery');
}, 30000);
