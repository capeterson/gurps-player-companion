import { describe, expect, it } from 'vitest';
import { type EntityClass, entityClass } from '../../shared/schemas/sync.ts';
import type { SyncLogEntry } from '../db/dexie.ts';
import {
  focusedSyncLogValues,
  syncEntityLabel,
  syncEntityName,
  syncFieldLabel,
  syncLogEntityLink,
  syncLogTitle,
} from './syncLogPresentation.ts';

function entry(type: EntityClass, values: Partial<SyncLogEntry> = {}): SyncLogEntry {
  return {
    id: 'event',
    direction: 'push',
    result: 'synced',
    entityClass: type,
    entityId: 'entity',
    parentId: 'parent',
    command: 'patch',
    occurredAt: '2026-09-29T10:00:00Z',
    ...values,
  };
}

// Independent expectations include every registered protocol class, so adding a
// class requires deciding its meaningful title and actual supported destination.
const destinations: Record<EntityClass, [string, string]> = {
  character: ['Character', '/characters/entity'],
  character_trait: ['Trait', '/characters/parent#trait-entity'],
  character_skill: ['Skill', '/characters/parent#skill-entity'],
  character_spell: ['Spell', '/characters/parent#spell-entity'],
  character_inventory: ['Inventory item', '/characters/parent#inventory-entity'],
  character_language: ['Language', '/characters/parent'],
  character_technique: ['Technique', '/characters/parent'],
  character_combat: ['Combat state', '/characters/parent'],
  campaign: ['Campaign', '/campaigns/entity'],
  campaign_membership: ['Campaign member', '/campaigns/parent'],
  campaign_library_trait: ['Library trait', '/campaigns/parent/library?section=traits&open=entity'],
  campaign_library_skill: ['Library skill', '/campaigns/parent/library?section=skills&open=entity'],
  campaign_library_spell: ['Library spell', '/campaigns/parent/library?section=spells&open=entity'],
  campaign_library_item: ['Library item', '/campaigns/parent/library?section=items&open=entity'],
  campaign_library_language: [
    'Library language',
    '/campaigns/parent/library?section=languages&open=entity',
  ],
  campaign_library_technique: [
    'Library technique',
    '/campaigns/parent/library?section=techniques&open=entity',
  ],
  campaign_library_style: ['Library style', '/campaigns/parent/library?section=styles&open=entity'],
  campaign_library_enchantment: [
    'Library enchantment',
    '/campaigns/parent/library?section=enchantments&open=entity',
  ],
  campaign_library_active_effect: [
    'Library active effect',
    '/campaigns/parent/library?section=activeEffects&open=entity',
  ],
  campaign_library_source: [
    'Library source',
    '/campaigns/parent/library?section=sources&open=entity',
  ],
  campaign_library_modifier: [
    'Library modifier',
    '/campaigns/parent/library?section=modifiers&open=entity',
  ],
  adventure_log: ['Adventure log entry', '/campaigns/parent/log'],
};

