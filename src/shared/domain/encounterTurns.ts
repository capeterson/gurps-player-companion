export interface EncounterTurnState {
  round: number;
  activeCombatantId: string | null;
}
export interface TurnCombatant {
  id: string;
  orderKey: number;
  active: boolean;
}
function active(rows: readonly TurnCombatant[]) {
  return rows.filter((row) => row.active).sort((a, b) => a.orderKey - b.orderKey);
}
export function advanceTurn(
  state: EncounterTurnState,
  rows: readonly TurnCombatant[],
): EncounterTurnState {
  const ordered = active(rows);
  const first = ordered[0];
  if (!first) return { ...state, activeCombatantId: null };
  const i = ordered.findIndex((row) => row.id === state.activeCombatantId);
  if (i < 0) return { ...state, activeCombatantId: first.id };
  const next = ordered[(i + 1) % ordered.length];
  return next
    ? {
        round: i + 1 === ordered.length ? state.round + 1 : state.round,
        activeCombatantId: next.id,
      }
    : state;
}
export function previousTurn(
  state: EncounterTurnState,
  rows: readonly TurnCombatant[],
): EncounterTurnState {
  const ordered = active(rows);
  const first = ordered[0];
  if (!first) return { ...state, activeCombatantId: null };
  const i = ordered.findIndex((row) => row.id === state.activeCombatantId);
  if (i < 0) return { ...state, activeCombatantId: first.id };
  const previous = ordered[(i - 1 + ordered.length) % ordered.length];
  return previous
    ? {
        round: i === 0 ? Math.max(1, state.round - 1) : state.round,
        activeCombatantId: previous.id,
      }
    : state;
}
