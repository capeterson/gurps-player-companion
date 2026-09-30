/** Durable fan-out from committed audit rows, shared by REST, sync and MCP writes. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  type EventNotificationPayload,
  eventNotificationPayload,
} from '../../shared/schemas/notification.ts';
import { notificationPreferences } from '../../shared/schemas/notificationPreferences.ts';
import { getDb, runInDbTransaction } from '../db/client.ts';
import {
  type DbEntityHistory,
  campaignMemberships,
  campaigns,
  characters,
  entityHistory,
  notificationHistoryQueue,
  notifications,
  users,
} from '../db/schema.ts';

type Row = Record<string, unknown>;
const row = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {};
const IGNORED = new Set(['revision', 'updated_at', 'created_at']);
export function changedNotificationFields(
  event: Pick<DbEntityHistory, 'oldRow' | 'newRow'>,
): string[] {
  const before = row(event.oldRow);
  const after = row(event.newRow);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !IGNORED.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
const CHARACTER_CATEGORIES: Record<string, string> = {
  character: 'attributes and identity',
  character_combat: 'combat status',
  character_trait: 'traits',
  character_skill: 'skills',
  character_spell: 'spells',
  character_inventory: 'inventory',
  character_language: 'languages',
  character_technique: 'techniques',
};
const categoryFor = (entityClass: string) =>
  CHARACTER_CATEGORIES[entityClass] ?? 'character details';

async function eventPayload(
  event: DbEntityHistory,
  campaignName: string | null,
): Promise<EventNotificationPayload | null> {
  if (!event.actorUserId) return null;
  const changed = changedNotificationFields(event);
  if (!changed.length) return null;
  const before = row(event.oldRow);
  const after = row(event.newRow);
  const [actor] = await getDb()
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, event.actorUserId));
  const actorName = actor?.name ?? 'Another user';
  const base = {
    actorId: event.actorUserId,
    characterId: event.characterId,
    campaignId: event.campaignId,
    changes: [] as string[],
    href: event.campaignId ? `/campaigns/${event.campaignId}` : null,
  };
  const camp =
    campaignName ??
    (typeof (after.name ?? before.name) === 'string' && event.entityClass === 'campaign'
      ? String(after.name ?? before.name)
      : 'your campaign');
  if (event.scope === 'character') {
    if (event.ownerUserId === event.actorUserId) return null;
    const [character] = event.characterId
      ? await getDb()
          .select({ name: characters.name })
          .from(characters)
          .where(eq(characters.id, event.characterId))
      : [];
    const name =
      character?.name ??
      (event.entityClass === 'character'
        ? String(before.name ?? after.name ?? 'Your character')
        : 'Your character');
    const deleted = event.entityClass === 'character' && event.op === 'delete';
    const href = deleted || !character ? null : `/characters/${event.characterId}#history`;
    if (!deleted && event.entityClass === 'character' && changed.includes('earned_points'))
      return {
        ...base,
        href,
        topic: 'points',
        title: `Points updated for ${name}`,
        message: `${actorName} changed earned points from ${before.earned_points ?? 0} to ${after.earned_points ?? 0}.`,
      };
    const mechanicsOnly = changed.every((key) =>
      [
        'library_mechanics',
        'library_trait_id',
        'library_skill_id',
        'library_item_id',
        'enchantments',
        'library_enchantment_id',
      ].includes(key),
    );
    const topic = mechanicsOnly ? 'libraryChanges' : 'characterChanges';
    const category = mechanicsOnly ? 'linked library rules' : categoryFor(event.entityClass);
    return {
      ...base,
      href,
      topic,
      title: deleted ? `${name} was deleted` : `${name} was updated`,
      message: deleted
        ? `${actorName} deleted this character.`
        : `${actorName} updated ${category}.`,
      changes: deleted ? [] : [category],
    };
  }
  if (event.entityClass === 'campaign_membership') {
    const [campaign] = event.campaignId
      ? await getDb()
          .select({ name: campaigns.name })
          .from(campaigns)
          .where(eq(campaigns.id, event.campaignId))
      : [];
    if (event.op === 'patch' && !changed.includes('role')) return null;
    const deleted = !campaign;
    return {
      ...base,
      href: deleted ? null : base.href,
      topic: 'membership',
      title: deleted
        ? 'Campaign deleted'
        : event.op === 'create'
          ? 'Added to campaign'
          : event.op === 'delete'
            ? 'Campaign access removed'
            : 'Campaign role changed',
      message: deleted
        ? 'A campaign you belonged to was deleted.'
        : event.op === 'create'
          ? `${actorName} added you to ${campaign.name}.`
          : event.op === 'delete'
            ? `${actorName} removed you from ${campaign.name}.`
            : `${actorName} changed your role in ${campaign.name} to ${String(after.role)}.`,
    };
  }
  if (event.entityClass === 'campaign') {
    if (event.op === 'create') return null;
    if (event.op === 'delete')
      return {
        ...base,
        href: null,
        topic: 'membership',
        title: 'Campaign deleted',
        message: `${actorName} deleted ${camp}.`,
      };
    if (changed.includes('owner_id'))
      return {
        ...base,
        topic: 'membership',
        title: 'Campaign ownership transferred',
        message: `${actorName} transferred ownership of ${camp}.`,
      };
    const rules = changed.filter((key) =>
      [
        'house_rules',
        'point_target',
        'disadvantage_cap',
        'quirk_cap',
        'mana_level',
        'tech_level',
        'enforce_attribute_caps',
        'share_character_sheets',
        'allow_gm_character_editing',
      ].includes(key),
    );
    if (!rules.length) return null;
    return {
      ...base,
      topic: 'campaignChanges',
      title: 'Campaign rules updated',
      message: `${actorName} updated the rules or access settings for ${camp}.`,
      changes: rules.map((key) => key.replaceAll('_', ' ')),
    };
  }
  if (
    event.entityClass === 'adventure_log' &&
    after.visibility === 'campaign' &&
    (event.op === 'create' || before.visibility !== 'campaign')
  )
    return {
      ...base,
      topic: 'adventureLog',
      title: 'New shared adventure log',
      message: `${actorName} published a shared entry in ${camp}.`,
      href: event.campaignId ? `/campaigns/${event.campaignId}/log` : null,
    };
  return null;
}

/** Processes only newly queued events; never backfills historical notifications. */
export async function processNotificationEvents(): Promise<number> {
  return runInDbTransaction(async () => {
    const db = getDb();
    const jobs = await db
      .select({
        event: entityHistory,
        recipients: notificationHistoryQueue.recipientIds,
        campaignName: notificationHistoryQueue.campaignName,
        gestureBatchId: notificationHistoryQueue.gestureBatchId,
      })
      .from(notificationHistoryQueue)
      .innerJoin(entityHistory, eq(entityHistory.id, notificationHistoryQueue.historyId))
      .orderBy(entityHistory.revision)
      .limit(200)
      .for('update', { of: notificationHistoryQueue, skipLocked: true });
    for (const job of jobs) {
      // Audit triggers store SQL operation names; API history normalizes them on read.
      const event = {
        ...job.event,
        op:
          job.event.op === 'insert' ? 'create' : job.event.op === 'update' ? 'patch' : job.event.op,
      };
      const payload = await eventPayload(event, job.campaignName);
      if (payload) {
        const recipients = await db
          .select({ id: users.id, preferences: users.notificationPreferences })
          .from(users)
          .where(
            inArray(
              users.id,
              [...new Set(job.recipients)].filter((id) => id !== event.actorUserId),
            ),
          );
        for (const recipient of recipients) {
          if (!notificationPreferences.parse(recipient.preferences)[payload.topic]) continue;
          // Campaign-only content requires membership at delivery, except targeted access-loss events.
          if (
            event.scope === 'campaign' &&
            event.entityClass !== 'campaign_membership' &&
            payload.topic !== 'membership' &&
            event.campaignId
          ) {
            const [campaign] = await db
              .select({ ownerId: campaigns.ownerId })
              .from(campaigns)
              .where(eq(campaigns.id, event.campaignId));
            const [member] = await db
              .select({ id: campaignMemberships.id })
              .from(campaignMemberships)
              .where(
                and(
                  eq(campaignMemberships.campaignId, event.campaignId),
                  eq(campaignMemberships.userId, recipient.id),
                ),
              );
            if (!campaign || (campaign.ownerId !== recipient.id && !member)) continue;
          }
          // Explicit gestures retain their batch identity; unbatched edits share a 30-second burst.
          const burst =
            job.gestureBatchId ?? String(Math.floor(event.createdAt.getTime() / 30_000));
          const groupKey =
            event.scope === 'character'
              ? `${payload.topic}:${event.actorUserId}:${event.ownerUserId}:${event.characterId}:${burst}`
              : `history:${event.id}`;
          await db.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`notification:${recipient.id}:${groupKey}`}, 0))`,
          );
          const [existingGroup] = await db
            .select()
            .from(notifications)
            .where(
              and(eq(notifications.userId, recipient.id), eq(notifications.groupKey, groupKey)),
            )
            .for('update');
          const existing = existingGroup?.readAt ? undefined : existingGroup;
          const insertionKey = existingGroup?.readAt ? `${groupKey}:${event.id}` : groupKey;
          const oldPayload = existing ? eventNotificationPayload.safeParse(existing.payload) : null;
          const changes =
            event.entityClass === 'character' && event.op === 'delete'
              ? []
              : [
                  ...new Set([
                    ...(oldPayload?.success ? oldPayload.data.changes : []),
                    ...payload.changes,
                  ]),
                ].slice(0, 30);
          const value = eventNotificationPayload.parse({
            ...payload,
            changes,
            message:
              changes.length > 1 && event.scope === 'character'
                ? `${
                    (
                      await db
                        .select({ name: users.displayName })
                        .from(users)
                        .where(eq(users.id, event.actorUserId ?? ''))
                    )[0]?.name ?? 'Another user'
                  } updated ${changes.join(', ')}.`
                : payload.message,
          });
          if (existing)
            await db
              .update(notifications)
              .set({ payload: value, updatedAt: new Date() })
              .where(eq(notifications.id, existing.id));
          else
            await db
              .insert(notifications)
              .values({
                userId: recipient.id,
                type: 'event',
                payload: value,
                relatedId: event.entityId,
                groupKey: insertionKey,
              })
              .onConflictDoNothing();
        }
      }
      await db
        .delete(notificationHistoryQueue)
        .where(eq(notificationHistoryQueue.historyId, event.id));
    }
    return jobs.length;
  });
}
