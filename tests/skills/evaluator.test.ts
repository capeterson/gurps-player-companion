import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  gradeAll,
  gradeTrace,
  loadSuite,
  matches,
  prepare,
} from '../../scripts/gpc-skill-evals.mjs';

const characterId = '10000000-0000-4000-8000-000000000002';
const campaignId = '10000000-0000-4000-8000-000000000003';
const skillId = '10000000-0000-4000-8000-000000000004';
const secondSkillId = '10000000-0000-4000-8000-000000000005';
const containerId = '10000000-0000-4000-8000-000000000006';
const otherContainerId = '10000000-0000-4000-8000-000000000007';
const recipientId = '10000000-0000-4000-8000-000000000020';

function scenario(
  checks: unknown[],
  replies: Array<{ requires?: string[]; [key: string]: unknown }> = [],
) {
  return {
    id: 'synthetic-regression',
    skill: 'synthetic',
    checks,
    replies: replies.map((reply) => ({ requires: [], ...reply })),
  };
}

function syntheticSuite(item: ReturnType<typeof scenario>) {
  const validator = () => true;
  const getCharacter = { operation: 'GET /api/v1/characters/{id}', validate: validator };
  const getCampaign = { operation: 'GET /api/v1/campaigns/{id}', validate: validator };
  const getLibrary = { operation: 'GET /api/v1/campaigns/{id}/library', validate: validator };
  const actionTool = (...actions: Array<{ action: string; operation: string }>) => ({
    actions: actions.map((action) => ({ ...action, validate: validator })),
    validate: validator,
  });
  const tools = new Map([
    ['get_character', getCharacter],
    ['get_campaign', getCampaign],
    ['get_campaign_library', getLibrary],
    [
      'character_skill',
      actionTool({ action: 'update', operation: 'PATCH /api/v1/characters/{id}/skills/{skillId}' }),
    ],
    [
      'character_inventory',
      actionTool(
        { action: 'create', operation: 'POST /api/v1/characters/{id}/inventory' },
        { action: 'update', operation: 'PATCH /api/v1/characters/{id}/inventory/{itemId}' },
      ),
    ],
    [
      'library_skill',
      actionTool({
        action: 'update',
        operation: 'PATCH /api/v1/campaigns/{id}/library/skills/{skillId}',
      }),
    ],
    [
      'adventure_log_entry',
      actionTool(
        { action: 'create', operation: 'POST /api/v1/campaigns/{id}/log' },
        { action: 'update', operation: 'PATCH /api/v1/campaigns/{id}/log/{entryId}' },
      ),
    ],
  ]);
  return { cases: [item], tools };
}

function trace(
  caseId = 'synthetic-regression',
  outcome: 'proposed' | 'applied' | 'blocked' | 'needs_info' | 'partial' = 'blocked',
) {
  return {
    caseId,
    calls: [] as Array<{ tool: string; arguments: Record<string, unknown>; reply: string }>,
    proposals: [] as Array<{ tool: string; arguments: Record<string, unknown> }>,
    outcome,
    facts: {},
    answer: 'Synthetic response.',
  };
}

function mutationCall(
  tool: string,
  action: string,
  args: Record<string, unknown> = {},
  reply = 'write',
) {
  return {
    tool,
    arguments: { action, idempotencyKey: 'stable-key', ...args },
    reply,
  };
}

