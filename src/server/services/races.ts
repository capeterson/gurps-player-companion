import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { resolveRaceSelection, switchOwnedRaceForm } from '../../shared/domain/race.ts';
import { HUMAN_RACE, characterRace } from '../../shared/schemas/race.ts';
import { requireCampaignMember } from '../auth/permissions.ts';
import type { AuditTx } from '../db/auditContext.ts';
import { campaignLibraryRaces, campaigns, characters } from '../db/schema.ts';
import { raceEntity } from '../routes/campaignLibraryEntities.ts';

/** REST and sync share this trust boundary. Caller snapshots are previews only. */
export async function prepareRace(
  tx: AuditTx,
  actorId: string,
  characterId: string | null,
  campaignId: string | null,
  updates: Record<string, unknown>,
) {
  if (updates.race === undefined) return;
  const requested = characterRace.parse(updates.race);
  const [previous] = characterId
    ? await tx
        .select({ race: characters.race, campaignId: characters.campaignId })
        .from(characters)
        .where(eq(characters.id, characterId))
        .for('update')
    : [];
  const effectiveCampaignId =
    previous && updates.campaignId === undefined ? previous.campaignId : campaignId;
  const old = previous?.race;
  const identity = (value: typeof requested) =>
    JSON.stringify([value.selection.raceId, value.selection.variantKey, value.selection.lensIds]);
  // Owned rules survive source deletion, edits, restrictions, and campaign transfer.
  // A form-only change uses the server's retained copy, never the submitted mechanics.
  if (old && identity(old) === identity(requested)) {
    try {
      updates.race = switchOwnedRaceForm(old, requested.selection.formKey);
      return;
    } catch (error) {
      throw new HTTPException(400, { message: (error as Error).message });
    }
  }
  const ids = [
    ...(requested.selection.raceId ? [requested.selection.raceId] : []),
    ...requested.selection.lensIds,
  ];
  if (!ids.length) {
    if (requested.selection.variantKey || requested.selection.formKey)
      throw new HTTPException(400, { message: 'Human has no variants or alternate forms' });
    updates.race = structuredClone(HUMAN_RACE);
    return;
  }
  if (!effectiveCampaignId)
    throw new HTTPException(403, { message: 'Selecting a race requires its campaign' });
  await requireCampaignMember(effectiveCampaignId, actorId, tx);
  const [campaign] = await tx
    .select({ ownerId: campaigns.ownerId })
    .from(campaigns)
    .where(eq(campaigns.id, effectiveCampaignId));
  const rows = await tx
    .select()
    .from(campaignLibraryRaces)
    .where(
      and(
        eq(campaignLibraryRaces.campaignId, effectiveCampaignId),
        inArray(campaignLibraryRaces.id, ids),
      ),
    )
    .for('share');
  const available = rows.filter((row) => !row.restricted || campaign?.ownerId === actorId);
  for (const preview of requested.snapshot?.sources ?? []) {
    const source = available.find((row) => row.id === preview.id);
    if (
      ids.includes(preview.id) &&
      source &&
      preview.revision >= 0 &&
      Number(source.revision) !== preview.revision
    )
      throw new HTTPException(400, {
        message: 'A selected race definition changed; review the current race before applying',
      });
  }
  try {
    updates.race = resolveRaceSelection(requested.selection, available.map(raceEntity.toOut));
  } catch (error) {
    throw new HTTPException(400, { message: (error as Error).message });
  }
}
