/**
 * Config-driven factory for the campaign-library CRUD routes and the YAML
 * import upsert loop.  `campaignLibrary.ts` calls `registerLibraryCrud`
 * once per entity kind (traits/skills/spells/items) with a
 * `LibraryEntityConfig` from `campaignLibraryEntities.ts`; each call
 * registers the POST/PATCH/DELETE triple with the same literal paths,
 * operation summaries, and status codes the hand-written routes used to
 * have, so the emitted OpenAPI document is unchanged. `upsertByKey` is the
 * same generalization applied to the YAML import's per-section
 * load-existing/key-by-name/update-or-insert/prune loop.
 *
 * Drizzle's table/row typing is computed from a table's *concrete*
 * column set, which a function generic over `TTable extends LibraryTable`
 * can't expose (the bound only promises `id`/`campaignId`). Rather than
 * spray `any` through the public surface, the handful of raw
 * `tx.insert/update/delete/select(cfg.table)` calls below go through the
 * small `asTable` helper (and cast their results right back to
 * `TTable['$inferSelect']`), so the `any` stays confined to that one
 * boundary; every function in this file still has a fully-typed
 * signature, and callers never see the escape hatch.
 */

import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { uuid } from '../../shared/schemas/common.ts';
import { requireCampaignOwner } from '../auth/permissions.ts';
import type { AuditTx } from '../db/auditContext.ts';
import { withAudit } from '../db/auditContext.ts';
import type { getDb } from '../db/client.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { type createOpenApiApp, errorResponse } from '../openapi/app.ts';
import { buildPatchSet } from '../services/patchSet.ts';
import type { LibraryEntityConfig, LibraryTable } from './campaignLibraryEntities.ts';

type LibraryRouter = ReturnType<typeof createOpenApiApp>;

/** Either a bare `getDb()` handle or a `withAudit` transaction — both support `.select()`. */
type DbOrTx = AuditTx | ReturnType<typeof getDb>;

/** The generic-table escape hatch described in the file doc comment, contained to this module. */
// biome-ignore lint/suspicious/noExplicitAny: generic Drizzle table typing can't be recovered from `TTable extends LibraryTable`.
function asTable(table: LibraryTable): any {
  return table;
}

/**
 * Rows for one campaign, in the entity's list order. Shared by
 * `GET /campaigns/{id}/library` and the YAML export route.
 */
export async function selectLibrarySection<TTable extends LibraryTable, TCreate, TUpdate, TOut>(
  db: DbOrTx,
  cfg: LibraryEntityConfig<TTable, TCreate, TUpdate, TOut>,
  campaignId: string,
): Promise<TTable['$inferSelect'][]> {
  const rows = await db
    .select()
    .from(asTable(cfg.table))
    .where(eq(cfg.table.campaignId, campaignId))
    .orderBy(...cfg.orderBy);
  return rows as TTable['$inferSelect'][];
}

/** Unordered variant of `selectLibrarySection`, used for the import's existing-rows scan. */
async function selectExisting<TTable extends LibraryTable, TCreate, TUpdate, TOut>(
  tx: AuditTx,
  cfg: LibraryEntityConfig<TTable, TCreate, TUpdate, TOut>,
  campaignId: string,
): Promise<TTable['$inferSelect'][]> {
  const rows = await tx
    .select()
    .from(asTable(cfg.table))
    .where(eq(cfg.table.campaignId, campaignId));
  return rows as TTable['$inferSelect'][];
}

/** Minimal shape the factory's handlers need from a Hono context — see the file doc comment. */
interface LibraryReqCtx<TParams, TJson> {
  get(key: 'user'): { id: string };
  req: {
    valid(target: 'param'): TParams;
    valid(target: 'json'): TJson;
  };
  json(body: unknown, status: number): Response;
  body(body: null, status: number): Response;
}

type IdParams = { id: string };
type ItemParams<TParamName extends string> = IdParams & Record<TParamName, string>;

/** Bridge for registering a handler whose context type we've already pinned above. */
type LooseOpenApiRouter = {
  openapi(route: unknown, handler: (c: never) => unknown): unknown;
};

/** Register the POST/PATCH/DELETE route triple for one library entity kind. */
export function registerLibraryCrud<
  TTable extends LibraryTable,
  TCreate,
  TUpdate,
  TOut,
  TParamName extends string,
