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
  });
});
