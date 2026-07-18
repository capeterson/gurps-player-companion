/**
 * Pure tests for the sync route's access-mode decision. Pinning the
 * P1 fix from PR #22 review: when a campaign has shareCharacterSheets=
 * false, non-GM members get `minimal` access for those characters and
 * therefore never receive their private child rows through /sync/cursor.
 */

import { describe, expect, it } from 'bun:test';
import type { OperationEnvelope, OperationOutcome } from '../../shared/schemas/sync.ts';
import { createBatchRevisionChains, decideCharacterAccess } from './sync.ts';

const VIEWER = 'viewer-id';
const OWNER = 'owner-id';
const GM = 'gm-id';

describe('decideCharacterAccess', () => {
  it('returns "full" for the viewer\'s own characters', () => {
    const out = decideCharacterAccess({
      viewerId: VIEWER,
      characters: [{ id: 'c1', ownerId: VIEWER, campaignId: null }],
      campaigns: [],
    });
    expect(out.get('c1')).toBe('full');
  });

  it('returns "full" for characters in shared campaigns', () => {
    const out = decideCharacterAccess({
      viewerId: VIEWER,
      characters: [{ id: 'c1', ownerId: OWNER, campaignId: 'camp1' }],
      campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: true }],
    });
    expect(out.get('c1')).toBe('full');
  });

  it('returns "minimal" for non-GM members when share is false', () => {
    const out = decideCharacterAccess({
      viewerId: VIEWER,
      characters: [{ id: 'c1', ownerId: OWNER, campaignId: 'camp1' }],
      campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: false }],
    });
    expect(out.get('c1')).toBe('minimal');
  });

  it('returns "full" for the campaign GM even when share is false', () => {
    // The GM needs every detail to run encounters; the share toggle
    // only restricts other players' visibility, not the GM's.
    const out = decideCharacterAccess({
      viewerId: GM,
      characters: [{ id: 'c1', ownerId: OWNER, campaignId: 'camp1' }],
      campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: false }],
    });
    expect(out.get('c1')).toBe('full');
  });

  it('returns full for a manager only when staff editing is enabled', () => {
    const base = {
      id: 'camp1',
      ownerId: GM,
      shareCharacterSheets: false,
      viewerRole: 'manager' as const,
    };
    const characters = [{ id: 'c1', ownerId: OWNER, campaignId: 'camp1' }];

    expect(
      decideCharacterAccess({
        viewerId: VIEWER,
        characters,
        campaigns: [{ ...base, allowGmCharacterEditing: false }],
      }).get('c1'),
    ).toBe('minimal');
    expect(
      decideCharacterAccess({
        viewerId: VIEWER,
        characters,
        campaigns: [{ ...base, allowGmCharacterEditing: true }],
      }).get('c1'),
    ).toBe('full');
  });

  it('returns "full" for the character owner regardless of share', () => {
    const out = decideCharacterAccess({
      viewerId: OWNER,
      characters: [{ id: 'c1', ownerId: OWNER, campaignId: 'camp1' }],
      campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: false }],
    });
    expect(out.get('c1')).toBe('full');
  });

  it('omits characters whose campaign is missing or null and the viewer is not the owner', () => {
    // Defensive: shouldn't be reachable through the SQL where clause,
    // but if a row sneaks in with a stale campaignId, drop it.
    const out = decideCharacterAccess({
      viewerId: VIEWER,
      characters: [
        { id: 'c1', ownerId: OWNER, campaignId: null },
        { id: 'c2', ownerId: OWNER, campaignId: 'gone' },
      ],
      campaigns: [],
    });
    expect(out.has('c1')).toBe(false);
    expect(out.has('c2')).toBe(false);
  });

  it('mixes per-character access: viewer owns one, sees minimal of another', () => {
    const out = decideCharacterAccess({
      viewerId: VIEWER,
      characters: [
        { id: 'mine', ownerId: VIEWER, campaignId: 'camp1' },
        { id: 'theirs', ownerId: OWNER, campaignId: 'camp1' },
      ],
      campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: false }],
    });
    expect(out.get('mine')).toBe('full');
    expect(out.get('theirs')).toBe('minimal');
  });
});

/**
 * Pure tests for the batch-local revision fast-forward that fixes the
 * "rapid same-entity edits stale_base each other one at a time" bug:
 * see the rationale comment above `createBatchRevisionChains` in
 * sync.ts and the call site in the /sync/operations handler.
 */
