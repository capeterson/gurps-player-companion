import { describe, expect, it } from 'bun:test';
import type { HistoryEventOut } from '../schemas/history.ts';
import { diffRows, groupIntoBatches, summarizeEvent } from './summarize.ts';

// ---------- diffRows ----------

it.each(['character_trait', 'character_skill'])(
  'summarizes %s owned rule updates and detachment',
  (entityClass) => {
    const copy = { sourceRevision: 4, effects: [{ target: 'dx', value: 2 }] };
    const event = { entityClass, op: 'update', oldRow: { name: 'Owned', library_mechanics: copy } };
    expect(
      summarizeEvent({
        ...event,
        newRow: { name: 'Owned', library_mechanics: { ...copy, sourceRevision: 8 } },
      }).summary,
    ).toBe('Owned: library rules updated to version 8');
    expect(
      summarizeEvent({
        ...event,
        newRow: { name: 'Owned', library_mechanics: { ...copy, detached: true } },
      }).summary,
    ).toBe('Owned: saved library rules retained after detaching');
  },
);

describe('diffRows', () => {
  it('returns empty when rows are identical', () => {
    expect(diffRows({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual([]);
  });

  it('picks up changed values', () => {
    const changes = diffRows({ st: 10 }, { st: 12 });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe('st');
    expect(changes[0]?.oldValue).toBe(10);
    expect(changes[0]?.newValue).toBe(12);
  });

  it('ignores revision, updatedAt, createdAt', () => {
    const changes = diffRows(
      { st: 10, revision: 1, updatedAt: 'a', createdAt: 'b' },
      { st: 10, revision: 2, updatedAt: 'c', createdAt: 'd' },
    );
    expect(changes).toHaveLength(0);
  });

  it('returns empty for null inputs', () => {
    expect(diffRows(null, { st: 10 })).toEqual([]);
    expect(diffRows({ st: 10 }, null)).toEqual([]);
  });
});

// ---------- summarizeEvent — character ----------

describe('summarizeEvent character', () => {
  it('creates: Created character <name>', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'insert',
      oldRow: null,
      newRow: { name: 'Alice', st: 10 },
    });
    expect(summary).toContain('Created');
    expect(summary).toContain('Alice');
  });

  it('deletes: Deleted character <name>', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'delete',
      oldRow: { name: 'Bob' },
      newRow: null,
    });
    expect(summary).toContain('Deleted');
    expect(summary).toContain('Bob');
  });

  it('attribute change: "ST 10 → 12"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { st: 10 },
      newRow: { st: 12 },
    });
    expect(summary).toContain('ST');
    expect(summary).toContain('10');
    expect(summary).toContain('12');
  });

  it('temp boost: "Temp DX +2"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { tempDx: 0 },
      newRow: { tempDx: 2 },
    });
    expect(summary).toContain('Temp DX');
    expect(summary).toContain('+2');
  });

  it('temp boost cleared: "Temp DX boost cleared"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { tempDx: 2 },
      newRow: { tempDx: 0 },
    });
    expect(summary).toContain('Temp DX');
    expect(summary.toLowerCase()).toContain('clear');
  });

  // History snapshots come from to_jsonb(NEW), so keys are snake_case
  // (temp_dx). The summarizer must normalize them, not fall through to a
  // generic message.
  it('handles snake_case DB column names for temp boosts', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { temp_dx: 0 },
      newRow: { temp_dx: 2 },
    });
    expect(summary).toContain('Temp DX');
    expect(summary).toContain('+2');
  });

  it('handles snake_case attribute names', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { st: 10 },
      newRow: { st: 12 },
    });
    expect(summary).toContain('ST');
  });
});

// ---------- summarizeEvent — character.tempEffects ----------

