import { useEffect, useRef } from 'react';
import { type FlashDataProps, useFlashState } from './useFlashState.ts';

/** Keep a visible summary animated when a retained, hidden field rolls back. */
export function useFlashGroup(fields: readonly FlashDataProps[]): FlashDataProps {
  const previous = useRef<readonly (string | null)[]>([]);
  const { flashProps, trigger } = useFlashState(undefined);
  const signals = JSON.stringify(
    fields.map((field) => (field['data-flashing'] === 'true' ? field['data-flash-parity'] : null)),
  );
  useEffect(() => {
    const current = JSON.parse(signals) as (string | null)[];
    if (current.some((signal, index) => signal !== null && signal !== previous.current[index])) {
      trigger();
    }
    previous.current = current;
  }, [signals, trigger]);
  return flashProps;
}