describe('sync entity presentation', () => {
  it.each(entityClass.options)('has a domain title and supported route for %s', (type) => {
    const [label, href] = destinations[type];
    expect(syncEntityLabel(type)).toBe(label);
    expect(syncLogTitle(entry(type), { name: 'Named entry' })).toBe(
      `${label}: Named entry · Updated`,
    );
    expect(syncLogEntityLink(entry(type), { id: 'entity' })).toBe(href);
    expect(syncLogEntityLink(entry(type))).toBeUndefined();
    expect(syncLogEntityLink(entry(type, { command: 'delete' }))).toBeUndefined();
    expect(
      syncLogEntityLink(entry(type, { command: 'delete', result: 'rolled_back' }), {
        id: 'entity',
      }),
    ).toBe(href);
    expect(
      syncLogEntityLink(entry(type, { command: 'delete', result: 'reverted' }), { id: 'entity' }),
    ).toBe(href);
  });

  it('prefers historical entity names while current rows prove link existence', () => {
    const event = { ...entry('campaign_library_spell'), entityName: 'Sample Storm Spell' };
    expect(syncLogTitle(event, { name: 'Renamed spell' })).toBe(
      'Library spell: Sample Storm Spell · Updated',
    );
    expect(syncLogEntityLink(event, { campaignId: 'actual-campaign' })).toBe(
      '/campaigns/actual-campaign/library?section=spells&open=entity',
    );
    expect(syncLogTitle(entry('character_combat', { parentId: undefined }))).toBe(
      'Combat state · Updated',
    );
    expect(syncLogEntityLink(entry('character_combat', { parentId: undefined }), {})).toBe(
      '/characters/entity',
    );
  });

  it('retains old gesture labels, names scalars, and reports cycle failures', () => {
    expect(syncLogTitle(entry('character', { humanName: 'ST', fieldPath: 'st' }))).toBe('ST');
    expect(syncLogTitle(entry('character_combat', { fieldPath: 'currentHp' }))).toBe(
      'Combat state · Current HP',
    );
    expect(
      syncLogTitle(entry('campaign', { fieldPath: 'houseRules' }), { name: 'Lantern Coast' }),
    ).toBe('Campaign: Lantern Coast · House rules');
    expect(
      syncLogTitle(
        entry('campaign_library_spell', { humanName: 'library spell "Sample Storm Spell"' }),
      ),
    ).toBe('library spell "Sample Storm Spell"');
    expect(
      syncLogTitle(entry('campaign', { entityClass: undefined, reason: 'Download failed' })),
    ).toBe('Download failed');
    expect(
      syncLogTitle(
        entry('campaign', { source: 'Campaign settings', humanName: 'Campaign rules updated' }),
        { name: 'Lantern Coast' },
      ),
    ).toBe('Campaign: Lantern Coast · Campaign rules updated');
  });

  it('describes failed and reverted operations as intent, without claiming success', () => {
    const row = { id: 'entity', name: 'Lantern Coast' };
    expect(
      syncLogTitle(
        entry('campaign', {
          result: 'failed',
          source: 'Campaign settings',
          humanName: 'campaign rules updated',
        }),
        row,
      ),
    ).toBe('Campaign: Lantern Coast · Campaign settings');
    expect(
      syncLogTitle(
        entry('campaign', {
          command: 'delete',
          result: 'failed',
          source: 'Campaign deletion',
          humanName: 'campaign deleted',
        }),
        row,
      ),
    ).toBe('Campaign: Lantern Coast · Campaign deletion');
    expect(
      syncLogTitle(
        entry('campaign_library_spell', {
          command: 'delete',
          result: 'rolled_back',
        }),
        { name: 'Sample Storm Spell' },
      ),
    ).toBe('Library spell: Sample Storm Spell · Delete');
    expect(
      syncLogTitle(
        entry('character_skill', {
          command: 'create',
          result: 'reverted',
          entityName: 'Stealth',
        }),
      ),
    ).toBe('Skill: Stealth · Add');
    expect(
      syncLogTitle(
        entry('character_skill', {
          result: 'retrying',
          entityName: 'Stealth',
        }),
      ),
    ).toBe('Skill: Stealth · Update');
    expect(
      syncLogTitle(
        entry('character', {
          result: 'rolled_back',
          fieldPath: 'st',
          entityName: 'Ari',
        }),
      ),
    ).toBe('Character: Ari · ST');
  });

  it('bounds names, falls back to title/key and uses meaningful field labels', () => {
    expect(syncEntityName({ name: '  ', title: 'Session one' })).toBe('Session one');
    expect(syncEntityName({ key: 'sample storm spell' })).toBe('sample storm spell');
    expect(syncEntityName({ name: 'X'.repeat(500) })).toHaveLength(200);
    expect(syncEntityName({ name: 42 })).toBeUndefined();
    expect(syncFieldLabel('protectNaturalDr')).toBe('Protect natural DR');
    expect(syncFieldLabel('customCamelCase')).toBe('Custom camel case');
    expect(syncFieldLabel('skillPrerequisitePolicy')).toBe('Skill prerequisite policy');
  });
});