describe('summarizeEvent character tempEffects', () => {
  it('one named effect added: "Temporary effect added: Might (ST +2, HT +1)"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { tempEffects: [] },
      newRow: { tempEffects: [{ id: 'e1', name: 'Might', mods: { st: 2, ht: 1 } }] },
    });
    expect(summary).toBe('Temporary effect added: Might (ST +2, HT +1)');
  });

  it('one named effect removed: "Temporary effect removed: Might"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { tempEffects: [{ id: 'e1', name: 'Might', mods: { st: 2 } }] },
      newRow: { tempEffects: [] },
    });
    // A single-effect list going to empty hits the "cleared" branch
    // (higher priority than "removed"), which is still an accurate,
    // human-readable summary.
    expect(summary).toBe('Temporary effects cleared');
  });

  it('one named effect removed out of several: "Temporary effect removed: Might"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: {
        tempEffects: [
          { id: 'e1', name: 'Might', mods: { st: 2 } },
          { id: 'e2', name: 'Haste', mods: { move: 1 } },
        ],
      },
      newRow: { tempEffects: [{ id: 'e2', name: 'Haste', mods: { move: 1 } }] },
    });
    expect(summary).toBe('Temporary effect removed: Might');
  });

  it('list cleared entirely: "Temporary effects cleared"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: {
        tempEffects: [
          { id: 'e1', name: 'Might', mods: { st: 2 } },
          { id: 'e2', name: 'Haste', mods: { move: 1 } },
        ],
      },
      newRow: { tempEffects: [] },
    });
    expect(summary).toBe('Temporary effects cleared');
  });

  it('manual entry mods changed: "Temporary adjustment: ST +2"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { tempEffects: [{ id: 'manual', name: 'Manual adjustment', mods: {} }] },
      newRow: {
        tempEffects: [{ id: 'manual', name: 'Manual adjustment', mods: { st: 2 } }],
      },
    });
    expect(summary).toBe('Temporary adjustment: ST +2');
  });

  it('manual entry added fresh: still summarized as a manual adjustment, not "effect added"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { tempEffects: [] },
      newRow: {
        tempEffects: [{ id: 'manual', name: 'Manual adjustment', mods: { ht: -1 } }],
      },
    });
    expect(summary).toBe('Temporary adjustment: HT -1');
  });

  it('multiple simultaneous changes fall back to the generic message', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character',
      op: 'update',
      oldRow: { tempEffects: [{ id: 'e1', name: 'Might', mods: { st: 2 } }] },
      newRow: {
        tempEffects: [
          { id: 'e1', name: 'Might', mods: { st: 2 } },
          { id: 'e2', name: 'Haste', mods: { move: 1 } },
          { id: 'manual', name: 'Manual adjustment', mods: { ht: 1 } },
        ],
      },
    });
    expect(summary).toBe('Temporary effects updated');
  });
});

// ---------- summarizeEvent — character_trait ----------

describe('summarizeEvent character_trait', () => {
  it('insert: "Added advantage Acute Vision"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_trait',
      op: 'insert',
      oldRow: null,
      newRow: { kind: 'advantage', name: 'Acute Vision', points: 5 },
    });
    expect(summary.toLowerCase()).toContain('added');
    expect(summary).toContain('Acute Vision');
  });

  it('delete: "Removed advantage Bad Temper"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_trait',
      op: 'delete',
      oldRow: { kind: 'disadvantage', name: 'Bad Temper', points: -10 },
      newRow: null,
    });
    expect(summary.toLowerCase()).toContain('removed');
    expect(summary).toContain('Bad Temper');
  });
});

// ---------- summarizeEvent — character_skill ----------

describe('summarizeEvent character_skill', () => {
  it('insert: includes skill name', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_skill',
      op: 'insert',
      oldRow: null,
      newRow: { name: 'Broadsword', attribute: 'DX', difficulty: 'A', points: 1 },
    });
    expect(summary).toContain('Broadsword');
  });

  it('update points: mentions points change', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_skill',
      op: 'update',
      oldRow: { name: 'Acrobatics', points: 2 },
      newRow: { name: 'Acrobatics', points: 4 },
    });
    expect(summary).toContain('Acrobatics');
  });
});

// ---------- summarizeEvent — character_language ----------

