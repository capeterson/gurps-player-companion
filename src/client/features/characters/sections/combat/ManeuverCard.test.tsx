/**
 * ManeuverCard — tapping a preset chip writes the canonical maneuver
 * label; tapping the already-active chip clears it back to null.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { ToastProvider } from '../../../../lib/toast.tsx';
import { ManeuverCard } from './ManeuverCard.tsx';

function Wrap({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function makeCharacter(maneuver: string | null): CharacterDetail {
  return {
    id: 'char-1',
    combat: { maneuver },
  } as unknown as CharacterDetail;
}

describe('ManeuverCard', () => {
  it('tapping a maneuver chip enqueues the canonical label', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrap>
        <ManeuverCard character={makeCharacter(null)} canWrite={true} patchCombat={patchCombat} />
      </Wrap>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Attack' }));
    expect(patchCombat).toHaveBeenCalledWith('maneuver', 'Attack');
  });

  it('tapping the active chip clears the maneuver to null', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrap>
        <ManeuverCard
          character={makeCharacter('Attack')}
          canWrite={true}
          patchCombat={patchCombat}
        />
      </Wrap>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Attack' }));
    expect(patchCombat).toHaveBeenCalledWith('maneuver', null);
  });

  it('shows the active maneuver blurb', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrap>
        <ManeuverCard
          character={makeCharacter('All-Out Attack')}
          canWrite={true}
          patchCombat={patchCombat}
        />
      </Wrap>,
    );

    expect(screen.getByText(/NO defenses; move half forward only/)).toBeInTheDocument();
  });

  it('with no stored maneuver, the custom input shows an empty string, not the literal "null"', () => {
    const patchCombat = vi.fn().mockResolvedValue(undefined);
    render(
      <Wrap>
        <ManeuverCard character={makeCharacter(null)} canWrite={true} patchCombat={patchCombat} />
      </Wrap>,
    );

    // Switch to the custom input (the draft-on-blur field under test).
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }));
    const input = screen.getByRole('textbox', { name: 'custom maneuver' }) as HTMLInputElement;
    expect(input.value).toBe('');

    // Blurring without typing anything must not persist the literal
    // string "null" — nullableTextParser treats an empty draft as null,
    // which is a no-op against the already-null server value.
    fireEvent.blur(input);
    expect(patchCombat).not.toHaveBeenCalled();
  });
});
