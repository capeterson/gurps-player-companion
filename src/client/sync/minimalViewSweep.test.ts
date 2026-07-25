/**
 * Pinning the local enforcement of the campaign-share gate. Codex P1
 * on PR #22: when a GM flips `shareCharacterSheets` to false, child
 * rows that were synced earlier must be purged from the viewer's
 * IndexedDB. The orchestrator runs this sweep after every cursor pull;
 * the pure helper here decides which character ids to target.
 */

import { describe, expect, it } from 'vitest';
import {
  characterIdsToMinimize,
  isOutboxAccessRestricted,
  isRecordAccessRestricted,
} from './minimalViewSweep.ts';

const ME = 'me';
const THEM = 'them';
const GM = 'gm';

describe('characterIdsToMinimize', () => {
  it('returns an empty set when the viewer owns every character', () => {
    expect([
      ...characterIdsToMinimize({
        viewerId: ME,
        characters: [{ id: 'c1', ownerId: ME, campaignId: 'camp1' }],
        campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: false }],
      }),
    ]).toEqual([]);
  });

  it('returns an empty set for the campaign GM regardless of share', () => {
    // GM viewing another player's character with share=false: still full.
    expect([
      ...characterIdsToMinimize({
        viewerId: GM,
        characters: [{ id: 'c1', ownerId: THEM, campaignId: 'camp1' }],
        campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: false }],
      }),
    ]).toEqual([]);
  });

  it("targets another player's character when the campaign has share=false", () => {
    expect([
      ...characterIdsToMinimize({
        viewerId: ME,
        characters: [{ id: 'c1', ownerId: THEM, campaignId: 'camp1' }],
        campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: false }],
      }),
    ]).toEqual(['c1']);
  });

  it('does NOT target characters when share is true', () => {
    expect([
      ...characterIdsToMinimize({
        viewerId: ME,
        characters: [{ id: 'c1', ownerId: THEM, campaignId: 'camp1' }],
        campaigns: [{ id: 'camp1', ownerId: GM, shareCharacterSheets: true }],
      }),
    ]).toEqual([]);
  });

  it('keeps private rows for a manager when staff editing is enabled', () => {
    const out = characterIdsToMinimize({
      viewerId: ME,
      characters: [{ id: 'c1', ownerId: THEM, campaignId: 'camp1' }],
      campaigns: [
        {
          id: 'camp1',
          ownerId: GM,
          shareCharacterSheets: false,
          allowGmCharacterEditing: true,
          viewerRole: 'manager',
        },
      ],
    });
    expect([...out]).toEqual([]);
  });

  it('treats absent share field as default-true (back-compat with old Dexie rows)', () => {
    // Dexie campaigns written before the new column existed will have
    // `shareCharacterSheets: undefined`. We must not start purging
    // their child rows on the next sync — that would delete data the
    // user is allowed to see.
    expect([
      ...characterIdsToMinimize({
        viewerId: ME,
        characters: [{ id: 'c1', ownerId: THEM, campaignId: 'camp1' }],
        campaigns: [{ id: 'camp1', ownerId: GM }],
      }),
    ]).toEqual([]);
  });

  it('targets only the share=false subset in a mixed-campaign workspace', () => {
    const out = characterIdsToMinimize({
      viewerId: ME,
      characters: [
        { id: 'mine', ownerId: ME, campaignId: 'open' },
        { id: 'theirs-open', ownerId: THEM, campaignId: 'open' },
        { id: 'theirs-locked', ownerId: THEM, campaignId: 'locked' },
      ],
      campaigns: [
        { id: 'open', ownerId: GM, shareCharacterSheets: true },
        { id: 'locked', ownerId: GM, shareCharacterSheets: false },
      ],
    });
    expect([...out]).toEqual(['theirs-locked']);
  });

  it('skips characters whose campaign is missing from the campaigns list', () => {
    // Defensive: a stale character row pointing at a campaign that's
    // been deleted shouldn't be purged just because we can't classify
    // it. The next cursor pull will tombstone it correctly.
    const out = characterIdsToMinimize({
      viewerId: ME,
      characters: [{ id: 'orphan', ownerId: THEM, campaignId: 'gone' }],
      campaigns: [],
    });
    expect([...out]).toEqual([]);
  });

  it('skips solo characters with no campaign', () => {
    // A non-owner non-campaign character shouldn't even be reachable
    // (sync wouldn't surface it), but defend anyway.
    const out = characterIdsToMinimize({
      viewerId: ME,
      characters: [{ id: 'solo', ownerId: THEM, campaignId: null }],
      campaigns: [],
    });
    expect([...out]).toEqual([]);
  });
});