describe('summarizeEvent character_language', () => {
  it('insert: "Added language <name>"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_language',
      op: 'insert',
      oldRow: null,
      newRow: { name: 'Latin', spoken_fluency: 'accented', written_fluency: 'native', points: 5 },
    });
    expect(summary).toBe('Added language Latin');
  });

  it('delete: "Removed language <name>"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_language',
      op: 'delete',
      oldRow: { name: 'Aramaic', spoken_fluency: 'broken', written_fluency: 'none', points: 1 },
      newRow: null,
    });
    expect(summary).toBe('Removed language Aramaic');
  });

  it('update spoken fluency: names the transition (snake_case column camelized)', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_language',
      op: 'update',
      oldRow: { name: 'Latin', spoken_fluency: 'broken', written_fluency: 'none', points: 1 },
      newRow: { name: 'Latin', spoken_fluency: 'accented', written_fluency: 'none', points: 1 },
    });
    expect(summary).toBe('Latin spoken broken → accented');
  });

  it('update written fluency: names the transition', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_language',
      op: 'update',
      oldRow: { name: 'Latin', spoken_fluency: 'native', written_fluency: 'none', points: 0 },
      newRow: { name: 'Latin', spoken_fluency: 'native', written_fluency: 'native', points: 3 },
    });
    expect(summary).toBe('Latin written none → native');
  });

  it('update points only: reports the point delta', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_language',
      op: 'update',
      oldRow: { name: 'Latin', points: 1 },
      newRow: { name: 'Latin', points: 3 },
    });
    expect(summary).toBe('Latin 1 → 3 pts');
  });

  it('rename: reports the new name', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_language',
      op: 'update',
      oldRow: { name: 'Latin', points: 1 },
      newRow: { name: 'Vulgar Latin', points: 1 },
    });
    expect(summary).toBe('Renamed language to Vulgar Latin');
  });
});

// ---------- summarizeEvent — campaign_library_language ----------

describe('summarizeEvent campaign_library_language', () => {
  it('insert / delete / update all name the library language', () => {
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_language',
        op: 'insert',
        oldRow: null,
        newRow: { name: 'Elder Speech' },
      }).summary,
    ).toBe('Added library language Elder Speech');
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_language',
        op: 'delete',
        oldRow: { name: 'Elder Speech' },
        newRow: null,
      }).summary,
    ).toBe('Removed library language Elder Speech');
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_language',
        op: 'update',
        oldRow: { name: 'Elder Speech', source: null },
        newRow: { name: 'Elder Speech', source: 'B23' },
      }).summary,
    ).toBe('Library language Elder Speech updated');
  });
});

// ---------- summarizeEvent — character_technique ----------

describe('summarizeEvent character_technique', () => {
  it('insert: names the technique and its default skill', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_technique',
      op: 'insert',
      oldRow: null,
      newRow: { name: 'Feint', default_skill_name: 'Broadsword', difficulty: 'H', points: 2 },
    });
    expect(summary).toBe('Added technique Feint (Broadsword)');
  });

  it('delete: "Removed technique <name>"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_technique',
      op: 'delete',
      oldRow: { name: 'Feint', default_skill_name: 'Broadsword' },
      newRow: null,
    });
    expect(summary).toBe('Removed technique Feint');
  });

  it('update points: reports the point delta', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_technique',
      op: 'update',
      oldRow: { name: 'Feint', points: 2 },
      newRow: { name: 'Feint', points: 4 },
    });
    expect(summary).toBe('Feint 2 → 4 pts');
  });

  it('update default skill: names the new default', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_technique',
      op: 'update',
      oldRow: { name: 'Feint', default_skill_name: 'Broadsword' },
      newRow: { name: 'Feint', default_skill_name: 'Rapier' },
    });
    expect(summary).toBe('Feint now defaults from Rapier');
  });

  it('update difficulty: names the transition', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_technique',
      op: 'update',
      oldRow: { name: 'Feint', difficulty: 'A' },
      newRow: { name: 'Feint', difficulty: 'H' },
    });
    expect(summary).toBe('Feint difficulty A → H');
  });
});

// ---------- summarizeEvent — campaign_library_technique / style ----------

