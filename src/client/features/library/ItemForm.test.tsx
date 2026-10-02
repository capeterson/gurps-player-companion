import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ArmorFacetEditor } from './ArmorFacetEditor.tsx';
import { ItemForm } from './ItemForm.tsx';

function renderForm(isPending = false) {
  const onSubmit = vi.fn();
  render(
    <ItemForm definitions={[]} isPending={isPending} onCancel={vi.fn()} onSubmit={onSubmit} />,
  );
  return { onSubmit };
}

describe('ItemForm advanced facets', () => {
  it('keeps optional equipment facets folded for an ordinary item', () => {
    renderForm();
    const facets = screen.getByText('Equipment facets', { selector: 'summary' }).closest('details');
    expect(facets).not.toHaveAttribute('open');
    expect(screen.queryByLabelText('Damage resistance (DR)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Weapon or shield')).not.toBeVisible();
  });

  it('edits armor and weapon facets visually while retaining imported fields on save', () => {
    const { onSubmit } = renderForm();
    const imported = `name: Layered cuirass
isArmor: true
armor:
  dr: 2
  locations: [torso]
  typedDr: { cut: 4 }
  frontOnly: true
  drCrushing: 5
  db: 2
weaponData:
  modes:
    - key: cut
      name: Cut
      damage: sw+1 cut
`;
    fireEvent.change(screen.getByLabelText('Raw YAML'), { target: { value: imported } });
    fireEvent.click(screen.getByText('Equipment facets', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Damage resistance (DR)'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('damage'), { target: { value: 'sw+2 cut' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Layered cuirass',
        isArmor: true,
        armor: expect.objectContaining({
          dr: 3,
          locations: ['torso'],
          typedDr: { cut: 4 },
          frontOnly: true,
          drCrushing: 5,
          db: 2,
        }),
        weaponData: expect.objectContaining({
          modes: [expect.objectContaining({ key: 'cut', damage: 'sw+2 cut' })],
        }),
      }),
    );
  });

  it('disables the entire item draft while an atomic save is pending', () => {
    renderForm(true);
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByText('Saving…').closest('button')).toBeDisabled();
  });

  it('blocks imported conflicting armor facing flags and submits after raw repair', () => {
    const { onSubmit } = renderForm();
    const raw = screen.getByLabelText('Raw YAML');
    fireEvent.change(raw, {
      target: {
        value:
          'name: Facing test armor\nisArmor: true\narmor: { dr: 2, locations: [torso], frontOnly: true, backOnly: true }',
      },
    });
    fireEvent.click(screen.getByText('Equipment facets', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(raw, {
      target: {
        value:
          'name: Facing test armor\nisArmor: true\narmor: { dr: 2, locations: [torso], frontOnly: true, backOnly: false }',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        isArmor: true,
        armor: expect.objectContaining({ frontOnly: true, backOnly: false }),
      }),
    );
  });
});

describe('ArmorFacetEditor typed facets', () => {
  it('switches between visual armor fields and complete typed fields without losing edits', () => {
    function Harness() {
      const [text, setText] = useState('dr: 4\nlocations: [torso]');
      return <ArmorFacetEditor text={text} onChange={setText} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'All armor fields' }));
    fireEvent.change(screen.getByLabelText('Dr'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Visual armor fields' }));
    expect(screen.getByLabelText('Damage resistance (DR)')).toHaveValue(6);
  });

  it('offers armor overrides, custom coverage, and exclusive facing controls', () => {
    render(
      <ArmorFacetEditor
        text={
          'dr: 2\nlocations: [torso]\ntypedDr:\n  cut: 4\ndrCrushing: 3\ndb: 1\nfrontOnly: true'
        }
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Crushing DR override')).toHaveValue(3);
    expect(screen.getByLabelText('Defense Bonus')).toHaveValue(1);
    expect(screen.getByLabelText('Front only')).toBeChecked();
    expect(screen.getByText('Damage-type DR overrides')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Custom armor location'), {
      target: { value: 'Left vambrace rim' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
    expect(screen.getByRole('button', { name: 'Remove location Left vambrace rim' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove location Left vambrace rim' }));
    fireEvent.click(screen.getByLabelText('Back only'));
    expect(screen.getByLabelText('Front only')).not.toBeChecked();
    expect(screen.getByLabelText('Back only')).toBeChecked();
  });

  it('announces and repairs imported conflicting armor facing flags', () => {
    render(
      <ArmorFacetEditor
        text={'dr: 3\nlocations: [torso]\nfrontOnly: true\nbackOnly: true'}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Choose Front only or Back only');
    fireEvent.click(screen.getByLabelText('Front only'));
    expect(screen.getByLabelText('Front only')).not.toBeChecked();
    expect(screen.getByLabelText('Back only')).toBeChecked();
    expect(screen.queryByText('Choose Front only or Back only, not both.')).not.toBeInTheDocument();
  });

  it('uses distinct descriptions for base DR errors in simultaneous drafts', () => {
    render(
      <>
        <ArmorFacetEditor text="dr: 0" onChange={vi.fn()} />
        <ArmorFacetEditor text="dr: 0" onChange={vi.fn()} />
      </>,
    );
    for (const field of screen.getAllByLabelText('Damage resistance (DR)')) {
      fireEvent.change(field, { target: { value: '-1' } });
    }
    const fields = screen.getAllByLabelText('Damage resistance (DR)');
    expect(fields[0]).toHaveAttribute('aria-describedby');
    expect(fields[1]).toHaveAttribute('aria-describedby');
    expect(fields[0]?.getAttribute('aria-describedby')).not.toBe(
      fields[1]?.getAttribute('aria-describedby'),
    );
  });
});
