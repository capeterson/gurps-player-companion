import { describe, expect, it } from 'bun:test';
import { groupIntoBatches, summarizeEvent, diffRows } from './summarize.ts';
import type { HistoryEventOut } from '../schemas/history.ts';

// ---------- diffRows ----------

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
    actorUserId: null,
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
});