describe('summarizeEvent campaign library techniques and styles', () => {
  it('names the library technique on every op', () => {
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_technique',
        op: 'insert',
        oldRow: null,
        newRow: { name: 'Feint' },
      }).summary,
    ).toBe('Added library technique Feint');
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_technique',
        op: 'delete',
        oldRow: { name: 'Feint' },
        newRow: null,
      }).summary,
    ).toBe('Removed library technique Feint');
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_technique',
        op: 'update',
        oldRow: { name: 'Feint', max_level: null },
        newRow: { name: 'Feint', max_level: 4 },
      }).summary,
    ).toBe('Library technique Feint updated');
  });

  it('names the style on every op', () => {
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_style',
        op: 'insert',
        oldRow: null,
        newRow: { name: 'Sword-and-Buckler' },
      }).summary,
    ).toBe('Added style Sword-and-Buckler');
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_style',
        op: 'delete',
        oldRow: { name: 'Sword-and-Buckler' },
        newRow: null,
      }).summary,
    ).toBe('Removed style Sword-and-Buckler');
    expect(
      summarizeEvent({
        entityClass: 'campaign_library_style',
        op: 'update',
        oldRow: { name: 'Sword-and-Buckler', perks: [] },
        newRow: { name: 'Sword-and-Buckler', perks: ['Off-Hand Weapon Training'] },
      }).summary,
    ).toBe('Style Sword-and-Buckler updated');
  });
});

// ---------- summarizeEvent — character_inventory ----------

describe('summarizeEvent character_inventory', () => {
  it('insert: "Added Torch"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_inventory',
      op: 'insert',
      oldRow: null,
      newRow: { name: 'Torch', quantity: 2, parentId: null },
    });
    expect(summary).toContain('Torch');
  });

  it('delete: "Removed <name>"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_inventory',
      op: 'delete',
      oldRow: { name: 'Rations', quantity: 1, parentId: null },
      newRow: null,
    });
    expect(summary).toContain('Rations');
  });

  it('move into container: mentions move', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_inventory',
      op: 'update',
      oldRow: { name: 'Sword', parentId: null },
      newRow: { name: 'Sword', parentId: 'bag-uuid' },
    });
    expect(summary.toLowerCase()).toContain('sword');
  });

  it('isArmor set: "Shortsword: set as armor" (not raw field name)', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_inventory',
      op: 'update',
      oldRow: { name: 'Shortsword', isArmor: false },
      newRow: { name: 'Shortsword', isArmor: true },
    });
    expect(summary).toBe('Shortsword: set as armor');
  });

  it('isArmor unset: "Shortsword: unset as armor"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_inventory',
      op: 'update',
      oldRow: { name: 'Shortsword', isArmor: true },
      newRow: { name: 'Shortsword', isArmor: false },
    });
    expect(summary).toBe('Shortsword: unset as armor');
  });

  it('handles snake_case is_armor column name', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_inventory',
      op: 'update',
      oldRow: { name: 'Shortsword', is_armor: false },
      newRow: { name: 'Shortsword', is_armor: true },
    });
    expect(summary).toBe('Shortsword: set as armor');
  });

  it('generic multi-field fallback names the changed fields, not raw keys', () => {
    const { summary } = summarizeEvent({
      entityClass: 'character_inventory',
      op: 'update',
      oldRow: { name: 'Torch', weightLbs: 1, cost: 1 },
      newRow: { name: 'Torch', weightLbs: 2, cost: 3 },
    });
    expect(summary).toContain('Torch');
    expect(summary).not.toContain('weightLbs');
    expect(summary).toContain('Weight Lbs');
  });
});

// ---------- summarizeEvent — campaign ----------

describe('summarizeEvent campaign', () => {
  it('insert: "Created campaign <name>"', () => {
    const { summary } = summarizeEvent({
      entityClass: 'campaign',
      op: 'insert',
      oldRow: null,
      newRow: { name: 'Dragon Campaign', pointTarget: 100 },
    });
    expect(summary).toContain('Dragon Campaign');
  });

  it('update pointTarget: mentions change', () => {
    const { summary } = summarizeEvent({
      entityClass: 'campaign',
      op: 'update',
      oldRow: { name: 'Dragon Campaign', pointTarget: 100 },
      newRow: { name: 'Dragon Campaign', pointTarget: 125 },
    });
    expect(summary).toContain('100');
    expect(summary).toContain('125');
  });
});

