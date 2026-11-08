import { isDraining } from '../lifecycle.ts';
import { logTelemetryError, workerDuration, workerRuns } from '../telemetry.ts';
import { sweepRecycleBin } from './recycleBin.ts';
import { sweepUserPurges } from './userPurge.ts';

/** Fixed UTC wall-clock schedule, independent of server startup or local DST. */
export function nextNightlyAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Sweeps that run once a night. Each is replica-safe (advisory lock) and
 * isolated, so one failing sweep never blocks the others; failed items stay
 * queued for the next night.
 */
const NIGHTLY_SWEEPS: ReadonlyArray<{ name: string; run: () => Promise<unknown> }> = [
  { name: 'user purge', run: () => sweepUserPurges() },
  { name: 'recycle bin', run: () => sweepRecycleBin() },
];

export async function runNightlySweeps(): Promise<void> {
  for (const sweep of NIGHTLY_SWEEPS) {
    if (isDraining()) return;
    const start = performance.now();
    let outcome = 'success';
    try {
      await sweep.run();
    } catch {
      outcome = 'failure';
      logTelemetryError('worker.sweep.failed', { worker: sweep.name });
    } finally {
      workerRuns.add(1, { worker: sweep.name, outcome });
      workerDuration.record((performance.now() - start) / 1000, { worker: sweep.name, outcome });
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let activeRun: Promise<void> | undefined;
let stopping = false;

export function startNightlyMaintenance(environment: string): void {
  if (timer || activeRun || environment === 'test' || isDraining()) return;
  stopping = false;
  const schedule = () => {
    const now = new Date();
    timer = setTimeout(() => {
      timer = undefined;
      activeRun = runNightlySweeps().finally(() => {
        activeRun = undefined;
        if (!stopping && !isDraining()) schedule();
      });
    }, nextNightlyAt(now).getTime() - now.getTime());
    timer.unref();
  };
  schedule();
}

/** Stop scheduling and let the current item's transaction finish before DB shutdown. */
export async function stopNightlyMaintenance(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await activeRun;
}
