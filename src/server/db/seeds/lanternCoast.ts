import { readFile } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { instantiateEffect } from '../../../shared/domain/activeEffects.ts';
import { activeEffectDefinitionOut } from '../../../shared/schemas/activeEffects.ts';
import { encounterOut } from '../../../shared/schemas/encounter.ts';
import { parseLibraryYaml } from '../../../shared/yaml/library.ts';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { loadConfig } from '../../config.ts';
import { getDb, runInDbSavepoint } from '../client.ts';
import { campaigns, users } from '../schema.ts';
import { ensureDemoUser } from './accounts.ts';
import { type SeedItem, lanternCharacters } from './lanternCoastData.ts';

export const LANTERN_CAMPAIGN_NAME = 'The Lantern Coast';
const identified = z.object({ id: z.string().uuid() });
const libraryResponse = z.record(z.array(identified.extend({ name: z.string() }).passthrough()));

/**
 * A single atomic, insert-once fixture. Normal routes validate all campaign and
 * character writes, capture owned library mechanics, and record audit/revisions.
 * The owner/name key deliberately does not adopt another account's demo campaign.
 * libraryText lets integration tests exercise a late fixture failure and rollback.
 */
export async function seedLanternCoast(ownerId: string, libraryText?: string) {
  return runInDbSavepoint(async () => {
    const db = getDb();
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`seed:lantern:${ownerId}`}, 0))`,
    );
    const [existing] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.ownerId, ownerId), eq(campaigns.name, LANTERN_CAMPAIGN_NAME)));
    if (existing) return { campaignId: existing.id, created: false };

    const yaml =
      libraryText ??
      (await readFile(
        new URL('../../../../bootstrap/lantern_coast.yaml', import.meta.url),
        'utf8',
      ));
    const document = parseLibraryYaml(yaml);
    const app = createApp(loadConfig());
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!owner) throw new Error('Seed owner does not exist');
    const ownerToken = (await signAccessToken(owner.id, owner.authVersion)).token;
    const request = async (
      token: string,
      path: string,
      method = 'POST',
      body?: unknown,
    ): Promise<unknown> => {
      const response = await app.request(`/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(
          `Lantern seed ${method} ${path}: ${response.status} ${await response.text()}`,
        );
      return response.status === 204 ? null : response.json();
    };
    const campaign = identified.parse(
      await request(ownerToken, '/campaigns', 'POST', {
        ...document.campaign,
        name: LANTERN_CAMPAIGN_NAME,
        shareCharacterSheets: true,
        experimentalTurnTracker: true,
        allowGmCharacterEditing: false,
      }),
    );
    const campaignPath = `/campaigns/${campaign.id}`;
    await request(ownerToken, `${campaignPath}/library/import`, 'POST', { yaml, mode: 'merge' });
    const library = libraryResponse.parse(
      await request(ownerToken, `${campaignPath}/library`, 'GET'),
    );
    const definition = (section: string, name: string) => {
      const found = library[section]?.find((entry) => entry.name === name);
      if (!found) throw new Error(`Missing Lantern fixture ${section}: ${name}`);
      return found;
    };
    const characterIds: string[] = [];
    for (const fixture of lanternCharacters) {
      const player = await ensureDemoUser(fixture.email, fixture.displayName);
      await request(ownerToken, `${campaignPath}/members`, 'POST', { email: player.email });
      if (fixture.manager)
        await request(ownerToken, `${campaignPath}/members/${player.id}`, 'PATCH', {
          role: 'manager',
        });
      const token = (await signAccessToken(player.id, player.authVersion)).token;
      const character = identified.parse(
        await request(token, '/characters', 'POST', {
          ...fixture.character,
          campaignId: campaign.id,
        }),
      );
      characterIds.push(character.id);
      const path = `/characters/${character.id}`;
      for (const [section, link] of [
        ['traits', 'libraryTraitId'],
        ['skills', 'librarySkillId'],
        ['spells', 'librarySpellId'],
        ['languages', 'libraryLanguageId'],
        ['techniques', 'libraryTechniqueId'],
      ] as const) {
        for (const entry of fixture[section]) {
          const source = definition(section, entry.name);
          await request(token, `${path}/${section}`, 'POST', {
            ...source,
            ...entry,
            [link]: source.id,
          });
        }
      }
      const itemIds = new Map<string, string>();
      const addItem = async (item: SeedItem, parentId?: string): Promise<void> => {
        const source = item.library ? definition('items', item.library) : undefined;
        const payload = {
          ...source,
          ...item.data,
          name: item.name,
          ...(source ? { libraryItemId: source.id } : {}),
          ...(parentId ? { parentId } : {}),
          enchantments:
            item.enchantments?.map((name) => ({
              spellName: name,
              definitionId: definition('enchantments', name).id,
            })) ?? [],
        };
        const saved = z
          .object({ item: identified })
          .parse(await request(token, `${path}/inventory`, 'POST', payload));
        itemIds.set(item.name, saved.item.id);
        for (const child of item.contents ?? []) await addItem(child, saved.item.id);
      };
      for (const item of fixture.inventory) await addItem(item);
      const effects = [];
      for (const entry of fixture.effects) {
        const source = activeEffectDefinitionOut.parse(definition('activeEffects', entry.name));
        // JSON instance identifiers follow the same PG18 UUID policy as row IDs.
        const result = await db.execute<{ id: string }>(sql`select uuidv7()::text as id`);
        const id = result.rows[0]?.id;
        if (!id) throw new Error('Failed to generate active effect UUID');
        const sourceInventoryId = entry.sourceItem ? itemIds.get(entry.sourceItem) : null;
        if (sourceInventoryId === undefined)
          throw new Error(`Missing effect source item: ${entry.sourceItem}`);
        effects.push({
          ...instantiateEffect(source, id, '2026-09-18T18:00:00.000Z'),
          definitionId: source.id,
          sourceRevision: source.revision,
          sourceCampaignId: campaign.id,
          state: entry.state,
          ...(entry.state === 'expired' ? { remainingRounds: 0 } : {}),
          sourceInventoryId,
          notes:
            'Seeded play-state example; advance rounds or toggle state to exercise the effect lifecycle.',
        });
      }
      await request(token, path, 'PATCH', { activeEffects: effects });
      await request(token, `${path}/combat`, 'PATCH', fixture.combat);
      // Real multi-actor, private content for permission and history testing.
      await request(token, `${campaignPath}/log`, 'POST', {
        sessionDate: '2026-09-18',
        sessionNumber: 4,
        title: `${fixture.character.name}: a promise unspoken`,
        visibility: 'private',
        body: `A private note by **${fixture.displayName}**.\n\nI have not told the others what the beacon showed me.`,
      });
    }
    for (const [sessionNumber, title, location, body] of [
      [
        0,
        'A charter and a promise',
        'Greyhaven inn',
        'The party agreed to find Fen before the autumn storms.\n\n- Secure passage.\n- Collect supplies.\n- Visit the keeper’s workshop.',
      ],
      [
        3,
        'The bridge in the rain',
        'Stonebridge crossing',
        '**Bram held the bridge** while the villagers crossed. Kestrel found a safe path along the bank; Mira spent her reserves keeping the way lit.',
      ],
      [
        4,
        'The beacon at Greyhaven',
        'Greyhaven lighthouse',
        '## A light on the horizon\n\nWe reached **Greyhaven** at dusk. The lighthouse was silent, but a fresh trail led down to the sea caves.\n\n- Kestrel found the keeper’s brass compass.\n- Mira deciphered the inscription above the tide gate.\n- Bram held the bridge while the villagers crossed.\n\n**Next session:** follow the lanterns beneath the cliffs.',
      ],
    ] as const) {
      await request(ownerToken, `${campaignPath}/log`, 'POST', {
        sessionDate: `2026-09-${sessionNumber === 0 ? '04' : sessionNumber === 3 ? '11' : '18'}`,
        sessionNumber,
        title,
        location,
        body,
        visibility: 'campaign',
        xpAwards: characterIds.map((characterId) => ({
          characterId,
          amount: sessionNumber === 0 ? 0 : 3,
        })),
      });
    }
    const encounter = encounterOut.parse(
      await request(ownerToken, `${campaignPath}/encounters`, 'POST', {
        name: 'The tide-gate ambush',
        combatants: [
          ...characterIds.map((characterId) => ({ kind: 'pc', characterId })),
          {
            kind: 'npc',
            name: 'Tide-cave raider',
            basicSpeed: 5.5,
            dx: 11,
            maxHp: 12,
            currentHp: 8,
            move: 5,
            dodge: 8,
            dr: 2,
            maneuver: 'Attack',
          },
          {
            kind: 'npc',
            name: 'Hidden lantern keeper',
            basicSpeed: 5,
            dx: 10,
            maxHp: 10,
            hiddenFromPlayers: true,
            notes: 'Fen is a captive, not an enemy. Reveal after the gate opens.',
          },
        ],
      }),
    );
    const target = encounter.combatants.find((entry) => entry.characterId === characterIds[0]);
    const caster = encounter.combatants.find((entry) => entry.characterId === characterIds[1]);
    if (!target || !caster) throw new Error('Seed encounter is missing PCs');
    await request(ownerToken, `${campaignPath}/encounters/${encounter.id}/effects`, 'POST', {
      name: 'Guiding lantern',
      targetCombatantId: target.id,
      casterCombatantId: caster.id,
      duration: { unit: 'rounds', amount: 3 },
      maintenanceCost: 1,
      notes: 'Tracker-only reminder; intentionally not linked to an automatic sheet bonus.',
    });
    return { campaignId: campaign.id, created: true };
  });
}
