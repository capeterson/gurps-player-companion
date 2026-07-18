/**
 * Per-character roll log, persisted to localStorage (not sync'd).
 *
 * Each character gets its own localStorage key holding its last 100
 * rolls (newest first, oldest pruned from the tail). The log is
 * browser-local convenience state — it carries no sync, purge, or
 * history obligations (AGENTS.md S6/S9/H1-H5) because it is not a
 * Dexie store and never touches the server. `clearAllRollHistory`
 * is called on logout so account switching on the same device does
 * not leak one user's roll labels to the next.
 *
 * Exposed via `useSyncExternalStore` so every `RollHistoryStrip`
 * instance re-renders the moment a roll lands, without React state
 * living outside a component.
 */

import { useSyncExternalStore } from 'react';
import type { CritKind } from '../../../../shared/domain/diceRoll.ts';

export interface RollHistoryEntry {
  readonly id: string;
  readonly at: Date;
  readonly characterId: string;
  readonly label: string;
  /** Absent on entries stored before damage rolls existed => 'check'. */
  readonly kind?: 'check' | 'damage';
  /** Effective target the roll was made against (base + modifier). Check rolls only. */
  readonly target?: number;
  readonly dice: readonly number[];
  readonly total: number;
  /** Check rolls only. */
  readonly margin?: number;
  readonly crit?: CritKind;
  /** Damage rolls only: type suffix for display (e.g. "cut"). */
  readonly damageType?: string | null;
}

const MAX_ENTRIES = 100;
const KEY_PREFIX = 'gurps:rollHistory:';

interface StoredEntry {
  readonly id: string;
  readonly at: string;
  readonly characterId: string;
  readonly label: string;
  /** Missing on entries persisted before damage rolls existed. */
  readonly kind?: 'check' | 'damage';
  readonly target?: number;
  readonly dice: readonly number[];
  readonly total: number;
  readonly margin?: number;
  readonly crit?: CritKind;
  readonly damageType?: string | null;
}

function storageKey(characterId: string): string {
  return `${KEY_PREFIX}${characterId}`;
}

function serialize(entries: readonly RollHistoryEntry[]): string {
  const stored: StoredEntry[] = entries.map((e) => ({ ...e, at: e.at.toISOString() }));
  return JSON.stringify(stored);
}

function deserialize(json: string): RollHistoryEntry[] {
  try {
    const parsed = JSON.parse(json) as StoredEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s) => ({ ...s, at: new Date(s.at) }));
  } catch {
    return [];
  }
}

const cache = new Map<string, RollHistoryEntry[]>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function readFromStorage(characterId: string): RollHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(storageKey(characterId));
    return raw ? deserialize(raw) : [];
  } catch {
    return [];
  }
}

function writeToStorage(characterId: string, entries: readonly RollHistoryEntry[]): void {
  try {
    window.localStorage.setItem(storageKey(characterId), serialize(entries));
  } catch {}
}

/** Push a new roll onto the front of the log, newest first, capped at 100 per character. */
export function pushRoll(entry: RollHistoryEntry): void {
  const cid = entry.characterId;
  const current = cache.get(cid) ?? readFromStorage(cid);
  const updated = [entry, ...current].slice(0, MAX_ENTRIES);
  cache.set(cid, updated);
  writeToStorage(cid, updated);
  emit();
}

/** Clear every character's roll history from localStorage and the in-memory cache. Called on logout. */
export function clearAllRollHistory(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
  } catch {}
  cache.clear();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(characterId: string): readonly RollHistoryEntry[] {
  if (!cache.has(characterId)) {
    cache.set(characterId, readFromStorage(characterId));
  }
  return cache.get(characterId) ?? [];
}

const EMPTY_ENTRIES: readonly RollHistoryEntry[] = [];

/** This character's rolls, newest first, persisted to localStorage. */
export function useRollHistory(characterId: string): readonly RollHistoryEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(characterId),
    () => EMPTY_ENTRIES,
  );
}

/** Test-only reset so suites don't leak state across files. */
export function __resetRollHistoryForTests(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(KEY_PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) window.localStorage.removeItem(key);
  } catch {}
  cache.clear();
  emit();
}
