/** Device-local offline choice, physical connectivity and observed reachability. */
export const OFFLINE_MODE_KEY = 'gpc:offline-mode:v1';
export const CONNECTION_CHANGE_EVENT = 'gpc:connection-change';

export interface ConnectionStatus {
  readonly manualOffline: boolean;
  readonly deviceOnline: boolean;
  readonly online: boolean;
}

function deviceOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function readOfflineChoice(): boolean {
  try {
    return localStorage.getItem(OFFLINE_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

class ConnectionStore {
  private manualOffline = readOfflineChoice();
  private physicalOnline = deviceOnline();
  private unreachable = false;
  private abortController = new AbortController();
  private listeners = new Set<() => void>();
  private snapshot = this.makeSnapshot();

  get status(): ConnectionStatus {
    return this.snapshot;
  }

  /** Unreachable origins still get automatic probes; explicit/device offline does not. */
  canAttemptNetwork = (): boolean => !this.manualOffline && this.physicalOnline && deviceOnline();

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.listeners.size === 0 && typeof window !== 'undefined') {
      this.manualOffline = readOfflineChoice();
      this.physicalOnline = deviceOnline();
      this.publish();
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      window.addEventListener('storage', this.onStorage);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && typeof window !== 'undefined') {
        window.removeEventListener('online', this.onOnline);
        window.removeEventListener('offline', this.onOffline);
        window.removeEventListener('storage', this.onStorage);
      }
    };
  };

  setManualOffline(offline: boolean): void {
    // Persistence failure leaves the previous mode intact and is surfaced by the control.
    if (offline) localStorage.setItem(OFFLINE_MODE_KEY, 'true');
    else localStorage.removeItem(OFFLINE_MODE_KEY);
    this.manualOffline = offline;
    this.unreachable = false;
    this.publish();
  }

  markUnavailable(): void {
    this.unreachable = true;
    this.publish();
  }

  markReachable(): void {
    this.unreachable = false;
    this.publish();
  }

  /** Logout clears the choice so the next sign-in can download its own data. */
  reset(): void {
    try {
      localStorage.removeItem(OFFLINE_MODE_KEY);
    } catch {
      // An unavailable preference store must never block logout's data purge.
    }
    this.manualOffline = false;
    this.physicalOnline = deviceOnline();
    this.unreachable = false;
    this.publish();
  }

  private onOnline = (): void => {
    this.physicalOnline = true;
    this.unreachable = false;
    this.publish();
  };

  private onOffline = (): void => {
    this.physicalOnline = false;
    this.publish();
  };

  private onStorage = (event: StorageEvent): void => {
    if (event.key !== OFFLINE_MODE_KEY && event.key !== null) return;
    this.manualOffline = readOfflineChoice();
    this.unreachable = false;
    this.publish();
  };

  private makeSnapshot(): ConnectionStatus {
    return {
      manualOffline: this.manualOffline,
      deviceOnline: this.physicalOnline,
      online: !this.manualOffline && this.physicalOnline && !this.unreachable,
    };
  }

  private publish(): void {
    if (this.manualOffline || !this.physicalOnline) this.abortController.abort();
    else if (this.abortController.signal.aborted) this.abortController = new AbortController();
    const next = this.makeSnapshot();
    if (
      next.manualOffline === this.snapshot.manualOffline &&
      next.deviceOnline === this.snapshot.deviceOnline &&
      next.online === this.snapshot.online
    )
      return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONNECTION_CHANGE_EVENT));
  }
}

export const connectionStore = new ConnectionStore();
