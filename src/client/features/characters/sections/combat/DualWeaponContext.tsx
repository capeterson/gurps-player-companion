import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  type DualWeaponState,
  INITIAL_DUAL_WEAPON_STATE,
  chooseOffHand,
  toggleDualWeapon,
  togglePick,
} from '../../../../../shared/domain/dualWeaponAttack.ts';

interface DualWeaponContextValue {
  state: DualWeaponState;
  toggle: () => void;
  pick: (key: string) => void;
  setOffHand: (key: string) => void;
}

const INACTIVE: DualWeaponContextValue = {
  state: INITIAL_DUAL_WEAPON_STATE,
  toggle: () => {},
  pick: () => {},
  setOffHand: () => {},
};

const DualWeaponContext = createContext<DualWeaponContextValue>(INACTIVE);

export function useDualWeapon(): DualWeaponContextValue {
  return useContext(DualWeaponContext);
}

/**
 * Turn-local Dual-Weapon Attack choice shared by the Attacks and Defenses
 * cards. Like the All-Out Defense option it is not persisted, and a new
 * character or maneuver ends it.
 */
export function DualWeaponProvider({
  characterId,
  maneuver,
  children,
}: {
  characterId: string;
  maneuver: string | null | undefined;
  children: ReactNode;
}) {
  const [state, setState] = useState(INITIAL_DUAL_WEAPON_STATE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing character or maneuver ends this local turn choice.
  useEffect(() => {
    setState(INITIAL_DUAL_WEAPON_STATE);
  }, [characterId, maneuver]);
  const value = useMemo<DualWeaponContextValue>(
    () => ({
      state,
      toggle: () => setState(toggleDualWeapon),
      pick: (key) => setState((current) => togglePick(current, key)),
      setOffHand: (key) => setState((current) => chooseOffHand(current, key)),
    }),
    [state],
  );
  return <DualWeaponContext.Provider value={value}>{children}</DualWeaponContext.Provider>;
}
