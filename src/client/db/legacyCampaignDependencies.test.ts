import { describe, expect, it } from 'vitest';
import type { OutboxEntry } from './dexie.ts';
import {
  inferLegacyCampaignDependency,
  legacyReferenceFields,
} from './legacyCampaignDependencies.ts';

const original = '0193b3c0-f1f0-7000-8000-000000000001';
const target = '0193b3c0-f1f0-7000-8000-000000000002';
const source = '0193b3c0-f1f0-7000-8000-000000000003';
const assignment = {
  prevValue: original,
  attemptedValue: target,
  enqueuedAt: '2026-09-10T00:00:02Z',
} as OutboxEntry;
const create = {
  entityClass: 'character_trait',
  entityId: 'trait',
  command: 'create',
  enqueuedAt: '2026-09-10T00:00:01Z',
  attemptedValue: { libraryTraitId: source },
} as OutboxEntry;

describe('legacy campaign dependency evidence', () => {
  it.each(['2026-09-10T00:00:01Z', '2026-09-10T00:00:02Z'])(
    'uses validated provenance across a rewritten or equal timestamp %s',
    (enqueuedAt) => {
      const op = { ...create, enqueuedAt };
      const snapshot = { sourceId: source, campaignId: target, sourceRevision: 1, effects: [] };
      expect(inferLegacyCampaignDependency(op, [assignment], snapshot)).toBe(true);
      expect(
        inferLegacyCampaignDependency(op, [assignment], { ...snapshot, campaignId: original }),
      ).toBe(false);
      expect(
        inferLegacyCampaignDependency(op, [assignment], { ...snapshot, sourceId: target }),
      ).toBeUndefined();
    },
  );
  it.each(Object.entries(legacyReferenceFields))(
    'uses matching undo provenance for %s',
    (entityClass, [store, field]) => {
      const op = { ...create, entityClass, attemptedValue: { [field]: source } } as OutboxEntry;
      const undo = {
        store,
        entityId: op.entityId,
        campaignId: original,
        before: { [field]: source },
        after: { [field]: null },
      };
      expect(
        inferLegacyCampaignDependency(
          op,
          [{ ...assignment, localCampaignTransferUndo: [undo] }],
          null,
        ),
      ).toBe(false);
      expect(
        inferLegacyCampaignDependency(
          op,
          [{ ...assignment, localCampaignTransferUndo: [{ ...undo, campaignId: target }] }],
          null,
        ),
      ).toBe(true);
      expect(
        inferLegacyCampaignDependency(
          op,
          [
            {
              ...assignment,
              localCampaignTransferUndo: [{ ...undo, before: { [field]: 'different' } }],
            },
          ],
          null,
        ),
      ).toBeUndefined();
    },
  );
  it('holds unprovable earlier/equal linked creates, while later and unlinked creates have safe ordering', () => {
    expect(inferLegacyCampaignDependency(create, [assignment], null)).toBeUndefined();
    expect(
      inferLegacyCampaignDependency(
        { ...create, enqueuedAt: assignment.enqueuedAt },
        [assignment],
        null,
      ),
    ).toBeUndefined();
    expect(
      inferLegacyCampaignDependency(
        { ...create, enqueuedAt: '2026-09-10T00:00:03Z' },
        [assignment],
        null,
      ),
    ).toBe(true);
    expect(
      inferLegacyCampaignDependency({ ...create, attemptedValue: {} }, [assignment], null),
    ).toBe(false);
    expect(
      inferLegacyCampaignDependency(
        { ...create, localWaitForCampaignAssignment: false },
        [assignment],
        null,
      ),
    ).toBe(false);
  });
});
