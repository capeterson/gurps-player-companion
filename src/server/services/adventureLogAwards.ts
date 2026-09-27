import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  type AdventureLogUpdate,
  type XpAward,
  xpAwardsField,
} from '../../shared/schemas/adventureLog.ts';
import type { AuditTx } from '../db/auditContext.ts';
import { campaignMemberships, campaigns, characters } from '../db/schema.ts';
import { publish } from './wsBus.ts';

/** Called under the campaign lock, in the same audited transaction as the log write. */
export async function resolveLogAwards(
  tx: AuditTx,
  campaignId: string,
  actorId: string,
  ownerId: string,
  body: AdventureLogUpdate,
  previous: readonly XpAward[] = [],
  previousPoints: number | null = null,
): Promise<XpAward[]> {
  const points = body.pointsGained === undefined ? previousPoints : body.pointsGained;
  if (
    body.pointsGained === undefined &&
    body.awardCharacterIds === undefined &&
    body.xpAwards === undefined
  ) {
    return [...previous];
  }
  let awards: XpAward[];
  if (
    points !== null &&
    (body.pointsGained !== undefined || body.awardCharacterIds !== undefined)
  ) {
    // An amount-only edit retains its original recipients. New entries snapshot the current roster.
    const ids =
      body.awardCharacterIds === undefined && previousPoints !== null
        ? previous.map((award) => award.characterId)
        : body.awardCharacterIds;
    const roster = await tx
      .select()
      .from(characters)
      .where(ids == null ? eq(characters.campaignId, campaignId) : inArray(characters.id, ids))
      .orderBy(asc(characters.id));
    // Snapshot recipients here, then lock the entire previous/next union in
    // one order below. Historical recipients can belong to another campaign.
    awards = (ids ?? roster.map((character) => character.id)).map((characterId) => ({
      characterId,
      amount: points,
    }));
  } else {
    awards = body.pointsGained === null ? [] : (body.xpAwards ?? [...previous]);
  }
  const validated = xpAwardsField.safeParse(awards);
  if (!validated.success)
    throw new HTTPException(422, {
      message: validated.error.issues[0]?.message ?? 'Invalid point awards',
    });
  const previousById = new Map<string, number>();
  for (const award of previous) {
    previousById.set(award.characterId, (previousById.get(award.characterId) ?? 0) + award.amount);
  }
  const nextById = new Map(awards.map((award) => [award.characterId, award.amount]));
  const ids = [...new Set([...previousById.keys(), ...nextById.keys()])].sort();
  const affected =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(characters)
          .where(inArray(characters.id, ids))
          .orderBy(asc(characters.id))
          .for('update');
  for (const award of awards) {
    const character = affected.find((row) => row.id === award.characterId);
    if (
      character &&
      previousById.get(award.characterId) !== award.amount &&
      actorId !== ownerId &&
      actorId !== character.ownerId
    ) {
      throw new HTTPException(403, {
        message: 'Only the campaign owner can award points to other players’ characters',
      });
    }
    // Existing recipients may have left the campaign: keep unchanged awards, never add credit there.
    if (
      (!character || character.campaignId !== campaignId) &&
      previousById.get(award.characterId) !== award.amount
    ) {
      throw new HTTPException(422, { message: 'Award recipients must belong to this campaign' });
    }
  }
  for (const character of affected) {
    const delta = (nextById.get(character.id) ?? 0) - (previousById.get(character.id) ?? 0);
    if (delta === 0) continue;
    if (actorId !== ownerId && actorId !== character.ownerId) {
      throw new HTTPException(403, {
        message: 'Only the campaign owner can award points to other players’ characters',
      });
    }
    await tx
      .update(characters)
      .set({ earnedPoints: sql`${characters.earnedPoints} + ${delta}`, updatedAt: new Date() })
      .where(eq(characters.id, character.id));
    publish(character.ownerId, {
      kind: 'sync_invalidate',
      entityClasses: ['character'],
      emittedAt: new Date().toISOString(),
    });
  }
  const members = await tx
    .select({ userId: campaignMemberships.userId })
    .from(campaignMemberships)
    .where(eq(campaignMemberships.campaignId, campaignId));
  for (const userId of new Set([actorId, ownerId, ...members.map((member) => member.userId)])) {
    publish(userId, {
      kind: 'sync_invalidate',
      entityClasses: ['character'],
      emittedAt: new Date().toISOString(),
    });
  }
  return validated.data;
}

export async function lockLogCampaign(tx: AuditTx, campaignId: string, actorId: string) {
  const [campaign] = await tx
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .for('update');
  if (!campaign) throw new HTTPException(404, { message: 'campaign not found' });
  if (campaign.ownerId !== actorId) {
    const [member] = await tx
      .select()
      .from(campaignMemberships)
      .where(
        and(
          eq(campaignMemberships.campaignId, campaignId),
          eq(campaignMemberships.userId, actorId),
        ),
      )
      .for('share');
    if (!member) throw new HTTPException(403, { message: 'campaign membership required' });
  }
  return campaign;
}
