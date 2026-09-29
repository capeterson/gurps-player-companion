import { eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.ts';
import { mediaAssets } from '../../db/schema.ts';
import { mediaConfig } from './config.ts';
import { mediaStorage } from './storage.ts';

/** Database lease makes this safe to schedule in every app replica. */
export async function sweepMedia(): Promise<void> {
  if (!mediaConfig().configured) return;
  // This transaction lock also protects backup-pause installation. A backup
  // waits for the entire active sweep (including object deletes) to finish.
  // Transaction locks also work through transaction-mode connection pooling.
  const db = getDb();
  await db.transaction(async (lockTx) => {
    const lock = await lockTx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('gpc:media-cleanup')) as acquired`,
    );
    if (!lock.rows[0]?.acquired) return;
    const lease =
      await db.execute(sql`insert into media_counters(key,amount,expires_at) values ('maintenance',0,now()+interval '5 minutes')
    on conflict(key) do update set expires_at=excluded.expires_at where media_counters.expires_at<=now() returning key`);
    if (!lease.rows.length) return;
    const pause = await db.execute(
      sql`select key from media_counters where key='backup-pause' and expires_at>now()`,
    );
    if (pause.rows.length) return;
    // Mark under a row lock before deleting objects. An attachment writer
    // waiting on that lock then rejects rather than publishing a missing file.
    const victims = await db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        select id from media_assets a where
        (a.lease_until is null or a.lease_until < now()-interval '5 minutes')
        and (a.state in ('cancelled','deleting')
          or (a.published_at is null and a.created_at<now()-interval '24 hours')
          or (a.detached_at<now()-interval '7 days')
          or a.uploader_id is null
          or (a.target_type='character' and not exists(select 1 from characters c where c.id=a.target_id))
          or (a.target_type='campaign' and not exists(select 1 from campaigns c where c.id=a.target_id)))
        and not exists(select 1 from characters c where c.portrait_asset_id=a.id)
        and not exists(select 1 from campaigns c where c.cover_asset_id=a.id)
        order by a.created_at limit 50 for update skip locked`);
      for (const row of result.rows)
        await tx.update(mediaAssets).set({ state: 'deleting' }).where(eq(mediaAssets.id, row.id));
      return result.rows;
    });
    const storage = mediaStorage();
    for (const asset of victims) {
      let cursor: string | undefined;
      do {
        const page = await storage.list(`images/${asset.id}/`, cursor);
        for (const key of page.keys) await storage.remove(key);
        cursor = page.cursor;
      } while (cursor);
      await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    }
    await db.execute(
      sql`delete from media_counters where expires_at<now()-interval '1 day' and key not in ('maintenance','backup-pause')`,
    );
    if (victims.length) console.info('media cleanup completed', { assets: victims.length });
  });
  // The lease expires naturally; never release a successor's lease.
}

let timer: ReturnType<typeof setInterval> | undefined;
let activeSweep: Promise<void> | undefined;
export function startMediaMaintenance() {
  if (timer || !mediaConfig().configured || process.env.ENVIRONMENT === 'test') return;
  const tick = () => {
    if (activeSweep) return;
    activeSweep = sweepMedia()
      .catch(() => console.error('media cleanup failed; will retry'))
      .finally(() => {
        activeSweep = undefined;
      });
  };
  timer = setInterval(tick, 60 * 60_000);
  timer.unref();
  tick();
}

/** Graceful shutdown: schedule no more sweeps and wait for the running one. */
export async function stopMediaMaintenance(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = undefined;
  await activeSweep;
}
