import { describe, expect, it } from 'bun:test';
import type { LibrarySkillOut } from '../../shared/schemas/campaignLibrary.ts';
import { createApp } from '../app.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';

configureIntegrationTestEnvironment();
const app = createApp(integrationTestConfig);

const IMPACTED_SKILLS = [
  'Animal Handling',
  'Anthropology',
  'Area Knowledge',
  'Armoury',
  'Artillery',
  'Artist',
  'Beam Weapons',
  'Bioengineering',
  'Biology',
  'Boating',
  'Connoisseur',
  'Current Affairs',
  'Disguise',
  'Driving',
  'Electronics Operation',
  'Electronics Repair',
  'Engineer',
  'Esoteric Medicine',
  'Expert Skill',
  'Explosives',
  'Fast-Draw',
  'Fortune-Telling',
  'Games',
  'Geography',
  'Geology',
  'Group Performance',
  'Gunner',
  'Guns',
  'Hazardous Materials',
  'Hidden Lore',
  'History',
  'Innate Attack',
  'Law',
  'Liquid Projector',
  'Mathematics',
  'Meteorology',
  'Mimicry',
  'Musical Instrument',
  'Naturalist',
  'Navigation',
  'Paleontology',
  'Pharmacy',
  'Philosophy',
  'Physiology',
  'Piloting',
  'Psychology',
  'Riding',
  'Ritual Magic',
  'Savoir-Faire',
  'Shield',
  'Shiphandling',
  'Smith',
  'Strategy',
  'Submarine',
  'Survival',
  'Symbol Drawing',
  'Teamster',
  'Theology',
  'Thrown Weapon',
] as const;

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

