import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { getDb } from '../db/client.ts';
import { campaignMemberships, campaigns, characters } from '../db/schema.ts';
import { matchOperation } from '../mcp/operationManifest.ts';
import type { AppEnv } from '../openapi/app.ts';
import { publish } from './wsBus.ts';

interface Audience {
  campaignId?: string;
  recipients: Set<string>;
}

async function campaignAudience(campaignId: string): Promise<Audience> {
  const db = getDb();
  const [campaign] = await db
    .select({ ownerId: campaigns.ownerId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId));
  const members = await db
    .select({ userId: campaignMemberships.userId })
    .from(campaignMemberships)
    .where(eq(campaignMemberships.campaignId, campaignId));
  return {
    campaignId,
    recipients: new Set([
      ...(campaign ? [campaign.ownerId] : []),
      ...members.map((member) => member.userId),
    ]),
  };
}

async function characterAudience(characterId: string): Promise<Audience> {
  const [character] = await getDb()
    .select({ ownerId: characters.ownerId, campaignId: characters.campaignId })
    .from(characters)
    .where(eq(characters.id, characterId));
  if (!character) return { recipients: new Set() };
  const audience = character.campaignId
    ? await campaignAudience(character.campaignId)
    : { recipients: new Set<string>() };
  audience.recipients.add(character.ownerId);
  return audience;
}

function idAfterPrefix(path: string, prefix: string): string | undefined {
  const match = new RegExp(`^${prefix}/([^/]+)(?:/|$)`).exec(path);
  if (!match?.[1]) return undefined;
  try {
    const id = decodeURIComponent(match[1]);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}

async function responseId(response: Response): Promise<string | undefined> {
  if (!response.headers.get('content-type')?.includes('json')) return undefined;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { id?: unknown } | null;
  return typeof body?.id === 'string' ? body.id : undefined;
}

async function safeAudience(
  kind: 'character' | 'campaign',
  id: string | undefined,
): Promise<Audience> {
  if (!id) return { recipients: new Set() };
  try {
    return kind === 'character' ? await characterAudience(id) : await campaignAudience(id);
  } catch {
    return { recipients: new Set() };
  }
}

/**
 * Shared post-commit invalidation for REST and delegated calls. The snapshot is
 * taken on both sides of a write so deletes and ownership/campaign transfers
 * notify the viewers who could see either projection. Durable cursor pulls
 * remain the correctness path; these frames only wake clients sooner.
 */
export const mutationInvalidation: MiddlewareHandler<AppEnv> = async (c, next) => {
  const pathname = new URL(c.req.url).pathname;
  const policy = matchOperation(c.req.method, pathname);
  // Campaign-library handlers already publish the same campaign-wide,
  // post-commit sync nudge through publishLibraryInvalidation.
  if (
    !policy ||
    policy.kind !== 'tool' ||
    policy.method === 'GET' ||
    pathname.includes('/library/')
  ) {
    await next();
    return;
  }

  const characterId = idAfterPrefix(pathname, '/api/v1/characters');
  const campaignId = idAfterPrefix(pathname, '/api/v1/campaigns');
  const kind = characterId ? 'character' : campaignId ? 'campaign' : undefined;
  const before = kind
    ? await safeAudience(kind, kind === 'character' ? characterId : campaignId)
    : { recipients: new Set<string>() };

  await next();
  if (!c.res.ok) return;

  let affectedId = kind === 'character' ? characterId : campaignId;
  if (!affectedId) affectedId = await responseId(c.res);
  const inferredKind =
    kind ??
    (pathname === '/api/v1/characters'
      ? 'character'
      : pathname === '/api/v1/campaigns'
        ? 'campaign'
        : undefined);
  const after = inferredKind
    ? await safeAudience(inferredKind, affectedId)
    : { recipients: new Set<string>() };
  const actorId = c.get('user')?.id;
  const recipients = new Set([
    ...before.recipients,
    ...after.recipients,
    ...(actorId ? [actorId] : []),
  ]);
  const effectiveCampaignId =
    before.campaignId ?? after.campaignId ?? (inferredKind === 'campaign' ? affectedId : undefined);
  for (const userId of recipients) {
    publish(userId, {
      kind: 'sync_invalidate',
      ...(effectiveCampaignId ? { campaignId: effectiveCampaignId } : {}),
      emittedAt: new Date().toISOString(),
    });
  }
};
