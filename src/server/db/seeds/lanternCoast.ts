import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, sql } from 'drizzle-orm';
import { mediaCapabilities, mediaManifest } from '../../../shared/schemas/media.ts';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { loadConfig } from '../../config.ts';
import { closeDb, getDb, runInDbSavepoint, runInDbTransaction } from '../client.ts';
import { campaigns, users } from '../schema.ts';
import { ensureDemoUser } from './accounts.ts';
import {
  LANTERN_CAMPAIGN_NAME,
  type LanternArtworkUpload,
  type LanternRequest,
  populateLanternCoast,
} from './lanternCoastContent.ts';
import { recordLanternSeedVersion } from './lanternCoastRevision.ts';
export { LANTERN_CAMPAIGN_NAME } from './lanternCoastContent.ts';

const ARTWORK_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg'];

async function readArtwork(slug: string): Promise<Buffer | null> {
  for (const extension of ARTWORK_EXTENSIONS) {
    try {
      return await readFile(
        new URL(`../../../../bootstrap/lantern_coast_art/${slug}.${extension}`, import.meta.url),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

/** Optional art lives beside the YAML; absent files or disabled storage skip uploads. */
export function lanternArtworkUploader(request: LanternRequest): LanternArtworkUpload {
  let enabled: boolean | undefined;
  return async (actor, targetType, targetId, slug) => {
    const bytes = await readArtwork(slug);
    if (!bytes) return null;
    enabled ??= mediaCapabilities.parse(await request(actor, '/media/capabilities', 'GET')).enabled;
    if (!enabled) return null;
    const manifest = mediaManifest.parse(
      await request(actor, '/media/uploads', 'POST', {
        clientUploadId: randomUUID(),
        targetType,
        targetId,
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        base64: bytes.toString('base64'),
      }),
    );
    if (manifest.state !== 'ready') throw new Error(`Lantern artwork ${slug} is ${manifest.state}`);
    return manifest.id;
  };
}

/**
 * A single atomic, insert-once fixture. Normal routes validate all campaign and
 * character writes, capture owned library mechanics, and record audit/revisions.
 * The owner/name key deliberately does not adopt another account's demo campaign.
 * libraryText lets integration tests exercise a late fixture failure and rollback.
 */
export async function seedLanternCoast(ownerId: string, libraryText?: string) {
  return runInDbSavepoint(async () => {
    const db = getDb();
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`seed:lantern:${ownerId}`}, 0))`,
    );
    const [existing] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.ownerId, ownerId), eq(campaigns.name, LANTERN_CAMPAIGN_NAME)));
    if (existing) return { campaignId: existing.id, created: false };

    const yaml =
      libraryText ??
      (await readFile(
        new URL('../../../../bootstrap/lantern_coast.yaml', import.meta.url),
        'utf8',
      ));
    const app = createApp(loadConfig());
    const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
    if (!owner) throw new Error('Seed owner does not exist');
    const ownerToken = (await signAccessToken(owner.id, owner.authVersion)).token;
    const request = async (
      token: string,
      path: string,
      method = 'POST',
      body?: unknown,
    ): Promise<unknown> => {
      const response = await app.request(`/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok)
        throw new Error(
          `Lantern seed ${method} ${path}: ${response.status} ${await response.text()}`,
        );
      return response.status === 204 ? null : response.json();
    };
    const result = await populateLanternCoast({
      yaml,
      request,
      uploadArtwork: lanternArtworkUploader(request),
      ownerActor: ownerToken,
      async playerFor(fixture, campaignPath) {
        const player = await ensureDemoUser(fixture.email, fixture.displayName);
        await request(ownerToken, `${campaignPath}/members`, 'POST', { email: player.email });
        if (fixture.manager)
          await request(ownerToken, `${campaignPath}/members/${player.id}`, 'PATCH', {
            role: 'manager',
          });
        return (await signAccessToken(player.id, player.authVersion)).token;
      },
      async nextEffectId() {
        const result = await db.execute<{ id: string }>(sql`select uuidv7()::text as id`);
        const id = result.rows[0]?.id;
        if (!id) throw new Error('Failed to generate active effect UUID');
        return id;
      },
    });
    await recordLanternSeedVersion(result.campaignId, ownerId);
    return { campaignId: result.campaignId, created: true };
  });
}

/** Standalone reusable seed; the standard db:seed script also calls this export. */
if (import.meta.main) {
  try {
    const result = await runInDbTransaction(async () => {
      const owner = await ensureDemoUser('seed@example.invalid', 'Seed');
      return seedLanternCoast(owner.id);
    });
    console.log(`Lantern Coast ${result.created ? 'created' : 'preserved'}: ${result.campaignId}`);
  } catch (error) {
    console.error('Lantern seed failed', error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
