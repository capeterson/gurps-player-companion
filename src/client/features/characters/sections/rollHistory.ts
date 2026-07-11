/**
 * Ephemeral session-only roll log for the Combat tab.
 *
 * Deliberately NOT persisted — no Dexie table, no localStorage. A
 * physical-dice roll has no server-side meaning and carries none of
 * the sync/purge/history obligations AGENTS.md attaches to durable
 * state (S6 "adding an entity class is a multi-site change", S9
 * "logout purges every local store", H1-H5 history checklist). A page
 * reload clearing the log is the intended behaviour, not a bug.
 *
 * Exposed via `useSyncExternalStore` so every `RollHistoryStrip`
 * instance (there's normally just one per Combat tab) re-renders
 * the moment a roll lands, without React state living outside a
 * component.
 */

import { useSyncExternalStore } from 'react';
import type { CritKind } from '../../../../shared/domain/diceRoll.ts';

export interface RollHistoryEntry {
  readonly id: string;
  readonly at: Date;
  readonly characterId: string;
  readonly label: string;
  /** Effective target the roll was made against (base + modifier). */
  readonly target: number;
  readonly dice: readonly [number, number, number];
  readonly total: number;
  readonly margin: number;
  readonly crit: CritKind;
}

const MAX_ENTRIES = 20;

let entries: readonly RollHistoryEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Push a new roll onto the front of the session log, newest first, capped at 20. */
export function pushRoll(entry: RollHistoryEntry): void {
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly RollHistoryEntry[] {
  return entries;
}

/** All rolls this session, across every character, newest first. */
export function useRollHistory(): readonly RollHistoryEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Test-only reset so suites don't leak state across files. */
export function __resetRollHistoryForTests(): void {
  entries = [];
  emit();
}
