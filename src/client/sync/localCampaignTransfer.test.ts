import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedLibraryEffects } from '../../shared/schemas/libraryMechanics.ts';
import type { EntityClass, OperationOutcome } from '../../shared/schemas/sync.ts';
import { type LocalCharacter, type OutboxEntry, getLocalDb, resetLocalDb } from '../db/dexie.ts';
import { flashBus } from './flashBus.ts';
import { getSyncOrchestrator, resetSyncOrchestratorForTests } from './orchestrator.ts';
import { enqueueCreate, enqueueFieldPatch, readDrainableOps } from './outbox.ts';

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
  it('keeps destination creates behind a stale-base assignment retry', async () => {
    await seed();
    await patch(campaignB);
    const first = await queued();
    const id = crypto.randomUUID();
    await enqueueCreate({
      entityClass: 'character_trait',
      entityId: id,
      characterId,
      attemptedValue: { name: 'B rules', libraryTraitId: sourceId },
      localLibraryMechanics: { ...snapshot, campaignId: campaignB },
    });
    await internals().applyOutcomes(
      [first],
      [
        {
          clientOpId: first.clientOpId,
          status: 'stale_base',
          latestEntity: { id: characterId, campaignId: campaignA, revision: 10 },
        },
      ],
    );
    const ready = await readDrainableOps(50);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.fieldPath).toBe('campaignId');
    const retry = ready[0];
    if (!retry) throw new Error('Missing retry');
    await finish(retry, 'applied');
    expect((await readDrainableOps(50)).map((op) => op.entityId)).toEqual([id]);
  });
  it.each(['pending', 'transient_retry'] as const)(
    'reclassifies a %s destination create before the next transfer generation',
    async (status) => {
      await seed();
      const db = getLocalDb();
      await patch(campaignB);
      const first = await queued();
      const id = crypto.randomUUID();
      await enqueueCreate({
        entityClass: 'character_skill',
        entityId: id,
        characterId,
        attemptedValue: { name: 'B rules', librarySkillId: sourceId },
        localLibraryMechanics: { ...snapshot, campaignId: campaignB },
      });
      const create = (await db.outbox.toArray()).find((op) => op.entityId === id);
      if (!create) throw new Error('Missing create');
      await finish(first, 'applied');
      await db.outbox.update(create.clientOpId, {
        status,
        ...(status === 'transient_retry'
          ? { nextEarliestAttemptAt: new Date(Date.now() + 60000).toISOString() }
          : {}),
      });
      db.close();
      await db.open();
      await patch(campaignC);
      expect((await db.outbox.get(create.clientOpId))?.localWaitForCampaignAssignment).toBe(false);
      expect((await readDrainableOps(50)).map((op) => op.clientOpId)).toEqual(
        status === 'pending' ? [create.clientOpId] : [],
      );
      await finish(create, 'applied');
      const [second] = await readDrainableOps(50);
      expect(second?.attemptedValue).toBe(campaignC);
    },
  );
  it('refreshes rollback metadata while a child relink is pending and both edits are rejected', async () => {
    await seed();
    const db = getLocalDb();
    const original = await db.characterTraits.get(traitId);
    await patch(campaignB);
    const sent = await queued();
    await enqueueFieldPatch({
      entityClass: 'character_trait',
      entityId: traitId,
      characterId,
      fieldPath: 'libraryTraitId',
      attemptedValue: campaignC,
    });
    const relink = (await db.outbox.toArray()).find((op) => op.entityId === traitId);
    if (!relink) throw new Error('Missing relink');
    const updated = { ...snapshot, sourceRevision: 8, effects: [{ ...effects[0], value: 5 }] };
    await internals().applyServerRow(
      'character_trait',
      { ...original, revision: 9, libraryMechanics: updated },
      {},
    );
    expect((await db.characterTraits.get(traitId))?.libraryTraitId).toBe(campaignC);
    await finish(relink, 'rejected');
    await finish(sent, 'rejected');
    expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(updated);
    expect((await db.characterTraits.get(traitId))?.libraryTraitId).toBe(sourceId);
  });
  it.each(['pending', 'transient_retry', 'in_flight'] as const)(
    'waits for an earlier %s create before transferring, then releases destination creates',
    async (status) => {
      await seed();
      const db = getLocalDb();
      const oldId = crypto.randomUUID();
      await enqueueCreate({
        entityClass: 'character_trait',
        entityId: oldId,
        characterId,
        attemptedValue: { name: 'Original', libraryTraitId: sourceId },
        localLibraryMechanics: snapshot,
      });
      const old = await queued();
      await db.outbox.update(old.clientOpId, {
        status,
        ...(status === 'transient_retry'
          ? { nextEarliestAttemptAt: new Date(Date.now() + 60000).toISOString() }
          : {}),
      });
      await patch(campaignB);
      const newId = crypto.randomUUID();
      await enqueueCreate({
        entityClass: 'character_trait',
        entityId: newId,
        characterId,
        attemptedValue: { name: 'Destination', libraryTraitId: campaignC },
        localLibraryMechanics: { ...snapshot, sourceId: campaignC, campaignId: campaignB },
      });
      const ready = await readDrainableOps(50);
      expect(ready.map((op) => op.entityId)).toEqual(status === 'pending' ? [oldId] : []);
      // A transient outcome must not release the assignment from the same batch.
      await internals().applyOutcomes([old], [{ clientOpId: old.clientOpId, status: 'transient' }]);
      expect(await readDrainableOps(50)).toHaveLength(0);
      await finish(old, 'applied');
      const [transfer] = await readDrainableOps(50);
      expect(transfer?.fieldPath).toBe('campaignId');
      if (!transfer) throw new Error('Missing transfer');
      await finish(transfer, 'applied');
      expect((await readDrainableOps(50)).map((op) => op.entityId)).toEqual([newId]);
    },
  );
  it.each(['rejected', 'retry', 'queued-retry', 'coalesced-return'] as const)(
    'retains refreshed child rollback state after %s, including a sent request and reload',
    async (ending) => {
      await seed();
      const db = getLocalDb();
      const serverTrait = await db.characterTraits.get(traitId);
      const serverSkill = await db.characterSkills.get(skillId);
      await patch(campaignB);
      const sent = await queued();
      if (ending !== 'coalesced-return')
        await db.outbox.update(sent.clientOpId, { status: 'in_flight' });
      if (ending === 'queued-retry') await patch(campaignC);
      const updated = { ...snapshot, sourceRevision: 8, effects: [{ ...effects[0], value: 5 }] };
      await internals().applyServerRow(
        'character_trait',
        { ...serverTrait, revision: 9, libraryMechanics: updated },
        {},
      );
      await internals().applyServerRow(
        'character_skill',
        { ...serverSkill, revision: 9, libraryMechanics: updated },
        {},
      );
      expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual({
        ...snapshot,
        detached: true,
      });
      expect((await db.characterSkills.get(skillId))?.librarySkillId).toBeNull();
      db.close();
      await db.open();
      if (ending === 'coalesced-return') await patch(campaignA);
      else if (ending === 'rejected') await finish(sent, 'rejected');
      else {
        await internals().applyOutcomes(
          [sent],
          [
            {
              clientOpId: sent.clientOpId,
              status: 'stale_base',
              latestEntity: { id: characterId, campaignId: campaignA, revision: 3 },
            },
          ],
        );
        await finish(await queued(), 'rejected');
      }
      expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(updated);
      expect((await db.characterSkills.get(skillId))?.libraryMechanics).toEqual(updated);
      expect((await db.characterTraits.get(traitId))?.libraryTraitId).toBe(sourceId);
    },
  );
  it('does not adopt a destination campaign declaration as original-campaign rollback state', async () => {
    await seed();
    const db = getLocalDb();
    const serverTrait = await db.characterTraits.get(traitId);
    await patch(campaignB);
    const sent = await queued();
    await internals().applyServerRow(
      'character_trait',
      {
        ...serverTrait,
        libraryMechanics: { ...snapshot, campaignId: campaignB, sourceRevision: 9 },
      },
      {},
    );
    await finish(sent, 'rejected');
    expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(snapshot);
  });
  it.each(['pending', 'transient_retry', 'in_flight'] as const)(
    'holds destination creates and their patches behind a %s campaign assignment',
    async (status) => {
      await seed();
      const db = getLocalDb();
      await patch(campaignB);
      const transfer = await queued();
      await db.outbox.update(transfer.clientOpId, {
        status,
        ...(status === 'transient_retry'
          ? { nextEarliestAttemptAt: new Date(Date.now() + 60000).toISOString() }
          : {}),
      });
      const ids: string[] = [];
      for (const [entityClass, field] of [
        ['character_trait', 'libraryTraitId'],
        ['character_skill', 'librarySkillId'],
      ] as const) {
        const entityId = crypto.randomUUID();
        ids.push(entityId);
        await enqueueCreate({
          entityClass,
          entityId,
          characterId,
          attemptedValue: { name: 'Destination', [field]: sourceId },
          localLibraryMechanics: { ...snapshot, campaignId: campaignB },
        });
        await enqueueFieldPatch({
          entityClass,
          entityId,
          characterId,
          fieldPath: 'points',
          attemptedValue: 20,
        });
      }
      await enqueueFieldPatch({
        entityClass: 'character',
        entityId: characterId,
        fieldPath: 'notes',
        attemptedValue: 'Independent',
      });
      db.close();
      await db.open();
      const ready = await readDrainableOps(50);
      expect(ready.some((op) => ids.includes(op.entityId))).toBe(false);
      expect(ready.some((op) => op.fieldPath === 'notes')).toBe(true);
      expect(ready.some((op) => op.clientOpId === transfer.clientOpId)).toBe(status === 'pending');
      // Coalescing changes the assignment operation ID, but the dependency survives.
      if (status !== 'in_flight') await patch(campaignC);
      expect((await readDrainableOps(50)).some((op) => ids.includes(op.entityId))).toBe(false);
      const current = (await db.outbox.toArray()).find((op) => op.fieldPath === 'campaignId');
      if (!current) throw new Error('Missing assignment');
      await finish(current, 'applied');
      const released = await readDrainableOps(50);
      expect(released.filter((op) => ids.includes(op.entityId))).toHaveLength(4);
      await internals().applyOutcomes(
        released,
        released.map((op) => ({
          clientOpId: op.clientOpId,
          status: 'applied',
          newRevision: 10,
        })),
      );
      expect(await db.outbox.count()).toBe(0);
      expect((await db.characterTraits.get(ids[0] ?? ''))?.points).toBe(20);
    },
  );
  it('does not hold a create queued before a campaign transfer as a destination create', async () => {
    await seed();
    const id = crypto.randomUUID();
    await enqueueCreate({
      entityClass: 'character_trait',
      entityId: id,
      characterId,
      attemptedValue: { name: 'Original', libraryTraitId: sourceId },
      localLibraryMechanics: snapshot,
    });
    await patch(campaignB);
    expect((await readDrainableOps(50)).some((op) => op.entityId === id)).toBe(true);
  });
  it('keeps newly arrived destination item and spell links after a delayed transfer acknowledgement', async () => {
    await seed();
    const db = getLocalDb();
    await patch(campaignB);
    const sent = await queued();
    await db.outbox.update(sent.clientOpId, { status: 'in_flight' });
    const itemId = crypto.randomUUID();
    const spellId = crypto.randomUUID();
    await internals().applyServerRow(
      'character_inventory',
      { id: itemId, characterId, name: 'Destination item', libraryItemId: sourceId },
      {},
    );
    await internals().applyServerRow(
      'character_spell',
      { id: spellId, characterId, name: 'Destination spell', librarySpellId: sourceId },
      {},
    );
    await finish(sent, 'applied');
    expect((await db.characterInventory.get(itemId))?.libraryItemId).toBe(sourceId);
    expect((await db.characterSpells.get(spellId))?.librarySpellId).toBe(sourceId);
  });
  it('detaches proven old-campaign rules and preserves new references without campaign evidence', async () => {
    await seed();
    const db = getLocalDb();
    const rows = [
      [
        'character_trait',
        db.characterTraits,
        'libraryTraitId',
        { ...(await db.characterTraits.get(traitId)) },
      ],
      [
        'character_skill',
        db.characterSkills,
        'librarySkillId',
        { ...(await db.characterSkills.get(skillId)) },
      ],
      ['character_spell', db.characterSpells, 'librarySpellId', {}],
      ['character_inventory', db.characterInventory, 'libraryItemId', {}],
      ['character_language', db.characterLanguages, 'libraryLanguageId', {}],
      ['character_technique', db.characterTechniques, 'libraryTechniqueId', {}],
    ] as const;
    await db.characterTraits.clear();
    await db.characterSkills.clear();
    await patch(campaignB);
    const sent = await queued();
    const ids: string[] = [];
    for (const [entityClass, table, field, data] of rows) {
      const id = crypto.randomUUID();
      ids.push(id);
      await internals().applyServerRow(
        entityClass,
        { ...data, id, characterId, [field]: sourceId },
        {},
      );
      expect(await table.get(id)).toHaveProperty(
        field,
        entityClass === 'character_trait' || entityClass === 'character_skill' ? null : sourceId,
      );
    }
    expect((await queued()).localCampaignTransferUndo).toHaveLength(2);
    await finish(sent, 'rejected');
    for (const [index, [, table, field]] of rows.entries()) {
      const id = ids[index];
      if (!id) throw new Error('Missing fixture');
      expect(await table.get(id)).toHaveProperty(field, sourceId);
    }
  });
  it.each(['applied', 'rejected', 'stale_base'] as const)(
    'retains newly downloaded child rules through %s using durable transfer undo',
    async (status) => {
      await seed();
      const db = getLocalDb();
      const incoming = await db.characterTraits.get(traitId);
      await db.characterTraits.delete(traitId);
      await patch(campaignB);
      const beforePull = await queued();
      await db.outbox.update(beforePull.clientOpId, { status: 'in_flight' });
      await internals().applyServerRow('character_trait', { ...incoming }, {});
      const owned = await db.characterTraits.get(traitId);
      expect(owned?.libraryTraitId).toBeNull();
      expect(ownedLibraryEffects(null, campaignB, owned?.libraryMechanics)).toEqual(effects);
      db.close();
      await db.open();
      expect((await queued()).localCampaignTransferUndo).toHaveLength(2);
      if (status === 'stale_base') {
        await patch(campaignC);
        await internals().applyOutcomes(
          [beforePull],
          [
            {
              clientOpId: beforePull.clientOpId,
              status: 'stale_base',
              newRevision: 4,
              latestEntity: { id: characterId, campaignId: campaignA, revision: 4 },
            },
          ],
        );
        await finish(await queued(), 'rejected');
      } else await finish(beforePull, status);
      expect((await db.characterTraits.get(traitId))?.libraryMechanics).toEqual(
        status === 'applied' ? { ...snapshot, detached: true } : snapshot,
      );
    },
  );

  it('leaves a newly downloaded destination definition linked', async () => {
    await seed();
    const db = getLocalDb();
    const incoming = await db.characterSkills.get(skillId);
    await db.characterSkills.delete(skillId);
    await patch(campaignB);
    await internals().applyServerRow(
      'character_skill',
      { ...incoming, libraryMechanics: { ...snapshot, campaignId: campaignB } },
      {},
    );
    expect((await db.characterSkills.get(skillId))?.librarySkillId).toBe(sourceId);
    expect((await queued()).localCampaignTransferUndo).toHaveLength(1);
  });
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
