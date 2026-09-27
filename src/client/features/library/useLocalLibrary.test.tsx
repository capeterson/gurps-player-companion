import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedCalculation } from '../../../shared/domain/calculation.ts';
import { libraryTraitOut } from '../../../shared/schemas/campaignLibrary.ts';
import { getLocalDb, resetLocalDb } from '../../db/dexie.ts';
import { useLocalLibrary } from './useLocalLibrary.ts';

const CAMPAIGN_ID = '0193b3c0-f1f0-7000-8000-00000000f301';
const TRAIT_ID = '0193b3c0-f1f0-7000-8000-00000000f302';

afterEach(async () => {
  await resetLocalDb();
});

describe('useLocalLibrary pricing views', () => {
  it('marks queued pricing edits speculative without changing the stored revision', async () => {
    const db = getLocalDb();
    const stored = {
      ...libraryTraitOut.parse({
        id: TRAIT_ID,
        campaignId: CAMPAIGN_ID,
        name: 'Mutable Vision',
        key: 'mutable-vision',
        sourceKey: 'core',
        status: 'complete',
        role: 'template',
        preferredEdition: false,
        kind: 'advantage',
        basePoints: 5,
        pointsPerLevel: null,
        maxLevel: null,
        description: null,
        source: null,
        availableModifiers: [],
        variants: [],
        effects: [],
        tags: [],
        calculation: fixedCalculation({ points: { value: 5, unit: 'points' } }),
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      revision: 4,
    };
    const current = {
      ...stored,
      calculation: fixedCalculation({ points: { value: 8, unit: 'points' } }),
    };
    await db.campaignLibraryTraits.put(current);
    await db.outbox.put({
      clientOpId: 'pending-rule-edit',
      entityClass: 'campaign_library_trait',
      entityId: TRAIT_ID,
      command: 'patch',
      coalesceKey: `${TRAIT_ID}|entry`,
      attemptedValue: { calculation: current.calculation },
      prevValue: { calculation: stored.calculation },
      parentId: CAMPAIGN_ID,
      validationVersion: 1,
      status: 'pending',
      enqueuedAt: '2026-01-01T00:00:01.000Z',
      attemptCount: 0,
    });

    const { result } = renderHook(() => useLocalLibrary(CAMPAIGN_ID));
    await waitFor(() => expect(result.current?.traits[0]?.revision).toBe(-1));
    expect(result.current?.traits[0]?.calculation?.nodes[0]).toMatchObject({ value: 8 });
    const persisted = await db.campaignLibraryTraits.get(TRAIT_ID);
    expect(persisted?.revision).toBe(4);
    expect(persisted?.calculation?.nodes[0]).toMatchObject({ value: 8 });
  });
});
