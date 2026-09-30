import { isDraining } from '../lifecycle.ts';
import { processNotificationEmails } from './notificationEmails.ts';
import { processNotificationEvents } from './notificationEvents.ts';
let timer: ReturnType<typeof setTimeout> | undefined;
let active: Promise<void> | undefined;
let stopping = false;
export function startNotificationMaintenance(environment: string): void {
  if (timer || active || environment === 'test' || process.env.NODE_ENV === 'test' || isDraining())
    return;
  stopping = false;
  const schedule = () => {
    timer = setTimeout(() => {
      timer = undefined;
      active = processNotificationEvents()
        .then(() => processNotificationEmails())
        .then(() => undefined)
        .catch(() => console.error('notification processing failed; will retry'))
        .finally(() => {
          active = undefined;
          if (!stopping && !isDraining()) schedule();
        });
    }, 5_000);
    timer.unref();
  };
  schedule();
}
export async function stopNotificationMaintenance(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await active;
}