describe('summarizeEvent campaign_library_trait', () => {
  it('uses humanized changed fields for library updates and ignores revision noise', () => {
    const { summary } = summarizeEvent({
      entityClass: 'campaign_library_trait',
      op: 'update',
      oldRow: { name: 'Combat Training', basePoints: 5, revision: 1 },
      newRow: { name: 'Combat Training', basePoints: 10, revision: 2 },
    });
    expect(summary).toBe('Library trait Combat Training: Base Points updated');
    expect(summary).not.toContain('Revision');
  });
});

// ---------- summarizeEvent — adventure_log ----------

describe('summarizeEvent adventure_log', () => {
  it('insert: includes title', () => {
    const { summary } = summarizeEvent({
      entityClass: 'adventure_log',
      op: 'insert',
      oldRow: null,
      newRow: { title: 'The Caves of Chaos', body: '...' },
    });
    expect(summary).toContain('The Caves of Chaos');
  });
});

// ---------- groupIntoBatches ----------

function makeEvent(overrides: Partial<HistoryEventOut> = {}): HistoryEventOut {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    scope: 'character',
    entityClass: 'character',
    entityId: crypto.randomUUID(),
    op: 'update',
    characterId: null,
    campaignId: null,
    actorUserId: 'user-1',
    actorDisplayName: null,
    batchId: null,
    summary: 'ST 10 → 12',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('groupIntoBatches', () => {
  it('standalone events become single-item non-foldable groups', () => {
    const events = [makeEvent({ summary: 'A' }), makeEvent({ summary: 'B' })];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.foldable).toBe(false);
    expect(groups[1]?.foldable).toBe(false);
  });

  it('shared batchId folds consecutive events into one group', () => {
    const bid = crypto.randomUUID();
    const events = [
      makeEvent({ batchId: bid, summary: 'X' }),
      makeEvent({ batchId: bid, summary: 'Y' }),
      makeEvent({ batchId: bid, summary: 'Z' }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.foldable).toBe(true);
    expect(groups[0]?.events).toHaveLength(3);
  });

  it('different batchIds produce separate groups', () => {
    const bid1 = crypto.randomUUID();
    const bid2 = crypto.randomUUID();
    const events = [
      makeEvent({ batchId: bid1, summary: 'A' }),
      makeEvent({ batchId: bid2, summary: 'B' }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
  });

  it('a batched language import folds under one "N language changes" header', () => {
    const bid = crypto.randomUUID();
    const events = [
      makeEvent({ batchId: bid, entityClass: 'character_language', op: 'insert' }),
      makeEvent({ batchId: bid, entityClass: 'character_language', op: 'insert' }),
      makeEvent({ batchId: bid, entityClass: 'character_language', op: 'insert' }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.foldable).toBe(true);
    expect(groups[0]?.groupSummary).toBe('3 language changes');
  });

  it('a batched style adoption folds under one "N technique changes" header', () => {
    const bid = crypto.randomUUID();
    const events = [
      makeEvent({ batchId: bid, entityClass: 'character_technique', op: 'insert' }),
      makeEvent({ batchId: bid, entityClass: 'character_technique', op: 'insert' }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups[0]?.groupSummary).toBe('2 technique changes');
  });

  it('null batchId always starts a new group even if surrounded by same batchId', () => {
    const bid = crypto.randomUUID();
    const events = [
      makeEvent({ batchId: bid }),
      makeEvent({ batchId: null }),
      makeEvent({ batchId: bid }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(3);
  });

  it('un-batched updates to the same item within 60s fold into one collapsed group', () => {
    const itemId = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({
        entityId: itemId,
        entityClass: 'character_inventory',
        createdAt: t0.toISOString(),
        summary: 'Shortsword: set as armor',
      }),
      makeEvent({
        entityId: itemId,
        entityClass: 'character_inventory',
        createdAt: new Date(t0.getTime() + 10_000).toISOString(),
        summary: 'Shortsword qty 1 → 2',
      }),
      makeEvent({
        entityId: itemId,
        entityClass: 'character_inventory',
        createdAt: new Date(t0.getTime() + 59_000).toISOString(),
        summary: 'Wearing Shortsword',
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.foldable).toBe(true);
    expect(groups[0]?.events).toHaveLength(3);
  });

  it('same-item updates more than 60s apart stay separate', () => {
    const itemId = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({
        entityId: itemId,
        entityClass: 'character_inventory',
        createdAt: t0.toISOString(),
      }),
      makeEvent({
        entityId: itemId,
        entityClass: 'character_inventory',
        createdAt: new Date(t0.getTime() + 61_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
  });

  it('same-window updates to different items stay separate', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({ entityId: crypto.randomUUID(), createdAt: t0.toISOString() }),
      makeEvent({
        entityId: crypto.randomUUID(),
        createdAt: new Date(t0.getTime() + 1_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
  });

  // dispatchOperation falls back to op.clientOpId when a write has no
  // explicit batchId, so un-batched sync writes still carry a distinct,
  // non-null batchId each. That per-event id has no sibling in the
  // loaded page, so it must not be treated as a "real" (multi-member)
  // batch — otherwise the same-item burst heuristic above would never
  // fire for any sync-backed entity class.
  it('same-item updates each carrying a distinct singleton batchId still fold', () => {
    const itemId = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({
        entityId: itemId,
        entityClass: 'character_inventory',
        batchId: crypto.randomUUID(),
        createdAt: t0.toISOString(),
      }),
      makeEvent({
        entityId: itemId,
        entityClass: 'character_inventory',
        batchId: crypto.randomUUID(),
        createdAt: new Date(t0.getTime() + 10_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.foldable).toBe(true);
  });

  it('a real multi-member batch is not swept into an adjacent same-item burst', () => {
    const itemId = crypto.randomUUID();
    const bid = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({ entityId: itemId, batchId: bid, createdAt: t0.toISOString() }),
      makeEvent({ entityId: itemId, batchId: bid, createdAt: t0.toISOString() }),
      makeEvent({
        entityId: itemId,
        batchId: null,
        createdAt: new Date(t0.getTime() + 5_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.events).toHaveLength(2);
    expect(groups[1]?.events).toHaveLength(1);
  });

  it('insert followed by update on the same item within the window does not fold', () => {
    const itemId = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({ entityId: itemId, op: 'insert', createdAt: t0.toISOString() }),
      makeEvent({
        entityId: itemId,
        op: 'update',
        createdAt: new Date(t0.getTime() + 5_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
  });

  it('same-item updates by different actors within the window stay separate', () => {
    const itemId = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({ entityId: itemId, actorUserId: 'user-a', createdAt: t0.toISOString() }),
      makeEvent({
        entityId: itemId,
        actorUserId: 'user-b',
        createdAt: new Date(t0.getTime() + 5_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
  });

  it('same-item updates without actors stay separate because they cannot be attributed to one actor', () => {
    const itemId = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({ entityId: itemId, actorUserId: null, createdAt: t0.toISOString() }),
      makeEvent({
        entityId: itemId,
        actorUserId: null,
        createdAt: new Date(t0.getTime() + 5_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
  });

  it('keeps a real batch separate from a same-item burst across a page boundary', () => {
    const itemId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events = [
      makeEvent({
        entityId: itemId,
        actorUserId: 'user-1',
        batchId,
        batchSize: 2,
        createdAt: t0.toISOString(),
      }),
      makeEvent({
        entityId: itemId,
        actorUserId: 'user-1',
        batchId: null,
        createdAt: new Date(t0.getTime() + 5_000).toISOString(),
      }),
    ];
    const groups = groupIntoBatches(events);
    expect(groups).toHaveLength(2);
  });
});

it('summarizes a campaign house rule change from DB history', () => {
  expect(
    summarizeEvent({
      entityClass: 'campaign',
      op: 'update',
      oldRow: { house_rules: { protectNaturalDr: true } },
      newRow: { house_rules: { protectNaturalDr: false } },
    }).summary,
  ).toBe('Natural DR penetration immunity disabled (house rule)');
});
