import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  type LibraryGraph,
  type LibraryGraphEntry,
  validateLibraryGraph,
} from '../../shared/domain/libraryGraph.ts';
import { libraryEntryKey } from '../../shared/domain/libraryIdentity.ts';
import type { PricingCatalog } from '../../shared/domain/libraryPricing.ts';
import type { AuditTx } from '../db/auditContext.ts';
import {
  campaignLibraryActiveEffects,
  campaignLibraryEnchantments,
  campaignLibraryLanguages,
  campaignLibraryRaces,
  campaignLibrarySkills,
  campaignLibrarySpells,
  campaignLibraryStyles,
  campaignLibraryTechniques,
} from '../db/schema.ts';
import {
  campaignLibraryItems,
  campaignLibraryModifiers,
  campaignLibrarySources,
  campaignLibraryTraits,
} from '../db/schema.ts';

export async function loadPricingCatalog(tx: AuditTx, campaignId: string): Promise<PricingCatalog> {
  return {
    traits: await tx
      .select()
      .from(campaignLibraryTraits)
      .where(eq(campaignLibraryTraits.campaignId, campaignId)),
    items: await tx
      .select()
      .from(campaignLibraryItems)
      .where(eq(campaignLibraryItems.campaignId, campaignId)),
    modifiers: await tx
      .select()
      .from(campaignLibraryModifiers)
      .where(eq(campaignLibraryModifiers.campaignId, campaignId)),
  };
}
export async function validateLibraryPricingChange(
  tx: AuditTx,
  campaignId: string,
  section: string,
  body: Record<string, unknown>,
  existingId?: string,
): Promise<void> {
  /* compatibility guard; full graph validation follows */
  if (typeof body.sourceKey === 'string') {
    const sources = await tx
      .select()
      .from(campaignLibrarySources)
      .where(eq(campaignLibrarySources.campaignId, campaignId));
    if (
      !sources.some((source) => source.key.toLowerCase() === String(body.sourceKey).toLowerCase())
    )
      throw new HTTPException(400, { message: 'Unknown source key' });
  }
  const catalog = await loadLibraryGraph(tx, campaignId);
  const rows = [...(catalog[section] ?? [])];
  const index = rows.findIndex((row) =>
    existingId ? row.id === existingId : libraryEntryKey(row) === libraryEntryKey(body as never),
  );
  const merged = { ...(index >= 0 ? rows[index] : {}), ...body } as LibraryGraphEntry;
  if (index >= 0) rows[index] = merged;
  else rows.push(merged);
  try {
    validateLibraryGraph({ ...catalog, [section]: rows });
  } catch (error) {
    throw new HTTPException(400, { message: (error as Error).message });
  }
}

export async function loadLibraryGraph(tx: AuditTx, campaignId: string): Promise<LibraryGraph> {
  const tables = {
    traits: campaignLibraryTraits,
    items: campaignLibraryItems,
    modifiers: campaignLibraryModifiers,
    sources: campaignLibrarySources,
    skills: campaignLibrarySkills,
    spells: campaignLibrarySpells,
    languages: campaignLibraryLanguages,
    techniques: campaignLibraryTechniques,
    styles: campaignLibraryStyles,
    enchantments: campaignLibraryEnchantments,
    activeEffects: campaignLibraryActiveEffects,
    races: campaignLibraryRaces,
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(tables).map(async ([key, table]) => [
        key,
        await tx.select().from(table).where(eq(table.campaignId, campaignId)),
      ]),
    ),
  ) as LibraryGraph;
}
export async function validateLibraryDeletion(
  tx: AuditTx,
  campaignId: string,
  section: string,
  id: string,
): Promise<void> {
  const graph = await loadLibraryGraph(tx, campaignId);
  try {
    validateLibraryGraph({
      ...graph,
      [section]: (graph[section] ?? []).filter((row) => row.id !== id),
    });
  } catch (error) {
    throw new HTTPException(400, { message: (error as Error).message });
  }
}
