import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  EnchantmentMechanicsForm,
  type MechanicsDraft,
  mechanicsDraft,
  parseMechanicsDraft,
} from './EnchantmentMechanicsForm.tsx';
import { ENCHANTMENT_EFFECT_LABELS } from './enchantmentText.ts';

let latest: MechanicsDraft;

function Harness() {
  const [draft, setDraft] = useState<MechanicsDraft>(() =>
    mechanicsDraft({
      applicability: 'weapon',
      effects: [{ target: 'dr', value: 1 }],
      levels: [],
      stackingPolicy: { kind: 'stack' },
    }),
  );
  latest = draft;
  return (
    <EnchantmentMechanicsForm
      spellName="Flaming Weapon"
      draft={draft}
      errors={{}}
      pending={false}
      onChange={setDraft}
      onSave={() => {}}
      onCancel={() => {}}
      skillNames={[]}
    />
  );
}

function targetSelect() {
  return screen.getByRole('combobox', { name: /effect 1$/ });
}

describe('EnchantmentMechanicsForm damage type', () => {
  it('shows a damage type input only for Weapon damage and parses the entered type', () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/damage type/i)).not.toBeInTheDocument();

    fireEvent.change(targetSelect(), { target: { value: 'weapon_damage' } });
    expect(ENCHANTMENT_EFFECT_LABELS.weapon_damage).toBeTruthy();
    const input = screen.getByLabelText(/damage type/i);
    expect(input).toBeVisible();
    fireEvent.change(input, { target: { value: ' fire ' } });

    const parsed = parseMechanicsDraft(latest);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.mechanics.effects[0]).toMatchObject({ damageType: 'fire' });

    for (const target of Object.keys(ENCHANTMENT_EFFECT_LABELS).filter(
      (t) => t !== 'weapon_damage' && t !== 'skill',
    )) {
      fireEvent.change(targetSelect(), { target: { value: target } });
      expect(screen.queryByLabelText(/damage type/i)).not.toBeInTheDocument();
    }
  });

  it('drops a stale damage type when the target changes away from Weapon damage', () => {
    render(<Harness />);
    fireEvent.change(targetSelect(), { target: { value: 'weapon_damage' } });
    fireEvent.change(screen.getByLabelText(/damage type/i), { target: { value: 'fire' } });
    fireEvent.change(targetSelect(), { target: { value: 'dr' } });
    const parsed = parseMechanicsDraft(latest);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.mechanics.effects[0]).not.toHaveProperty('damageType');
  });

  it('omits damageType when the input is left blank', () => {
    render(<Harness />);
    fireEvent.change(targetSelect(), { target: { value: 'weapon_damage' } });
    const parsed = parseMechanicsDraft(latest);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.mechanics.effects[0]).not.toHaveProperty('damageType');
  });
});