describe('focused sync values', () => {
  it('shows only changed patch fields, including nested changes; omitted body keys are not deletions', () => {
    expect(
      focusedSyncLogValues({
        command: 'patch',
        entityClass: 'campaign',
        previousValue: {
          name: 'Campaign',
          revision: 10,
          members: ['member'],
          houseRules: { protectNaturalDr: true, untouched: 1 },
        },
        newValue: {
          name: 'Campaign',
          revision: 11,
          houseRules: { protectNaturalDr: false, untouched: 1 },
        },
      }),
    ).toEqual({
      previousValue: { houseRules: { protectNaturalDr: true } },
      newValue: { houseRules: { protectNaturalDr: false } },
      changedFields: ['houseRules'],
    });
  });

  it('retains removed nested fields and scalar field values, including arrays', () => {
    expect(
      focusedSyncLogValues(
        entry('campaign', {
          previousValue: { houseRules: { removed: 2, retained: 1 } },
          newValue: { houseRules: { retained: 1 } },
        }),
      ),
    ).toEqual({
      previousValue: { houseRules: { removed: 2 } },
      newValue: { houseRules: {} },
      changedFields: ['houseRules'],
    });
    expect(
      focusedSyncLogValues(
        entry('character', { fieldPath: 'st', previousValue: 10, newValue: 12 }),
      ),
    ).toEqual({ previousValue: 10, newValue: 12, changedFields: ['st'] });
    expect(
      focusedSyncLogValues(
        entry('character', {
          fieldPath: 'tempEffects',
          previousValue: [],
          newValue: [{ id: 'effect', mods: { st: 1 } }],
        }),
      ),
    ).toEqual({
      previousValue: [],
      newValue: [{ id: 'effect', mods: { st: 1 } }],
      changedFields: ['tempEffects'],
    });
  });

  it('focuses a single object-valued field without changing its fieldPath or array semantics', () => {
    expect(
      focusedSyncLogValues(
        entry('campaign', {
          fieldPath: 'houseRules',
          previousValue: { protectNaturalDr: true, retained: 1 },
          newValue: { protectNaturalDr: false, retained: 1 },
        }),
      ),
    ).toEqual({
      previousValue: { protectNaturalDr: true },
      newValue: { protectNaturalDr: false },
      changedFields: ['houseRules'],
    });
  });

  it('does not report equal object fields with reordered keys and treats changed arrays atomically', () => {
    expect(
      focusedSyncLogValues(
        entry('campaign', {
          previousValue: { name: 'Same', rules: { a: 1, b: 2 }, values: ['a', 'b'] },
          newValue: { name: 'Same', rules: { b: 2, a: 1 }, values: ['b', 'a'] },
        }),
      ),
    ).toEqual({
      previousValue: { values: ['a', 'b'] },
      newValue: { values: ['b', 'a'] },
      changedFields: ['values'],
    });
    expect(
      focusedSyncLogValues(
        entry('campaign', {
          previousValue: { revision: 1, name: 'Same' },
          newValue: { revision: 2, name: 'Same' },
        }),
      ).changedFields,
    ).toEqual([]);
  });

  it('retains actual removed fields on pulls and strips bookkeeping from creates/deletes', () => {
    expect(
      focusedSyncLogValues(
        entry('campaign', { direction: 'pull', previousValue: { removed: 1 }, newValue: {} }),
      ),
    ).toEqual({ previousValue: { removed: 1 }, newValue: {}, changedFields: ['removed'] });
    expect(
      focusedSyncLogValues(
        entry('character_skill', {
          command: 'delete',
          previousValue: { id: 'entity', revision: 12, name: 'Stealth' },
        }),
      ),
    ).toEqual({ previousValue: { name: 'Stealth' }, newValue: undefined, changedFields: ['name'] });
  });

  it('focuses a rollback on the rejected keys instead of adding the full baseline row', () => {
    expect(
      focusedSyncLogValues(
        entry('campaign_library_spell', {
          result: 'rolled_back',
          previousValue: { points: 8 },
          newValue: {
            id: 'entity',
            name: 'Sample Storm Spell',
            points: 4,
            revision: 11,
            description: 'Untouched',
          },
        }),
      ),
    ).toEqual({ previousValue: { points: 8 }, newValue: { points: 4 }, changedFields: ['points'] });
    expect(
      focusedSyncLogValues(
        entry('campaign_library_spell', {
          direction: 'local',
          result: 'reverted',
          previousValue: { points: 8 },
          newValue: { id: 'entity', name: 'Sample Storm Spell', points: 4, revision: 11 },
        }),
      ),
    ).toEqual({ previousValue: { points: 8 }, newValue: { points: 4 }, changedFields: ['points'] });
  });

  it('preserves legacy truncation markers instead of pretending their metadata is the edited entity', () => {
    const marker = { truncated: true, preview: '{"name":', length: 5_000 };
    expect(
      focusedSyncLogValues(entry('campaign', { previousValue: {}, newValue: marker })),
    ).toEqual({ previousValue: {}, newValue: marker, changedFields: [] });
  });
});
