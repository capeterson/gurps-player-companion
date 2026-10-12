/**
 * Builds the read-only preview campaign from the Lantern Coast seed recipe.
 *
 * The campaign, its characters and the guest that reads it belong to
 * credential-less system accounts. Every content write runs through the normal
 * API in-process, inside one transaction that sets `app.preview_refresh`, the
 * only way past the database guard on preview rows. A deploy whose content
 * version differs replaces the campaign; an up-to-date one is left untouched.
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../../shared/schemas/notificationPreferences.ts';
import { createApp } from '../../app.ts';
import { signAccessToken } from '../../auth/jwt.ts';
import { type AppConfig, loadConfig } from '../../config.ts';
import { withAudit } from '../../db/auditContext.ts';
import { getDb, runInDbTransaction } from '../../db/client.ts';
import {
  type SystemRole,
  campaignMemberships,
  campaigns,
  characters,
  previewCampaign,
  users,
} from '../../db/schema.ts';
import { readLanternCoastYaml } from '../../db/seeds/bootstrapFiles.ts';
import { populateLanternCoast } from '../../db/seeds/lanternCoastContent.ts';
import { LANTERN_SEED_VERSION } from '../../db/seeds/lanternCoastRevision.ts';
import { inProcessSeedRequest, lanternArtworkUploader } from '../../db/seeds/seedTransport.ts';
import { advanceCampaignProjectionRevision } from '../libraryInvalidation.ts';

/** Bump the suffix when the preview recipe changes without a Lantern seed version change. */
export const PREVIEW_CONTENT_VERSION = `lantern-${LANTERN_SEED_VERSION}/preview-1`;
export const PREVIEW_EMAIL_DOMAIN = 'preview.invalid';
export const PREVIEW_GUEST_EMAIL = `guest@${PREVIEW_EMAIL_DOMAIN}`;
const PREVIEW_GM_EMAIL = `game-master@${PREVIEW_EMAIL_DOMAIN}`;

/** Never a valid argon2 encoding, so password verification always fails. */
const UNUSABLE_PASSWORD_HASH = '!preview-system-account';