async function post(token: string, path: string, body: unknown) {
  return app.request(`/api/v1${path}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

describe('library skill specializations', () => {
  it('enforces required TL and structured prerequisites through REST and sync policy', async () => {
    const registered = await post('', '/auth/register', {
      email: `skill-rules-${crypto.randomUUID()}@example.com`,
      password: 'TestPassword1!',
      displayName: 'Skill rules tester',
    });
    const { accessToken } = (await registered.json()) as { accessToken: string };
    const campaign = (await (
      await post(accessToken, '/campaigns', { name: 'Structured skill rules', techLevel: 8 })
    ).json()) as { id: string };
    const character = (await (
      await post(accessToken, '/characters', { name: 'Learner', campaignId: campaign.id })
    ).json()) as { id: string };
    const source = (await (
      await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
        name: 'Computer Hacking',
        attribute: 'IQ',
        difficulty: 'VH',
        techLevelPolicy: { kind: 'required', suggestedFrom: 'campaign' },
        prerequisites: 'IQ 12+',
        prerequisiteRules: { kind: 'attribute', attribute: 'IQ', minimum: 12 },
      })
    ).json()) as LibrarySkillOut;

    const missingTl = await post(accessToken, `/characters/${character.id}/skills`, {
      name: source.name,
      attribute: source.attribute,
      difficulty: source.difficulty,
      librarySkillId: source.id,
    });
    expect(missingTl.status).toBe(400);
    expect(await missingTl.json()).toEqual({
      error: 'Computer Hacking requires a concrete Tech Level',
    });

    const blocked = await post(accessToken, `/characters/${character.id}/skills`, {
      name: source.name,
      attribute: source.attribute,
      difficulty: source.difficulty,
      techLevel: 8,
      librarySkillId: source.id,
    });
    expect(blocked.status).toBe(400);
    expect((await blocked.json()) as { error: string }).toEqual({
      error: 'Unmet prerequisites for Computer Hacking: IQ 12+',
    });

    const policy = await app.request(`/api/v1/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: headers(accessToken),
      body: JSON.stringify({ skillPrerequisitePolicy: 'warn' }),
    });
    expect(policy.status).toBe(200);
    const created = await post(accessToken, `/characters/${character.id}/skills`, {
      name: source.name,
      attribute: source.attribute,
      difficulty: source.difficulty,
      techLevel: 8,
      librarySkillId: source.id,
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      skill: { id: string; prerequisiteStatus?: string; prerequisiteMessages?: string[] };
    };
    expect(createdBody.skill).toMatchObject({
      prerequisiteStatus: 'unmet',
      prerequisiteMessages: ['IQ 12+'],
    });

    const blockAgain = await app.request(`/api/v1/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: headers(accessToken),
      body: JSON.stringify({ skillPrerequisitePolicy: 'block' }),
    });
    expect(blockAgain.status).toBe(200);
    const pointsPatch = await app.request(
      `/api/v1/characters/${character.id}/skills/${createdBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ points: 2 }),
      },
    );
    expect(pointsPatch.status).toBe(400);
    expect((await pointsPatch.json()) as { error: string }).toEqual({
      error: 'Unmet prerequisites for Computer Hacking: IQ 12+',
    });
    const clearTl = await app.request(
      `/api/v1/characters/${character.id}/skills/${createdBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ techLevel: null }),
      },
    );
    expect(clearTl.status).toBe(400);

    const syncPointsPatch = await post(accessToken, '/sync/operations', {
      operations: [
        {
          clientOpId: crypto.randomUUID(),
          entityClass: 'character_skill',
          entityId: createdBody.skill.id,
          parentId: character.id,
          command: 'patch',
          fieldPath: 'points',
          attemptedValue: 2,
          prevValue: 1,
          validationVersion: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(syncPointsPatch.status).toBe(200);
    expect(
      ((await syncPointsPatch.json()) as { outcomes: Array<{ status: string }> }).outcomes,
    ).toEqual([expect.objectContaining({ status: 'rejected' })]);

    const sync = await post(accessToken, '/sync/operations', {
      operations: [
        {
          clientOpId: crypto.randomUUID(),
          entityClass: 'character_skill',
          entityId: crypto.randomUUID(),
          parentId: character.id,
          command: 'create',
          validationVersion: 1,
          createdAt: new Date().toISOString(),
          attemptedValue: {
            name: source.name,
            attribute: source.attribute,
            difficulty: source.difficulty,
            techLevel: 8,
            librarySkillId: source.id,
          },
        },
      ],
    });
    expect(sync.status).toBe(200);
    expect((await sync.json()) as { outcomes: Array<{ status: string }> }).toMatchObject({
      outcomes: [{ status: 'rejected' }],
    });

    const unlinked = await post(accessToken, `/characters/${character.id}/skills`, {
      name: 'Unlinked hacking',
      attribute: 'IQ',
      difficulty: 'VH',
      techLevel: 8,
    });
    const unlinkedBody = (await unlinked.json()) as { skill: { id: string } };
    const blockedLink = await app.request(
      `/api/v1/characters/${character.id}/skills/${unlinkedBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ librarySkillId: source.id }),
      },
    );
    expect(blockedLink.status).toBe(400);

    const catalogSource = (await (
      await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
        name: 'Catalog-gated Skill',
        attribute: 'IQ',
        difficulty: 'A',
        defaultSpecialization: 'Open',
        specializationPolicy: {
          kind: 'required_catalog',
          options: [
            { name: 'Open' },
            {
              name: 'Restricted',
              prerequisites: 'IQ 12+',
              prerequisiteRules: { kind: 'attribute', attribute: 'IQ', minimum: 12 },
            },
          ],
        },
      })
    ).json()) as LibrarySkillOut;
    const catalogSkill = await post(accessToken, `/characters/${character.id}/skills`, {
      name: catalogSource.name,
      attribute: catalogSource.attribute,
      difficulty: catalogSource.difficulty,
      specialization: 'Open',
      librarySkillId: catalogSource.id,
    });
    expect(catalogSkill.status).toBe(201);
    const catalogSkillBody = (await catalogSkill.json()) as { skill: { id: string } };
    const specializationBlocked = await app.request(
      `/api/v1/characters/${character.id}/skills/${catalogSkillBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ specialization: 'Restricted' }),
      },
    );
    expect(specializationBlocked.status).toBe(400);

    const optionalSource = (await (
      await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
        name: 'Optional specialty',
        attribute: 'IQ',
        difficulty: 'A',
        defaults: [{ kind: 'attribute', attribute: 'IQ', modifier: -5 }],
        specializationPolicy: {
          kind: 'optional_catalog',
          options: [
            {
              name: 'Focused',
              defaults: [{ kind: 'attribute', attribute: 'IQ', modifier: -2 }],
            },
          ],
        },
      })
    ).json()) as LibrarySkillOut;
    const focusedSkill = await post(accessToken, `/characters/${character.id}/skills`, {
      name: optionalSource.name,
      attribute: optionalSource.attribute,
      difficulty: optionalSource.difficulty,
      specialization: 'Focused',
      librarySkillId: optionalSource.id,
    });
    expect(focusedSkill.status).toBe(201);
    const focusedSkillBody = (await focusedSkill.json()) as { skill: { id: string } };
    const clearedSpecialization = await app.request(
      `/api/v1/characters/${character.id}/skills/${focusedSkillBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ specialization: null }),
      },
    );
    expect(clearedSpecialization.status).toBe(200);
    expect(
      (
        (await clearedSpecialization.json()) as {
          skill: {
            specialization: string | null;
            libraryMechanics: { skillRules: { defaults: unknown } };
          };
        }
      ).skill,
    ).toMatchObject({
      specialization: null,
      libraryMechanics: {
        skillRules: {
          defaults: [{ kind: 'attribute', attribute: 'IQ', modifier: -5 }],
        },
      },
    });

    const iqTalent = (await (
      await post(accessToken, `/campaigns/${campaign.id}/library/traits`, {
        name: 'Exceptional Intellect',
        kind: 'advantage',
        effects: [{ target: 'iq', value: 2 }],
      })
    ).json()) as { id: string };
    const copyTalent = await post(accessToken, `/characters/${character.id}/traits`, {
      name: 'Exceptional Intellect',
      kind: 'advantage',
      libraryTraitId: iqTalent.id,
    });
    expect(copyTalent.status).toBe(201);
    const pointsWithTalent = await app.request(
      `/api/v1/characters/${character.id}/skills/${createdBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ points: 2 }),
      },
    );
    expect(pointsWithTalent.status).toBe(200);

    const gatedSource = (await (
      await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
        name: 'Thaumatology',
        attribute: 'IQ',
        difficulty: 'VH',
        prerequisiteRules: { kind: 'gm_permission', label: 'Unusual Background approved' },
      })
    ).json()) as LibrarySkillOut;
    const gmApproved = await post(accessToken, `/characters/${character.id}/skills`, {
      name: gatedSource.name,
      attribute: gatedSource.attribute,
      difficulty: gatedSource.difficulty,
      librarySkillId: gatedSource.id,
    });
    expect(gmApproved.status).toBe(201);
    const gmApprovedBody = (await gmApproved.json()) as {
      skill: {
        prerequisiteStatus?: string;
        libraryMechanics?: { skillRules?: { gmPermissions?: string[] } };
      };
    };
    expect(gmApprovedBody.skill.prerequisiteStatus).toBe('met');
    expect(gmApprovedBody.skill.libraryMechanics?.skillRules?.gmPermissions).toEqual([
      'Unusual Background approved',
    ]);

    const legacyTlSource = (await (
      await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
        name: 'Legacy TL skill',
        attribute: 'IQ',
        difficulty: 'A',
        techLevel: 8,
      })
    ).json()) as LibrarySkillOut;
    const legacyTlPatch = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/skills/${legacyTlSource.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ techLevel: 9 }),
      },
    );
    expect(await legacyTlPatch.json()).toMatchObject({
      techLevel: 9,
      techLevelPolicy: { kind: 'fixed', techLevel: 9 },
    });
    const explicitPolicyPatch = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/skills/${legacyTlSource.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ techLevelPolicy: { kind: 'required', suggestedFrom: 'campaign' } }),
      },
    );
    expect(await explicitPolicyPatch.json()).toMatchObject({
      techLevel: null,
      techLevelPolicy: { kind: 'required', suggestedFrom: 'campaign' },
    });
  });

  it('persists and copies every specialization-required Basic Set skill', async () => {
    expect(IMPACTED_SKILLS).toHaveLength(59);
    const registered = await post('', '/auth/register', {
      email: `specializations-${crypto.randomUUID()}@example.com`,
      password: 'TestPassword1!',
      displayName: 'Specialization tester',
    });
    expect(registered.status).toBe(201);
    const { accessToken } = (await registered.json()) as {
      accessToken: string;
    };
    const campaignResponse = await post(accessToken, '/campaigns', {
      name: 'Specialization coverage',
    });
    expect(campaignResponse.status).toBe(201);
    const campaign = (await campaignResponse.json()) as { id: string };
    const characterResponse = await post(accessToken, '/characters', {
      name: 'Specialist',
      campaignId: campaign.id,
    });
    expect(characterResponse.status).toBe(201);
    const character = (await characterResponse.json()) as { id: string };

    const created: LibrarySkillOut[] = [];
    for (const name of IMPACTED_SKILLS) {
      const response = await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
        name,
        attribute: 'IQ',
        difficulty: 'A',
        specializationPolicy: { kind: 'required_freeform' },
      });
      expect(response.status).toBe(201);
      created.push((await response.json()) as LibrarySkillOut);
    }
    expect(created.every((skill) => skill.specializationPolicy.kind === 'required_freeform')).toBe(
      true,
    );

    const missing = await post(accessToken, `/characters/${character.id}/skills`, {
      name: created[0]?.name,
      attribute: 'IQ',
      difficulty: 'A',
      librarySkillId: created[0]?.id,
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: 'Animal Handling requires a specialization',
    });

    for (const [index, source] of created.entries()) {
      const specialization = `Coverage specialty ${index + 1}`;
      const response = await post(accessToken, `/characters/${character.id}/skills`, {
        name: source.name,
        attribute: source.attribute,
        difficulty: source.difficulty,
        specialization,
        librarySkillId: source.id,
      });
      expect(response.status).toBe(201);
      const result = (await response.json()) as {
        skill: { specialization: string | null };
      };
      expect(result.skill.specialization).toBe(specialization);
    }
  }, 60_000);

  it('canonicalizes catalog choices and rejects values outside the catalog', async () => {
    const registered = await post('', '/auth/register', {
      email: `specialization-catalog-${crypto.randomUUID()}@example.com`,
      password: 'TestPassword1!',
      displayName: 'Catalog tester',
    });
    const { accessToken } = (await registered.json()) as {
      accessToken: string;
    };
    const campaign = (await (
      await post(accessToken, '/campaigns', { name: 'Catalog validation' })
    ).json()) as { id: string };
    const character = (await (
      await post(accessToken, '/characters', {
        name: 'Catalog user',
        campaignId: campaign.id,
      })
    ).json()) as { id: string };
    const source = (await (
      await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
        name: 'Armoury',
        attribute: 'IQ',
        difficulty: 'A',
        defaultSpecialization: 'Small Arms',
        specializationPolicy: {
          kind: 'required_catalog',
          options: [
            {
              name: 'Small Arms',
              description: 'Small-arms override',
              prerequisites: 'Guns familiarity',
              defaults: [{ kind: 'attribute', attribute: 'IQ', modifier: -4 }],
            },
            { name: 'Body Armor' },
          ],
        },
      })
    ).json()) as LibrarySkillOut;

    const invalid = await post(accessToken, `/characters/${character.id}/skills`, {
      name: source.name,
      attribute: source.attribute,
      difficulty: source.difficulty,
      specialization: 'Alchemy',
      librarySkillId: source.id,
    });
    expect(invalid.status).toBe(400);
    const valid = await post(accessToken, `/characters/${character.id}/skills`, {
      name: source.name,
      attribute: source.attribute,
      difficulty: source.difficulty,
      specialization: ' small   arms ',
      librarySkillId: source.id,
    });
    expect(valid.status).toBe(201);
    const validBody = (await valid.json()) as {
      skill: {
        id: string;
        specialization: string;
        defaults: unknown;
        notes: string;
      };
    };
    expect(validBody.skill.specialization).toBe('Small Arms');
    expect(validBody.skill.defaults).toEqual([
      { kind: 'attribute', attribute: 'IQ', modifier: -4 },
    ]);
    expect(validBody.skill.notes).toBe('Small-arms override\n\nPrerequisites: Guns familiarity');

    const warnOnRefreshRules = await app.request(`/api/v1/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: headers(accessToken),
      body: JSON.stringify({ skillPrerequisitePolicy: 'warn' }),
    });
    expect(warnOnRefreshRules.status).toBe(200);
    const refreshSource = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/skills/${source.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({
          description: 'Source edit',
          specializationPolicy: {
            kind: 'required_catalog',
            options: [
              {
                name: 'Small Arms',
                description: 'Small-arms override',
                prerequisites: 'Guns familiarity',
                prerequisiteRules: { kind: 'trait', name: 'Guns familiarity' },
                defaults: [{ kind: 'attribute', attribute: 'IQ', modifier: -4 }],
              },
              { name: 'Body Armor' },
            ],
          },
        }),
      },
    );
    expect(refreshSource.status).toBe(200);
    const refreshedCharacter = await app.request(`/api/v1/characters/${character.id}`, {
      headers: headers(accessToken),
    });
    const refreshedSkill = (
      (await refreshedCharacter.json()) as {
        skills: Array<{
          id: string;
          libraryMechanics?: { skillRules?: { prerequisites?: unknown; defaults?: unknown } };
        }>;
      }
    ).skills.find((skill) => skill.id === validBody.skill.id);
    expect(refreshedSkill?.libraryMechanics?.skillRules).toMatchObject({
      prerequisites: { kind: 'trait', name: 'Guns familiarity' },
      defaults: [{ kind: 'attribute', attribute: 'IQ', modifier: -4 }],
    });

    const explicitSnapshot = await post(accessToken, `/characters/${character.id}/skills`, {
      name: source.name,
      attribute: source.attribute,
      difficulty: source.difficulty,
      specialization: 'Small Arms',
      defaults: [],
      notes: null,
      librarySkillId: source.id,
    });
    expect(explicitSnapshot.status).toBe(201);
    const explicitSnapshotBody = (await explicitSnapshot.json()) as {
      skill: { id: string; defaults: unknown; notes: string | null };
    };
    expect(explicitSnapshotBody.skill.defaults).toEqual([]);
    expect(explicitSnapshotBody.skill.notes).toBeNull();

    const reassertReference = await app.request(
      `/api/v1/characters/${character.id}/skills/${explicitSnapshotBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ librarySkillId: source.id }),
      },
    );
    expect(reassertReference.status).toBe(200);
    expect(
      (
        (await reassertReference.json()) as {
          skill: { defaults: unknown; notes: string | null };
        }
      ).skill,
    ).toMatchObject({ defaults: [], notes: null });

    const unlinked = await post(accessToken, `/characters/${character.id}/skills`, {
      name: 'Armoury',
      attribute: 'IQ',
      difficulty: 'A',
    });
    const unlinkedBody = (await unlinked.json()) as { skill: { id: string } };
    const linked = await app.request(
      `/api/v1/characters/${character.id}/skills/${unlinkedBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ librarySkillId: source.id }),
      },
    );
    expect(linked.status).toBe(200);
    expect(
      ((await linked.json()) as { skill: { specialization: string } }).skill.specialization,
    ).toBe('Small Arms');

    const restPatch = await app.request(
      `/api/v1/characters/${character.id}/skills/${validBody.skill.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ specialization: 'Alchemy' }),
      },
    );
    expect(restPatch.status).toBe(400);

    const syncPatch = await post(accessToken, '/sync/operations', {
      operations: [
        {
          clientOpId: crypto.randomUUID(),
          entityClass: 'character_skill',
          entityId: validBody.skill.id,
          parentId: character.id,
          command: 'patch',
          fieldPath: 'specialization',
          attemptedValue: 'Alchemy',
          prevValue: 'Small Arms',
          validationVersion: 1,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(syncPatch.status).toBe(200);
    expect(
      ((await syncPatch.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status,
    ).toBe('rejected');

    const inconsistentCreate = await post(accessToken, `/campaigns/${campaign.id}/library/skills`, {
      name: 'Inconsistent',
      attribute: 'IQ',
      difficulty: 'A',
      defaultSpecialization: 'Hidden',
      specializationPolicy: { kind: 'none' },
    });
    expect(inconsistentCreate.status).toBe(400);
    const inconsistentPatch = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/skills/${source.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({ defaultSpecialization: 'Not in catalog' }),
      },
    );
    expect(inconsistentPatch.status).toBe(400);
    const afterRejectedPatch = await app.request(`/api/v1/campaigns/${campaign.id}/library`, {
      headers: headers(accessToken),
    });
    expect(afterRejectedPatch.status).toBe(200);
    const library = (await afterRejectedPatch.json()) as {
      skills: LibrarySkillOut[];
    };
    expect(library.skills.find((skill) => skill.id === source.id)?.defaultSpecialization).toBe(
      'Small Arms',
    );

    const removeUsedOption = await app.request(
      `/api/v1/campaigns/${campaign.id}/library/skills/${source.id}`,
      {
        method: 'PATCH',
        headers: headers(accessToken),
        body: JSON.stringify({
          defaultSpecialization: 'Body Armor',
          specializationPolicy: {
            kind: 'required_catalog',
            options: [{ name: 'Body Armor' }],
          },
        }),
      },
    );
    expect(removeUsedOption.status).toBe(200);
    const afterOptionRemoval = await app.request(`/api/v1/characters/${character.id}`, {
      headers: headers(accessToken),
    });
    const detachedSkill = (
      (await afterOptionRemoval.json()) as {
        skills: Array<{
          id: string;
          librarySkillId: string | null;
          libraryMechanics?: { detached?: boolean; skillRules?: { defaults?: unknown } };
        }>;
      }
    ).skills.find((skill) => skill.id === validBody.skill.id);
    expect(detachedSkill).toMatchObject({
      librarySkillId: null,
      libraryMechanics: {
        detached: true,
        skillRules: { defaults: [{ kind: 'attribute', attribute: 'IQ', modifier: -4 }] },
      },
    });
  });
});