>(
  router: LibraryRouter,
  cfg: LibraryEntityConfig<TTable, TCreate, TUpdate, TOut, TParamName>,
): void {
  const listPath = `/campaigns/{id}/library/${cfg.pathSegment}`;
  const itemPath = `${listPath}/{${cfg.paramName}}`;
  const loose = router as unknown as LooseOpenApiRouter;

  // The item-route params object has a dynamic key (`traitId`, `skillId`, ...);
  // zod's computed-property syntax collapses that to an index signature at
  // the type level, so `z.AnyZodObject` (rather than trying to preserve
  // the precise `{ id, [paramName]: string }` shape through `createRoute`)
  // is the honest type here — the handlers below read `params[cfg.paramName]`
  // against the `ItemParams<TParamName>` type declared explicitly instead.
  const itemParams: z.AnyZodObject = z.object({ id: uuid, [cfg.paramName]: uuid });

  loose.openapi(
    createRoute({
      method: 'post',
      path: listPath,
      tags: ['campaigns'],
      security: [{ bearerAuth: [] }],
      summary: cfg.summaries.post,
      request: {
        params: z.object({ id: uuid }),
        body: { required: true, content: { 'application/json': { schema: cfg.createSchema } } },
      },
      responses: {
        201: { description: 'Created', content: { 'application/json': { schema: cfg.outSchema } } },
        403: errorResponse('Forbidden'),
        409: errorResponse('Duplicate name'),
      },
    }),
    async (c: LibraryReqCtx<IdParams, TCreate>) => {
      const user = c.get('user');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await requireCampaignOwner(id, user.id);
      let row: TTable['$inferSelect'];
      try {
        row = await withAudit(user.id, undefined, async (tx) => {
          const [inserted] = (await tx
            .insert(asTable(cfg.table))
            .values(cfg.toInsertValues(id, body))
            .returning()) as TTable['$inferSelect'][];
          if (!inserted) throw new HTTPException(500, { message: 'insert failed' });
          return inserted;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new HTTPException(409, {
            message: `a ${cfg.entityLabel} with that name already exists`,
          });
        }
        throw err;
      }
      return c.json(cfg.toOut(row), 201);
    },
  );

  loose.openapi(
    createRoute({
      method: 'patch',
      path: itemPath,
      tags: ['campaigns'],
      security: [{ bearerAuth: [] }],
      summary: cfg.summaries.patch,
      request: {
        params: itemParams,
        body: { required: true, content: { 'application/json': { schema: cfg.updateSchema } } },
      },
      responses: {
        200: { description: 'Updated', content: { 'application/json': { schema: cfg.outSchema } } },
        403: errorResponse('Forbidden'),
        404: errorResponse('Not found'),
        409: errorResponse('Duplicate name'),
      },
    }),
    async (c: LibraryReqCtx<ItemParams<TParamName>, TUpdate>) => {
      const user = c.get('user');
      const params = c.req.valid('param');
      const { id } = params;
      const itemId = params[cfg.paramName];
      const body = c.req.valid('json');
      await requireCampaignOwner(id, user.id);
      const updates = buildPatchSet(
        body as Record<string, unknown>,
        cfg.stringifyKeys ? { stringifyKeys: cfg.stringifyKeys } : undefined,
      );
      let row: TTable['$inferSelect'];
      try {
        row = await withAudit(user.id, undefined, async (tx) => {
          const [updated] = (await tx
            .update(asTable(cfg.table))
            .set(updates)
            .where(and(eq(cfg.table.id, itemId), eq(cfg.table.campaignId, id)))
            .returning()) as TTable['$inferSelect'][];
          if (!updated) throw new HTTPException(404, { message: `${cfg.entityLabel} not found` });
          return updated;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new HTTPException(409, {
            message: `a ${cfg.entityLabel} with that name already exists`,
          });
        }
        throw err;
      }
      return c.json(cfg.toOut(row), 200);
    },
  );

  loose.openapi(
    createRoute({
      method: 'delete',
      path: itemPath,
      tags: ['campaigns'],
      security: [{ bearerAuth: [] }],
      summary: cfg.summaries.delete,
      request: { params: itemParams },
      responses: {
        204: { description: 'Deleted' },
        403: errorResponse('Forbidden'),
        404: errorResponse('Not found'),
      },
    }),
    async (c: LibraryReqCtx<ItemParams<TParamName>, unknown>) => {
      const user = c.get('user');
      const params = c.req.valid('param');
      const { id } = params;
      const itemId = params[cfg.paramName];
      await requireCampaignOwner(id, user.id);
      const result = await withAudit(user.id, undefined, async (tx) => {
        return (await tx
          .delete(asTable(cfg.table))
          .where(and(eq(cfg.table.id, itemId), eq(cfg.table.campaignId, id)))
          .returning({ id: cfg.table.id })) as { id: string }[];
      });
      if (result.length === 0)
        throw new HTTPException(404, { message: `${cfg.entityLabel} not found` });
      return c.body(null, 204);
    },
  );
}

export interface UpsertCounts {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
}

/**
 * Load-existing / key-by-natural-key / update-or-insert / prune-on-replace
 * for one library section of a YAML import.
 *
 * `incoming === undefined` means the YAML document omitted this section
 * entirely (only possible for spells, whose schema field is optional for
 * backward compatibility with pre-spell-library exports): every row is
 * skipped, including the replace-mode prune, so an old export without a
 * `spells:` key can never wipe the campaign's current spell library. An
 * explicit `[]` still prunes everything in replace mode.
 */
export async function upsertByKey<TTable extends LibraryTable, TCreate, TUpdate, TOut>(
  tx: AuditTx,
  cfg: LibraryEntityConfig<TTable, TCreate, TUpdate, TOut>,
  campaignId: string,
  incoming: readonly TCreate[] | undefined,
  mode: 'merge' | 'replace',
): Promise<UpsertCounts> {
  let created = 0;
  let updated = 0;
  let deleted = 0;

  const existing = await selectExisting(tx, cfg, campaignId);
  const existingByKey = new Map(
    existing.map((row) => [cfg.keyOf(row as { name: string; kind?: string }), row]),
  );
  const incomingKeys = new Set<string>();

  for (const entry of incoming ?? []) {
    const key = cfg.keyOf(entry as { name: string; kind?: string });
    incomingKeys.add(key);
    const existingRow = existingByKey.get(key);
    if (existingRow) {
      await tx
        .update(asTable(cfg.table))
        .set({ ...cfg.toUpdateValues(entry), updatedAt: new Date() })
        .where(eq(cfg.table.id, existingRow.id));
      updated++;
    } else {
      await tx.insert(asTable(cfg.table)).values(cfg.toInsertValues(campaignId, entry));
      created++;
    }
  }

  if (mode === 'replace' && incoming !== undefined) {
    for (const row of existing) {
      if (!incomingKeys.has(cfg.keyOf(row as { name: string; kind?: string }))) {
        await tx.delete(asTable(cfg.table)).where(eq(cfg.table.id, row.id));
        deleted++;
      }
    }
  }

  return { created, updated, deleted };
}
