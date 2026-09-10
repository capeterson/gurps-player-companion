import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedLibraryEffects } from '../../shared/schemas/libraryMechanics.ts';
import type { EntityClass, OperationOutcome } from '../../shared/schemas/sync.ts';
import { type LocalCharacter, type OutboxEntry, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { flashBus } from './flashBus.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { enqueueCreate, enqueueFieldPatch } from './outbox.ts';

const characterId = '0193b3c0-f1f0-7000-8000-00000000c001';
const campaignA = '0193b3c0-f1f0-7000-8000-00000000c002';
const campaignB = '0193b3c0-f1f0-7000-8000-00000000c003';
const campaignC = '0193b3c0-f1f0-7000-8000-00000000c004';
const sourceId = '0193b3c0-f1f0-7000-8000-00000000c005';
const traitId = '0193b3c0-f1f0-7000-8000-00000000c006';
const skillId = '0193b3c0-f1f0-7000-8000-00000000c007';
const effects = [{ target: 'dx' as const, value: 2, scaling: 'flat' as const }];
const snapshot = { sourceId, campaignId: campaignA, sourceRevision: 7, effects };
const patch = (campaignId: string | null) =>
  enqueueFieldPatch({
    entityClass: 'character',
    entityId: characterId,
    fieldPath: 'campaignId',
    attemptedValue: campaignId,
    humanName: 'campaign',
  });

function internals() {
  return getSyncOrchestrator() as unknown as {
    applyOutcomes(ops: OutboxEntry[], outcomes: OperationOutcome[]): Promise<void>;
    applyServerRow(
      entityClass: EntityClass,
      row: Record<string, unknown>,
      opts: object,
    ): Promise<void>;
  };
}

async function seed() {
  const db = getLocalDb();
  await db.characters.put({
    id: characterId,
    campaignId: campaignA,
    revision: 1,
  } as LocalCharacter);
  for (const [entityClass, entityId, field] of [
    ['character_trait', traitId, 'libraryTraitId'],
    ['character_skill', skillId, 'librarySkillId'],
  ] as const)
    await enqueueCreate({
      entityClass,
      entityId,
      characterId,
      attemptedValue: { characterId, name: 'Owned', points: 10, [field]: sourceId },
      localLibraryMechanics: snapshot,
    });
  await db.outbox.clear();
}

async function finish(op: OutboxEntry, status: 'applied' | 'rejected' | 'suspended') {
  await internals().applyOutcomes(
    [op],
    [
      {
        clientOpId: op.clientOpId,
        status,
        ...(status === 'applied' ? { newRevision: 5 } : { reason: 'Campaign unavailable' }),
      },
    ],
  );
}

async function queued() {
  const op = (await getLocalDb().outbox.toArray())[0];
  if (!op) throw new Error('Expected queued campaign patch');
  return op;
}

afterEach(async () => {
  resetSyncOrchestratorForTests();
  await resetLocalDb();
  vi.restoreAllMocks();
});

describe('local campaign transfer', () => {
  it('restores links for a queued return when the first transfer only received stale_base', async () => {
    await seed();
    const db = getLocalDb();
    await patch(campaignB);
    const first = await queued();
    await db.outbox.update(first.clientOpId, { status: 'in_flight' });
    await patch(campaignA);
    await internals().applyOutcomes(
      [first],
      [
        {
          clientOpId: first.clientOpId,
          status: 'stale_base',
          newRevision: 3,
          latestEntity: { id: characterId, campaignId: campaignA, revision: 3 },
        },
      ],
    );
    await finish(await queued(), 'applied');
    expect((await db.characterTraits.get(traitId))?.libraryTraitId).toBe(sourceId);
    expect((await db.characterSkills.get(skillId))?.libraryMechanics).toEqual(snapshot);
  });
  it('treats uppercase UUID assignments and coalesced returns as the same campaign', async () => {
    await seed();
    const db = getLocalDb();
    await patch(campaignA.toUpperCase());
    expect((await db.characterTraits.get(traitId))?.libraryTraitId).toBe(sourceId);
    await finish(await queued(), 'applied');
    await patch(campaignB.toUpperCase());
    await patch(campaignA.toUpperCase());
    expect((await queued()).attemptedValue).toBe(campaignA);
    expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(snapshot);
  });
  it.each([false, true])(
    'preserves undo after stale-base self-heal (newer transfer: %s)',
    async (newer) => {
      await seed();
      const db = getLocalDb();
      await patch(campaignB);
      const first = await queued();
      await db.outbox.update(first.clientOpId, { status: 'in_flight' });
      if (newer) await patch(campaignC);
      await internals().applyOutcomes(
        [first],
        [
          {
            clientOpId: first.clientOpId,
            status: 'stale_base',
            newRevision: 3,
            latestEntity: { id: characterId, campaignId: campaignA, revision: 3 },
          },
        ],
      );
      const retry = await queued();
      expect(retry.localCampaignTransferUndo).toHaveLength(2);
      if (newer) {
        await db.outbox.update(retry.clientOpId, { status: 'transient_retry', attemptCount: 4 });
        await getSyncOrchestrator().revertFailedOperation(retry.clientOpId);
      } else await finish(retry, 'rejected');
      expect((await db.characters.get(characterId))?.campaignId).toBe(campaignA);
      expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(snapshot);
      expect((await db.characterSkills.get(skillId))?.librarySkillId).toBe(sourceId);
    },
  );
  it('detaches every child kind and keeps unknown legacy declarations unknown', async () => {
    await seed();
    const db = getLocalDb();
    const children = [
      ['character_spell', db.characterSpells, 'librarySpellId'],
      ['character_language', db.characterLanguages, 'libraryLanguageId'],
      ['character_technique', db.characterTechniques, 'libraryTechniqueId'],
      ['character_inventory', db.characterInventory, 'libraryItemId'],
    ] as const;
    const ids: string[] = [];
    for (const [entityClass, , field] of children) {
      const entityId = crypto.randomUUID();
      ids.push(entityId);
      await enqueueCreate({
        entityClass,
        entityId,
        characterId,
        attemptedValue: { characterId, name: 'Owned', [field]: sourceId },
      });
    }
    await db.characterSkills.update(skillId, { libraryMechanics: null });
    await db.outbox.clear();
    await patch(campaignB);
    expect((await queued()).localCampaignTransferUndo).toHaveLength(6);
    const skill = await db.characterSkills.get(skillId);
    expect(ownedLibraryEffects(null, campaignB, skill?.libraryMechanics)).toBeNull();
    for (const [index, [, table, field]] of children.entries()) {
      const id = ids[index];
      if (!id) throw new Error('Missing fixture');
      expect(await table.get(id)).toHaveProperty(field, null);
    }
    await finish(await queued(), 'rejected');
    for (const [index, [, table, field]] of children.entries()) {
      const id = ids[index];
      if (!id) throw new Error('Missing fixture');
      expect(await table.get(id)).toHaveProperty(field, sourceId);
    }
  });

  it('does not resurrect deleted children or overwrite a newer reference on rollback', async () => {
    await seed();
    const db = getLocalDb();
    await patch(campaignB);
    const transfer = await queued();
    await db.characterSkills.delete(skillId);
    await enqueueFieldPatch({
      entityClass: 'character_trait',
      entityId: traitId,
      characterId,
      fieldPath: 'libraryTraitId',
      attemptedValue: campaignC,
    });
    await finish(transfer, 'rejected');
    expect(await db.characterSkills.get(skillId)).toBeUndefined();
    expect((await db.characterTraits.get(traitId))?.libraryTraitId).toBe(campaignC);
  });
  it.each(['applied', 'rejected', 'suspended'] as const)(
    'retains rules offline across reload and %s reconciliation',
    async (status) => {
      await seed();
      const db = getLocalDb();
      await patch(campaignB);
      const op = await queued();
      expect(op.attemptedValue).toBe(campaignB);
      expect(op.prevValue).toBe(campaignA);
      db.close();
      await db.open();
      const before = await db.characterTraits.get(traitId);
      expect(before?.libraryTraitId).toBeNull();
      expect(ownedLibraryEffects(null, campaignB, before?.libraryMechanics)).toEqual(effects);
      const flash = vi.fn();
      const off = flashBus.subscribe(`character:${characterId}:campaignId`, flash);
      await finish(op, status);
      off();
      expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(
        status === 'applied' ? { ...snapshot, detached: true } : snapshot,
      );
      expect((await db.characterSkills.get(skillId))?.librarySkillId).toBe(
        status === 'applied' ? null : sourceId,
      );
      if (status !== 'applied') {
        expect((await db.rejectionToasts.toArray())[0]?.reason).toBe('Campaign unavailable');
        expect(flash).toHaveBeenCalled();
      }
    },
  );

  it('protects detached links against stale child cursor rows while allowing other fields', async () => {
    await seed();
    const db = getLocalDb();
    const stale = await db.characterTraits.get(traitId);
    await patch(campaignB);
    await internals().applyServerRow('character_trait', { ...stale, notes: 'server note' }, {});
    expect(await db.characterTraits.get(traitId)).toMatchObject({
      libraryTraitId: null,
      libraryMechanics: { ...snapshot, detached: true },
      notes: 'server note',
    });
    await finish(await queued(), 'rejected');
    expect(await db.characterTraits.get(traitId)).toMatchObject({
      libraryTraitId: sourceId,
      notes: 'server note',
    });
  });

  it('coalesces repeated transfers and an unsent return without losing rollback data', async () => {
    await seed();
    const db = getLocalDb();
    await patch(campaignB);
    await patch(campaignC);
    expect((await queued()).localCampaignTransferUndo).toHaveLength(2);
    await patch(campaignA);
    expect((await db.characterTraits.get(traitId))?.libraryTraitId).toBe(sourceId);
    await patch(campaignB);
    await finish(await queued(), 'rejected');
    expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(snapshot);
  });

  it.each(['applied', 'rejected'] as const)(
    'keeps a slow follow-up transfer when the first is %s',
    async (firstStatus) => {
      await seed();
      const db = getLocalDb();
      await patch(campaignB);
      const first = await queued();
      await db.outbox.update(first.clientOpId, { status: 'in_flight' });
      await patch(campaignC);
      await enqueueFieldPatch({
        entityClass: 'character_trait',
        entityId: traitId,
        characterId,
        fieldPath: 'points',
        attemptedValue: 17,
      });
      await finish(first, firstStatus);
      expect((await db.characters.get(characterId))?.campaignId).toBe(campaignC);
      const next = (await db.outbox.toArray()).find((op) => op.fieldPath === 'campaignId');
      if (!next) throw new Error('Missing follow-up');
      await finish(next, 'rejected');
      expect((await db.characterTraits.get(traitId))?.points).toBe(17);
      expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(
        firstStatus === 'applied' ? { ...snapshot, detached: true } : snapshot,
      );
    },
  );

  it('restores links when the user discards a repeatedly failing transfer', async () => {
    await seed();
    await patch(campaignB);
    const op = await queued();
    await getLocalDb().outbox.update(op.clientOpId, { status: 'transient_retry', attemptCount: 4 });
    await getSyncOrchestrator().revertFailedOperation(op.clientOpId);
    expect((await getLocalDb().characterTraits.get(traitId))?.libraryMechanics).toEqual(snapshot);
  });
});
