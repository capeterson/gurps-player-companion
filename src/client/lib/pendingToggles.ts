/** Account preference saves remain tracked after their component unmounts. */
interface PendingToggle {
  sessionId: string | null;
  active: boolean;
  onDiscard: (() => void) | undefined;
}
const pending = new Set<PendingToggle>();

export function beginPendingToggle(sessionId: string | null, onDiscard?: () => void) {
  const entry: PendingToggle = { sessionId, active: true, onDiscard };
  pending.add(entry);
  return {
    isActive: () => entry.active,
    end: () => {
      entry.active = false;
      pending.delete(entry);
    },
  };
}

export function hasPendingToggles(sessionId: string | undefined): boolean {
  return [...pending].some((entry) => entry.active && entry.sessionId === (sessionId ?? null));
}

export function discardPendingToggles(sessionId: string | undefined): void {
  for (const entry of pending) {
    if (entry.sessionId === (sessionId ?? null)) {
      entry.active = false;
      pending.delete(entry);
      entry.onDiscard?.();
    }
  }
}
