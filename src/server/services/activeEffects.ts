import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { activeEffectsField } from '../../shared/schemas/activeEffects.ts';
import { requireCampaignMember } from '../auth/permissions.ts';
import type { AuditTx } from '../db/auditContext.ts';
import { campaignLibraryActiveEffects, characters, inventoryItems } from '../db/schema.ts';

/** Shared by REST and sync, inside the owning character's audited write. */
export async function prepareActiveEffects(
  tx: AuditTx,
  actorId: string,
  characterId: string | null,
  campaignId: string | null,
  updates: Record<string, unknown>,
) {
  if (updates.activeEffects === undefined) return;
  const entries = activeEffectsField.parse(updates.activeEffects);
  for (const entry of entries) {
    if (entry.sourceInventoryId) {
      const [item] = await tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.id, entry.sourceInventoryId),
            eq(inventoryItems.characterId, characterId ?? '00000000-0000-0000-0000-000000000000'),
          ),
        );
      if (item) entry.sourceInventoryId = item.id;
      // A consumed/deleted source may remain as historical provenance. A new
      // reference must still resolve to inventory owned by this character.
      const [previous] =
        !item && characterId
          ? await tx
              .select({ activeEffects: characters.activeEffects })
              .from(characters)
              .where(eq(characters.id, characterId))
          : [];
      const historical = previous?.activeEffects.some(
        (e) => e.id === entry.id && e.sourceInventoryId === entry.sourceInventoryId,
      );
      if (!item && !historical)
        throw new HTTPException(400, {
          message: 'Effect source inventory item must belong to this character',
        });
    }
    if (!entry.definitionId) continue;
    if (!campaignId)
      throw new HTTPException(403, { message: 'Active effect definition requires a campaign' });
    await requireCampaignMember(campaignId, actorId, tx);
    const [source] = await tx
      .select()
      .from(campaignLibraryActiveEffects)
      .where(
        and(
          eq(campaignLibraryActiveEffects.id, entry.definitionId),
          eq(campaignLibraryActiveEffects.campaignId, campaignId),
        ),
      )
      .for('share');
    if (!source)
      throw new HTTPException(403, {
        message: 'Active effect definition unavailable in this campaign',
      });
    Object.assign(entry, {
      definitionId: source.id,
      name: source.name,
      description: source.description,
      source: source.source,
      tags: source.tags,
      effects: source.effects,
      capabilities: source.capabilities,
      stacking: source.stacking,
      sourceRevision: Number(source.revision),
      sourceCampaignId: source.campaignId,
    });
  }
  updates.activeEffects = activeEffectsField.parse(entries);
}
export async function refreshActiveEffectDefinition(
  tx: AuditTx,
  campaignId: string,
  definitionId: string,
  detach: boolean,
) {
  const [source] = await tx
    .select()
    .from(campaignLibraryActiveEffects)
    .where(eq(campaignLibraryActiveEffects.id, definitionId))
    .for('update');
  if (!source) return;
  const rows = await tx
    .select()
    .from(characters)
    .where(eq(characters.campaignId, campaignId))
    .for('update');
  for (const row of rows) {
    if (!row.activeEffects.some((e) => e.definitionId === definitionId)) continue;
    const entries = row.activeEffects.map((entry) =>
      entry.definitionId !== definitionId
        ? entry
        : detach
          ? { ...entry, definitionId: null }
          : {
              ...entry,
              name: source.name,
              description: source.description,
              source: source.source,
              tags: source.tags,
              effects: source.effects,
              capabilities: source.capabilities,
              stacking: source.stacking,
              sourceRevision: Number(source.revision),
            },
    );
    await tx
      .update(characters)
      .set({ activeEffects: activeEffectsField.parse(entries), updatedAt: new Date() })
      .where(eq(characters.id, row.id));
  }
}
