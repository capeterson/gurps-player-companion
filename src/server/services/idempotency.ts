import { createHash } from 'node:crypto';
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { resolveAuthHeader } from '../auth/session.ts';
import { getDb, runInDbSavepoint, runInDbTransaction } from '../db/client.ts';
import { campaignMemberships, campaigns, characters, mutationIdempotency } from '../db/schema.ts';
import { matchOperation } from '../mcp/operationManifest.ts';
import type { AppEnv } from '../openapi/app.ts';
import { trustedExecutionFor } from './executionContext.ts';

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60_000;

class RollbackHttpResponse extends Error {
  constructor(readonly response: Response) {
    super(`operation returned HTTP ${response.status}`);
  }
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function permissionHash(userId: string): Promise<string> {
  const db = getDb();
  const memberships = await db
    .select({
      campaignId: campaignMemberships.campaignId,
      role: campaignMemberships.role,
      ownerId: campaigns.ownerId,
      shareCharacterSheets: campaigns.shareCharacterSheets,
      allowGmCharacterEditing: campaigns.allowGmCharacterEditing,
    })
    .from(campaignMemberships)
    .innerJoin(campaigns, eq(campaignMemberships.campaignId, campaigns.id))
    .where(eq(campaignMemberships.userId, userId));
  const owned = await db
    .select({
      id: campaigns.id,
      shareCharacterSheets: campaigns.shareCharacterSheets,
      allowGmCharacterEditing: campaigns.allowGmCharacterEditing,
    })
    .from(campaigns)
    .where(eq(campaigns.ownerId, userId));
  const ownedCharacters = await db
    .select({ id: characters.id, campaignId: characters.campaignId })
    .from(characters)
    .where(eq(characters.ownerId, userId));
  const accessibleCampaignIds = [
    ...new Set([
      ...memberships.map((membership) => membership.campaignId),
      ...owned.map((campaign) => campaign.id),
    ]),
  ];
  const accessibleCharacters =
    accessibleCampaignIds.length === 0
      ? ownedCharacters
      : await db
          .select({
            id: characters.id,
            ownerId: characters.ownerId,
            campaignId: characters.campaignId,
          })
          .from(characters)
          .where(
            or(
              eq(characters.ownerId, userId),
              inArray(characters.campaignId, accessibleCampaignIds),
            ),
          );
  return sha(
    JSON.stringify({
      memberships: memberships.sort((a, b) => a.campaignId.localeCompare(b.campaignId)),
      owned: owned.sort((a, b) => a.id.localeCompare(b.id)),
      accessibleCharacters: accessibleCharacters.sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
}

export const durableIdempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  const key = c.req.header('idempotency-key');
  const policy = matchOperation(c.req.method, new URL(c.req.url).pathname);
  if (!key || !policy || policy.kind !== 'tool' || policy.method === 'GET') {
    await next();
    return;
  }
  if (key.length > 200) return c.json({ error: 'invalid_idempotency_key' }, 422);
  const trusted = trustedExecutionFor(c.req.raw);
  const user = trusted?.user ?? (await resolveAuthHeader(c.req.header('authorization')));
  if (!user) {
    await next();
    return;
  }
  if (user.suspendedAt) return c.json({ error: 'suspended' }, 403);
  const clientKey = trusted?.oauthClientDbId ?? user.apiKeyId ?? 'app-session';
  const operationKey = `${policy.method} ${policy.path}`;
  const body = await c.req.raw.clone().text();
  const inputHash = sha(
    JSON.stringify([c.req.method, c.req.path, new URL(c.req.url).search, body]),
  );

  const result = await runInDbTransaction(async () => {
    const db = getDb();
    let currentPermissionHash = await permissionHash(user.id);
    await db.delete(mutationIdempotency).where(lt(mutationIdempotency.expiresAt, new Date()));
    let [existing] = await db
      .select()
      .from(mutationIdempotency)
      .where(
        and(
          eq(mutationIdempotency.actorUserId, user.id),
          eq(mutationIdempotency.clientKey, clientKey),
          eq(mutationIdempotency.operationKey, operationKey),
          eq(mutationIdempotency.idempotencyKey, key),
        ),
      )
      .for('update');
    let insertedId: string | undefined;
    if (!existing) {
      const [record] = await db
        .insert(mutationIdempotency)
        .values({
          actorUserId: user.id,
          clientKey,
          operationKey,
          idempotencyKey: key,
          inputHash,
          permissionHash: currentPermissionHash,
          expiresAt: new Date(Date.now() + IDEMPOTENCY_RETENTION_MS),
        })
        .onConflictDoNothing()
        .returning({ id: mutationIdempotency.id });
      insertedId = record?.id;
      if (!insertedId) {
        [existing] = await db
          .select()
          .from(mutationIdempotency)
          .where(
            and(
              eq(mutationIdempotency.actorUserId, user.id),
              eq(mutationIdempotency.clientKey, clientKey),
              eq(mutationIdempotency.operationKey, operationKey),
              eq(mutationIdempotency.idempotencyKey, key),
            ),
          )
          .for('update');
      }
    }
    if (existing) {
      // The select may have waited for the winning transaction. Recompute now,
      // after its domain mutation and authority effects have committed.
      currentPermissionHash = await permissionHash(user.id);
      if (existing.inputHash !== inputHash) return { kind: 'conflict' as const };
      if (existing.permissionHash !== currentPermissionHash)
        return { kind: 'reauthorize' as const };
      if (existing.completedAt && existing.responseStatus !== null) {
        return {
          kind: 'replay' as const,
          status: existing.responseStatus,
          body: existing.responseBody ?? '',
          contentType: existing.responseContentType,
        };
      }
      throw new Error('incomplete idempotency record inside committed transaction');
    }
    if (!insertedId) throw new Error('idempotency reservation failed');
    try {
      await runInDbSavepoint(async () => {
        await next();
        if (!c.res.ok) throw new RollbackHttpResponse(c.res.clone());
      });
    } catch (error) {
      if (!(error instanceof RollbackHttpResponse)) throw error;
      c.res = error.response;
    }
    if (c.res.status >= 500) throw new Error(`operation failed with HTTP ${c.res.status}`);
    const response = c.res.clone();
    const responseBody = await response.text();
    const responseContentType = response.headers.get('content-type');
    await db
      .update(mutationIdempotency)
      .set({
        responseStatus: response.status,
        responseContentType,
        responseBody,
        permissionHash: await permissionHash(user.id),
        completedAt: new Date(),
      })
      .where(eq(mutationIdempotency.id, insertedId));
    return { kind: 'executed' as const };
  });

  if (result.kind === 'conflict')
    return c.json({ error: 'idempotency_key_reused_with_different_input' }, 409);
  if (result.kind === 'reauthorize')
    return c.json(
      {
        error:
          'permissions_changed; the original outcome exists but cannot be replayed under current authority',
      },
      409,
    );
  if (result.kind === 'replay') {
    return new Response(result.status === 204 ? null : result.body, {
      status: result.status,
      headers: {
        ...(result.contentType ? { 'content-type': result.contentType } : {}),
        'idempotency-replayed': 'true',
      },
    });
  }
};