describe('isOutboxAccessRestricted', () => {
  const access = (known: string[], masked: string[] = []) => ({
    known: new Set(known),
    masked: new Set(masked),
  });

  it('hides values for a masked character', () => {
    const op = { entityClass: 'character', entityId: 'c1', command: 'patch' };
    expect(isOutboxAccessRestricted(op, access(['c1'], ['c1']))).toBe(true);
  });

  it('allows values for a character the viewer still sees', () => {
    const op = { entityClass: 'character', entityId: 'c1', command: 'patch' };
    expect(isOutboxAccessRestricted(op, access(['c1']))).toBe(false);
  });

  it('hides a child delete whose parent character was pruned', () => {
    // enqueueDelete stores the ENTIRE removed row in prevValue, so a GM
    // deleting another player's trait leaves that whole row queued. The
    // parent going away is access loss, not an expected local delete.
    const op = {
      entityClass: 'character_trait',
      entityId: 't1',
      parentId: 'c-gone',
      command: 'delete',
    };
    expect(isOutboxAccessRestricted(op, access([]))).toBe(true);
  });

  it('hides any child op whose parent character was pruned', () => {
    for (const command of ['patch', 'create', 'delete']) {
      const op = {
        entityClass: 'character_inventory',
        entityId: 'i1',
        parentId: 'c-gone',
        command,
      };
      expect(isOutboxAccessRestricted(op, access([]))).toBe(true);
    }
  });

  it('allows a root delete whose row is absent by design', () => {
    // The user deleted their own character; the missing row is the
    // expected consequence, not evidence of lost access.
    const op = { entityClass: 'character', entityId: 'c-mine', command: 'delete' };
    expect(isOutboxAccessRestricted(op, access([]))).toBe(false);
  });

  it('allows a speculative root create that has not landed', () => {
    const op = { entityClass: 'character', entityId: 'c-new', command: 'create' };
    expect(isOutboxAccessRestricted(op, access([]))).toBe(false);
  });

  it('hides a root patch whose character vanished', () => {
    const op = { entityClass: 'character', entityId: 'c-gone', command: 'patch' };
    expect(isOutboxAccessRestricted(op, access([]))).toBe(true);
  });

  it('ignores ops with no character at all', () => {
    const op = { entityClass: 'campaign', entityId: 'camp-1', command: 'patch' };
    expect(isOutboxAccessRestricted(op, access([]))).toBe(false);
  });
});

describe('isRecordAccessRestricted', () => {
  const access = (known: string[], masked: string[] = []) => ({
    known: new Set(known),
    masked: new Set(masked),
  });

  it('honours the at-rest redacted flag', () => {
    expect(isRecordAccessRestricted({ redacted: true }, access([]))).toBe(true);
  });

  it('hides a fresh snapshot written for a masked character', () => {
    // A revert performed OFFLINE writes a new journal entry after the
    // last sweep ran, and offline means no later pull to scrub it.
    const entry = { entityClass: 'character_skill', entityId: 's1', parentId: 'c1' };
    expect(isRecordAccessRestricted(entry, access(['c1'], ['c1']))).toBe(true);
  });

  it('shows records for a character the viewer still sees', () => {
    const entry = { entityClass: 'character', entityId: 'c1', command: 'patch' };
    expect(isRecordAccessRestricted(entry, access(['c1']))).toBe(false);
  });

  it('does not treat a long-deleted entity as restricted', () => {
    // Unlike a queued op, a written record's entity may legitimately be
    // gone; only an active mask restricts.
    const entry = { entityClass: 'character', entityId: 'c-old', command: 'patch' };
    expect(isRecordAccessRestricted(entry, access([]))).toBe(false);
  });

  it('ignores cycle-failure entries that carry no entity', () => {
    expect(isRecordAccessRestricted({}, access([]))).toBe(false);
  });
});