describe('createBatchRevisionChains', () => {
  function patchOp(overrides: Partial<OperationEnvelope> = {}): OperationEnvelope {
    return {
      clientOpId: 'op-1',
      entityClass: 'character',
      entityId: 'char-1',
      command: 'patch',
      fieldPath: 'name',
      attemptedValue: 'whatever',
      baseRevision: 10,
      validationVersion: 1,
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function appliedOutcome(newRevision: number, clientOpId = 'op-1'): OperationOutcome {
    return { clientOpId, status: 'applied', newRevision };
  }

  it('leaves the first op for an entity untouched (no chain yet)', () => {
    const chains = createBatchRevisionChains();
    const op = patchOp({ baseRevision: 10 });
    expect(chains.rewrite(op)).toBe(op);
  });

  it('fast-forwards a second same-entity patch stamped with the same stale base', () => {
    const chains = createBatchRevisionChains();
    const op1 = patchOp({ clientOpId: 'op-1', baseRevision: 10, fieldPath: 'name' });
    chains.record(op1, appliedOutcome(11, 'op-1'));

    const op2 = patchOp({ clientOpId: 'op-2', baseRevision: 10, fieldPath: 'st' });
    const rewritten = chains.rewrite(op2);
    expect(rewritten.baseRevision).toBe(11);
    expect(rewritten).not.toBe(op2);
  });

  it('chains a third op to the latest revision, not the intermediate one', () => {
    const chains = createBatchRevisionChains();
    const op1 = patchOp({ clientOpId: 'op-1', baseRevision: 10, fieldPath: 'name' });
    chains.record(op1, appliedOutcome(11, 'op-1'));
    const op2 = patchOp({ clientOpId: 'op-2', baseRevision: 10, fieldPath: 'st' });
    chains.record(op2, appliedOutcome(12, 'op-2'));

    const op3 = patchOp({ clientOpId: 'op-3', baseRevision: 10, fieldPath: 'dx' });
    expect(chains.rewrite(op3).baseRevision).toBe(12);
  });

  it('never rewrites a base with undefined baseRevision', () => {
    const chains = createBatchRevisionChains();
    const op1 = patchOp({ clientOpId: 'op-1', baseRevision: 10 });
    chains.record(op1, appliedOutcome(11, 'op-1'));

    const op2 = patchOp({ clientOpId: 'op-2', baseRevision: undefined });
    expect(chains.rewrite(op2)).toBe(op2);
  });

  it('leaves a base older than the chain start untouched (genuine stale conflict)', () => {
    const chains = createBatchRevisionChains();
    const op1 = patchOp({ clientOpId: 'op-1', baseRevision: 10 });
    chains.record(op1, appliedOutcome(11, 'op-1'));

    // This op's base predates the batch's knowledge -- not something
    // this client observed before enqueueing, so it should still hit
    // the server's stale_base check untouched.
    const olderOp = patchOp({ clientOpId: 'op-2', baseRevision: 5 });
    expect(chains.rewrite(olderOp)).toBe(olderOp);
  });

  it('leaves a base equal to the chain latest untouched (already at the head, no rewrite needed)', () => {
    const chains = createBatchRevisionChains();
    const op1 = patchOp({ clientOpId: 'op-1', baseRevision: 10 });
    chains.record(op1, appliedOutcome(11, 'op-1'));

    const atHead = patchOp({ clientOpId: 'op-2', baseRevision: 11 });
    expect(chains.rewrite(atHead)).toBe(atHead);
  });

  it('does not seed or extend the chain from create outcomes', () => {
    const chains = createBatchRevisionChains();
    const createOp = patchOp({ clientOpId: 'op-1', command: 'create', baseRevision: undefined });
    chains.record(createOp, appliedOutcome(11, 'op-1'));

    const patch = patchOp({ clientOpId: 'op-2', baseRevision: 10 });
    // No chain exists (create didn't seed one), so this stays untouched.
    expect(chains.rewrite(patch)).toBe(patch);
  });

  it('does not extend the chain from delete outcomes', () => {
    const chains = createBatchRevisionChains();
    const op1 = patchOp({ clientOpId: 'op-1', baseRevision: 10 });
    chains.record(op1, appliedOutcome(11, 'op-1'));

    const deleteOp = patchOp({ clientOpId: 'op-2', command: 'delete', baseRevision: 11 });
    chains.record(deleteOp, { clientOpId: 'op-2', status: 'applied' });

    const op3 = patchOp({ clientOpId: 'op-3', baseRevision: 10 });
    // Chain should still cap at 11 from op1, unaffected by the delete.
    expect(chains.rewrite(op3).baseRevision).toBe(11);
  });

  it('ignores non-applied outcomes when recording', () => {
    const chains = createBatchRevisionChains();
    const op1 = patchOp({ clientOpId: 'op-1', baseRevision: 10 });
    chains.record(op1, {
      clientOpId: 'op-1',
      status: 'stale_base',
      reason: 'newer server revision',
    });

    const op2 = patchOp({ clientOpId: 'op-2', baseRevision: 10 });
    expect(chains.rewrite(op2)).toBe(op2);
  });

  it('keeps chains independent per entityClass + entityId', () => {
    const chains = createBatchRevisionChains();
    const charOp = patchOp({
      clientOpId: 'op-1',
      entityClass: 'character',
      entityId: 'shared-id',
      baseRevision: 10,
    });
    chains.record(charOp, appliedOutcome(11, 'op-1'));

    // Same id, different entityClass (e.g. character vs character_combat,
    // which shares the character's id in some sync payloads) must not
    // pick up the character's chain.
    const combatOp = patchOp({
      clientOpId: 'op-2',
      entityClass: 'character_combat',
      entityId: 'shared-id',
      baseRevision: 10,
    });
    expect(chains.rewrite(combatOp)).toBe(combatOp);

    // A different character id also stays isolated.
    const otherCharOp = patchOp({
      clientOpId: 'op-3',
      entityClass: 'character',
      entityId: 'other-id',
      baseRevision: 10,
    });
    expect(chains.rewrite(otherCharOp)).toBe(otherCharOp);
  });
});