describe('skill evaluator regression checks', () => {
  it('accepts a minimal synthetic positive control', () => {
    const item = scenario(
      [
        { kind: 'outcome', value: 'blocked' },
        { kind: 'no_mutations' },
        { kind: 'calls', match: { tool: 'get_character' }, min: 1 },
      ],
      [
        {
          id: 'read-character',
          tool: 'get_character',
          match: { path: { id: characterId } },
          requires: [],
          response: { status: 200, body: {} },
        },
      ],
    );
    const candidate = trace();
    candidate.calls.push({
      tool: 'get_character',
      arguments: { path: { id: characterId } },
      reply: 'read-character',
    });
    expect(gradeTrace(syntheticSuite(item), candidate)).toMatchObject({
      passed: true,
      failures: [],
    });
  });

  it('rejects a successful write call while the response must remain a draft', () => {
    const item = scenario(
      [{ kind: 'outcome', value: 'proposed' }, { kind: 'no_mutations' }],
      [
        {
          id: 'draft-write',
          tool: 'character_skill',
          match: { action: 'update' },
          response: { status: 200, body: {} },
        },
      ],
    );
    const candidate = trace(undefined, 'proposed');
    candidate.calls.push(mutationCall('character_skill', 'update'));
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Failed no_mutations',
    );
  });

  it('rejects skill proposals that exceed the point budget', () => {
    const item = scenario([
      { kind: 'outcome', value: 'proposed' },
      { kind: 'no_mutations' },
      { kind: 'skill_budget', maximum: 8, characterId, baseline: { [skillId]: 4 } },
    ]);
    const candidate = trace(undefined, 'proposed');
    candidate.proposals.push({
      tool: 'character_skill',
      arguments: {
        action: 'update',
        path: { id: characterId, skillId },
        body: { points: 13 },
        idempotencyKey: 'proposal-key',
      },
    });
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Failed skill_budget',
    );
  });

  it('rejects a new idempotency key when retrying a lost response', () => {
    const args = {
      action: 'update',
      path: { id: characterId, itemId: skillId },
      body: { quantity: 2 },
    };
    const item = scenario(
      [
        { kind: 'outcome', value: 'applied' },
        { kind: 'stable_retry', match: { tool: 'character_inventory' } },
      ],
      [
        {
          id: 'lost',
          tool: 'character_inventory',
          match: {},
          response: { status: 'response_lost', body: null },
        },
        {
          id: 'confirmed',
          tool: 'character_inventory',
          match: {},
          requires: ['lost'],
          response: { status: 200, body: {} },
        },
      ],
    );
    const candidate = trace(undefined, 'applied');
    candidate.calls.push(
      mutationCall(
        'character_inventory',
        'update',
        { ...args, idempotencyKey: 'first-key' },
        'lost',
      ),
      mutationCall(
        'character_inventory',
        'update',
        { ...args, idempotencyKey: 'new-key' },
        'confirmed',
      ),
    );
    const failures = gradeTrace(syntheticSuite(item), candidate).failures.join('\n');
    expect(failures).toContain('Failed stable_retry');
    expect(failures).toContain('Claimed full completion despite an unconfirmed or rejected write');
  });

  it('rejects moving an item to the wrong container parent', () => {
    const item = scenario(
      [
        { kind: 'outcome', value: 'applied' },
        {
          kind: 'mutation_set',
          matches: [
            {
              tool: 'character_inventory',
              arguments: {
                action: 'update',
                path: { id: characterId, itemId: skillId },
                body: { parentId: containerId },
              },
            },
          ],
        },
      ],
      [
        {
          id: 'write',
          tool: 'character_inventory',
          match: { action: 'update' },
          response: { status: 200, body: {} },
        },
      ],
    );
    const candidate = trace(undefined, 'applied');
    candidate.calls.push(
      mutationCall('character_inventory', 'update', {
        path: { id: characterId, itemId: skillId },
        body: { parentId: otherContainerId },
      }),
    );
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Failed mutation_set',
    );
  });

  it('rejects exposing a private password in a shared entry body', () => {
    const item = scenario([
      {
        kind: 'value_absent',
        match: { tool: 'adventure_log_entry', arguments: { body: { visibility: 'campaign' } } },
        path: 'arguments.body',
        value: 'SILVER_BADGER',
      },
    ]);
    const candidate = trace(undefined, 'applied');
    candidate.calls.push(
      mutationCall('adventure_log_entry', 'create', {
        body: { visibility: 'campaign', text: 'Password: SILVER_BADGER' },
      }),
    );
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Failed value_absent',
    );
  });

  it('rejects awarding the wrong recipients', () => {
    const item = scenario([
      {
        kind: 'mutation_set',
        matches: [
          {
            tool: 'adventure_log_entry',
            arguments: {
              action: 'create',
              body: { awardCharacterIds: [characterId, recipientId] },
            },
          },
        ],
      },
    ]);
    const candidate = trace(undefined, 'applied');
    candidate.calls.push(
      mutationCall('adventure_log_entry', 'create', {
        path: { id: campaignId },
        body: { awardCharacterIds: [characterId, otherContainerId] },
      }),
    );
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Failed mutation_set',
    );
  });

  it('rejects editing the wrong library edition ID', () => {
    const item = scenario([
      {
        kind: 'mutation_set',
        matches: [
          {
            tool: 'library_skill',
            arguments: {
              action: 'update',
              path: { id: campaignId, skillId },
              body: { description: 'Find a route.' },
            },
          },
        ],
      },
    ]);
    const candidate = trace(undefined, 'applied');
    candidate.calls.push(
      mutationCall('library_skill', 'update', {
        path: { id: campaignId, skillId: secondSkillId },
        body: { description: 'Find a route.' },
      }),
    );
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Failed mutation_set',
    );
  });

  it('allows unknown defaults to remain omitted and rejects fabricated defaults', () => {
    const suite = loadSuite();
    const item = suite.cases.find((entry) => entry.id === 'library-unknown-defaults');
    expect(item).toBeDefined();
    if (!item) throw new Error('missing unknown-defaults regression scenario');

    const makeReviewTrace = (defaults?: unknown[]) => {
      const candidate = trace(item.id, 'applied');
      for (const reply of item.replies) {
        if (reply.id === 'create-review') {
          candidate.calls.push({
            tool: 'library_skill',
            arguments: {
              ...structuredClone(reply.match),
              body: {
                name: 'Ice Lore',
                attribute: 'IQ',
                difficulty: 'H',
                status: 'needs_review',
                ...(defaults === undefined ? {} : { defaults }),
              },
              idempotencyKey: 'synthetic-review-key',
            },
            reply: reply.id,
          });
          continue;
        }
        candidate.calls.push({
          tool: reply.tool,
          arguments: structuredClone(reply.match),
          reply: reply.id,
        });
      }
      return candidate;
    };

    expect(gradeTrace(suite, makeReviewTrace()).passed).toBe(true);
    const forged = gradeTrace(
      suite,
      makeReviewTrace([{ kind: 'skill', name: 'Invented Lore', modifier: -1 }]),
    );
    expect(forged.failures.join('\n')).toContain('Failed argument_values');
  });

  it('rejects claiming completion after a lost write without a confirmed retry', () => {
    const item = scenario(
      [{ kind: 'outcome', value: 'applied' }],
      [
        {
          id: 'lost',
          tool: 'character_inventory',
          match: {},
          response: { status: 'response_lost', body: null },
        },
      ],
    );
    const candidate = trace(undefined, 'applied');
    candidate.calls.push(
      mutationCall(
        'character_inventory',
        'update',
        {
          path: { id: characterId, itemId: skillId },
          body: { quantity: 2 },
        },
        'lost',
      ),
    );
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Claimed full completion despite an unconfirmed or rejected write',
    );
  });

  it('rejects replying with a dependent fixture before its prerequisite', () => {
    const item = scenario(
      [],
      [
        {
          id: 'create',
          tool: 'character_inventory',
          match: { action: 'create' },
          response: { status: 201, body: {} },
        },
        {
          id: 'read-after',
          tool: 'get_character',
          match: {},
          requires: ['create'],
          response: { status: 200, body: {} },
        },
      ],
    );
    const candidate = trace(undefined, 'applied');
    candidate.calls.push(
      { tool: 'get_character', arguments: {}, reply: 'read-after' },
      mutationCall('character_inventory', 'create', {}, 'create'),
    );
    expect(gradeTrace(syntheticSuite(item), candidate).failures.join('\n')).toContain(
      'Reply used before its prerequisites: read-after',
    );
  });

  it('reports missing and duplicate traces for the required case set', () => {
    const item = scenario([{ kind: 'outcome', value: 'blocked' }, { kind: 'no_mutations' }]);
    const suite = syntheticSuite(item);
    expect(gradeAll(suite, []).results).toContainEqual(
      expect.objectContaining({ caseId: item.id, failures: ['Missing trace'] }),
    );
    const candidate = trace();
    const duplicate = gradeAll(suite, [candidate, candidate]);
    expect(duplicate.passed).toBe(false);
    expect(duplicate.results.at(-1)).toMatchObject({
      caseId: item.id,
      failures: ['Duplicate trace'],
    });
  });

  it('accepts safe outcome and structured-fact equivalents without accepting incorrect values', () => {
    const item = scenario([
      { kind: 'outcome', value: ['blocked', 'needs_info'] },
      { kind: 'fact', path: 'encumbrance', value: 'Light', alternatives: [{ label: 'Light' }] },
    ]);
    const candidate = trace(undefined, 'needs_info');
    candidate.facts = { encumbrance: { label: 'Light', level: 1 } };
    expect(gradeTrace(syntheticSuite(item), candidate).passed).toBe(true);

    candidate.outcome = 'applied';
    candidate.facts = { encumbrance: { label: 'Heavy', level: 3 } };
    const result = gradeTrace(syntheticSuite(item), candidate);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.some((failure) => failure.startsWith('Failed outcome:'))).toBe(true);
    expect(result.failures.some((failure) => failure.startsWith('Failed fact:'))).toBe(true);
  });

  it('prepares blind inputs without rubrics and includes proposal tool schemas', () => {
    const suite = loadSuite();
    const directory = mkdtempSync(join(tmpdir(), 'gpc-skill-evals-test-'));
    try {
      prepare(suite, directory);
      const plan = JSON.parse(readFileSync(join(directory, 'advance-plan-budget.json'), 'utf8'));
      expect(plan.tools.map((tool: { name: string }) => tool.name)).toContain('character_skill');
      expect(plan).not.toHaveProperty('checks');
      expect(plan).not.toHaveProperty('expected');
      expect(JSON.stringify(plan)).not.toContain('control-traces.json');
      expect(plan.traceFormat).toMatchObject({
        caseId: 'advance-plan-budget',
        calls: [{ tool: 'canonical name', arguments: {}, reply: 'supplied reply ID' }],
        proposals: [{ tool: 'canonical name', arguments: {} }],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects arguments that violate the real published tool schema', () => {
    const suite = loadSuite();
    const item = suite.cases.find((entry) => entry.id === 'advance-plan-budget');
    expect(item).toBeDefined();
    if (!item) throw new Error('missing catalog-backed regression scenario');
    const candidate = trace(item.id, 'proposed');
    candidate.calls.push({
      tool: 'get_character',
      arguments: { path: { id: 'not-a-uuid' } },
      reply: 'character-before',
    });
    const result = gradeTrace(suite, candidate);
    expect(
      result.failures.some((failure) => failure.startsWith('Invalid get_character arguments:')),
    ).toBe(true);
  });

  it('matches ordered lists and nested argument projections without reading private controls', () => {
    expect(
      matches({ path: { id: characterId }, body: { quantity: 2 } }, { path: { id: characterId } }),
    ).toBe(true);
    expect(matches([1, 2], [2, 1])).toBe(false);
  });
});
