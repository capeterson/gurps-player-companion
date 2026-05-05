/**
 * Pure tests for the sync route's access-mode decision. Pinning the
 * P1 fix from PR #22 review: when a campaign has shareCharacterSheets=
 * false, non-GM members get `minimal` access for those characters and
 * therefore never receive their private child rows through /sync/cursor.
 */

import { describe, expect, it } from 'bun:test';
import { decideCharacterAccess } from './sync.ts';

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