/** Registration refuses this reserved domain so no one can claim a system address first. */
export function isReservedPreviewEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${PREVIEW_EMAIL_DOMAIN}`);
}

async function ensureSystemUser(email: string, displayName: string, role: SystemRole) {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) {
    if (existing.systemRole !== role)
      throw new Error(`${email} exists but is not a ${role} system account`);
    return existing;
  }
  const [created] = await db
    .insert(users)
    .values({
      email,
      displayName,
      passwordHash: UNUSABLE_PASSWORD_HASH,
      systemRole: role,
      notificationPreferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        emailInvitations: false,
        emailInvitationAccepted: false,
      },
    })
    .returning();
  if (!created) throw new Error(`Failed to create system account ${email}`);
  return created;
}

export interface PreviewCampaignRef {
  readonly campaignId: string;
  readonly guestUserId: string;
  readonly contentVersion: string;
}

export async function loadPreviewCampaign(): Promise<PreviewCampaignRef | null> {
  const [row] = await getDb().select().from(previewCampaign);
  return row
    ? {
        campaignId: row.campaignId,
        guestUserId: row.guestUserId,
        contentVersion: row.contentVersion,
      }
    : null;
}

/** Removes the previous preview campaign and every character its fixtures own. */
async function removePreviewCampaign(campaignId: string): Promise<void> {
  const db = getDb();
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!campaign) return;
  const fixtures = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.systemRole, 'preview_fixture'));
  await withAudit(campaign.ownerId, undefined, async (tx) => {
    await tx.delete(characters).where(eq(characters.campaignId, campaignId));
    if (fixtures.length > 0)
      await tx.delete(characters).where(
        inArray(
          characters.ownerId,
          fixtures.map((fixture) => fixture.id),
        ),
      );
    await tx.delete(campaigns).where(eq(campaigns.id, campaignId));
  });
}

/**
 * Public member routes refuse system accounts, so provisioning adds them here.
 * The database permits it only because this transaction set app.preview_refresh.
 */
async function addSystemMember(
  ownerId: string,
  campaignId: string,
  userId: string,
  role: 'member' | 'manager',
): Promise<void> {
  await withAudit(ownerId, undefined, async (tx) => {
    await tx.insert(campaignMemberships).values({ campaignId, userId, role });
    await advanceCampaignProjectionRevision(tx, campaignId);
  });
}

export interface ProvisionResult {
  readonly campaignId: string;
  readonly rebuilt: boolean;
}

/**
 * Idempotent and serialized across replicas. `yaml` lets tests supply the
 * recipe; `force` rebuilds even when the recorded version is current.
 */
export async function provisionPreviewCampaign(
  options: { yaml?: string; force?: boolean } = {},
): Promise<ProvisionResult> {
  return runInDbTransaction(async () => {
    const db = getDb();
    await db.execute(sql`select pg_advisory_xact_lock(hashtextextended('gpc:preview', 0))`);
    await db.execute(sql`select set_config('app.preview_refresh', 'on', true)`);
    const guest = await ensureSystemUser(PREVIEW_GUEST_EMAIL, 'Guest', 'preview_guest');
    const current = await loadPreviewCampaign();
    if (current && current.contentVersion === PREVIEW_CONTENT_VERSION && !options.force) {
      return { campaignId: current.campaignId, rebuilt: false };
    }
    if (current) await removePreviewCampaign(current.campaignId);

    const yaml = options.yaml ?? (await readLanternCoastYaml());
    const owner = await ensureSystemUser(PREVIEW_GM_EMAIL, 'Game Master', 'preview_fixture');
    const ownerToken = (await signAccessToken(owner.id, owner.authVersion)).token;
    const request = inProcessSeedRequest(createApp(loadConfig()));
    const result = await populateLanternCoast({
      yaml,
      request,
      uploadArtwork: lanternArtworkUploader(request),
      ownerActor: ownerToken,
      async playerFor(fixture, campaignPath) {
        const [localPart] = fixture.email.split('@');
        const player = await ensureSystemUser(
          `${localPart}@${PREVIEW_EMAIL_DOMAIN}`,
          fixture.displayName,
          'preview_fixture',
        );
        const campaignId = campaignPath.split('/').at(-1);
        if (!campaignId) throw new Error(`Unexpected campaign path ${campaignPath}`);
        await addSystemMember(
          owner.id,
          campaignId,
          player.id,
          fixture.manager ? 'manager' : 'member',
        );
        return (await signAccessToken(player.id, player.authVersion)).token;
      },
      async nextEffectId() {
        const generated = await db.execute<{ id: string }>(sql`select uuidv7()::text as id`);
        const id = generated.rows[0]?.id;
        if (!id) throw new Error('Failed to generate active effect UUID');
        return id;
      },
    });
    await addSystemMember(owner.id, result.campaignId, guest.id, 'member');
    await db
      .insert(previewCampaign)
      .values({
        singleton: true,
        campaignId: result.campaignId,
        guestUserId: guest.id,
        contentVersion: PREVIEW_CONTENT_VERSION,
      })
      .onConflictDoUpdate({
        target: previewCampaign.singleton,
        set: {
          campaignId: result.campaignId,
          guestUserId: guest.id,
          contentVersion: PREVIEW_CONTENT_VERSION,
          provisionedAt: new Date(),
        },
      });
    return { campaignId: result.campaignId, rebuilt: true };
  });
}

const RETRY_DELAY_MS = 5 * 60_000;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let stopped = false;

/** Server startup hook: provisions in the background and retries after failures. */
export function startPreviewProvisioning(config: AppConfig): void {
  if (!config.previewModeEnabled || config.environment === 'test' || running) return;
  stopped = false;
  const attempt = () => {
    retryTimer = undefined;
    running = provisionPreviewCampaign()
      .then((result) => {
        if (result.rebuilt) console.log(`guest preview provisioned: ${result.campaignId}`);
      })
      .catch((error) => {
        console.error('guest preview provisioning failed; retrying in 5 minutes', error);
        if (!stopped) retryTimer = setTimeout(attempt, RETRY_DELAY_MS);
      })
      .finally(() => {
        running = undefined;
      });
  };
  attempt();
}

export async function stopPreviewProvisioning(): Promise<void> {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = undefined;
  await running;
}
