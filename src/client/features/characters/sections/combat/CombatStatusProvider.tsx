import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { useAppHeaderBottom } from '../../../../hooks/useAppHeaderBottom.ts';
import { useStatusBarPreferences } from '../../../../lib/statusBarPreferences.ts';
import { RollSheet } from '../RollSheet.tsx';
import type { RollRequest } from '../rollTypes.ts';
import { useCombatPatch } from '../useCombatPatch.ts';
import { usePoolBumpers } from '../usePoolBumpers.ts';
import type { PoolBumpers } from '../usePoolBumpers.ts';
import { CurrentStatusBar } from './CurrentStatusBar.tsx';

interface CombatStatusContextValue {
  bumpers: PoolBumpers;
  patchCombat: ReturnType<typeof useCombatPatch>;
  openRoll: (request: RollRequest) => void;
}

const CombatStatusContext = createContext<CombatStatusContextValue | null>(null);

export function useCombatStatus(): CombatStatusContextValue {
  const value = useContext(CombatStatusContext);
  if (!value) throw new Error('useCombatStatus must be used inside CombatStatusProvider');
  return value;
}

export function CombatStatusProvider({
  character,
  canWrite,
  userId,
  children,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  userId: string | undefined;
  children: ReactNode;
}) {
  const patchCombat = useCombatPatch(character);
  const bumpers = usePoolBumpers(character, canWrite, patchCombat);
  const [rollRequest, setRollRequest] = useState<RollRequest | null>(null);
  const statusBarPreferences = useStatusBarPreferences(userId);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const headerBottom = useAppHeaderBottom();
  const [statusHeight, setStatusHeight] = useState(() =>
    window.matchMedia('(min-width: 768px)').matches ? 56 : 120,
  );

  useLayoutEffect(() => {
    setHeaderSlot(document.getElementById('character-status-header-slot'));
  }, []);

  const value = useMemo<CombatStatusContextValue>(
    () => ({ bumpers, patchCombat, openRoll: setRollRequest }),
    [bumpers, patchCombat],
  );
  const offsetStyle = {
    paddingTop: headerSlot ? 0 : statusHeight,
    '--sheet-sticky-offset': `${headerBottom + (headerSlot ? 0 : statusHeight) + 16}px`,
  } as CSSProperties;

  const statusBar = (
    <CurrentStatusBar
      character={character}
      bumpers={bumpers}
      canWrite={canWrite}
      patchCombat={patchCombat}
      openRoll={setRollRequest}
      top={headerBottom}
      onHeightChange={setStatusHeight}
      preferences={statusBarPreferences}
      embedded={Boolean(headerSlot)}
    />
  );

  return (
    <CombatStatusContext.Provider value={value}>
      {headerSlot ? createPortal(statusBar, headerSlot) : statusBar}
      <div style={offsetStyle}>{children}</div>
      {rollRequest && (
        <RollSheet
          request={rollRequest}
          characterId={character.id}
          onClose={() => setRollRequest(null)}
        />
      )}
    </CombatStatusContext.Provider>
  );
}
