import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArmorFacetEditor } from './ArmorFacetEditor.tsx';
import { ItemForm } from './ItemForm.tsx';

function renderForm() {
  const onSubmit = vi.fn();
  render(<ItemForm definitions={[]} isPending={false} onCancel={vi.fn()} onSubmit={onSubmit} />);
  return { onSubmit };
}

describe('ItemForm advanced facets', () => {
  it('keeps optional facets closed for an ordinary item', () => {
    renderForm();

    for (const title of [
      'Weapon and shield facets',
      'Armor facets',
      'Enchantments',
      'Powerstone and magic-item facets (YAML)',
    ]) {
      expect(
        screen.getByText(title, { selector: 'summary' }).closest('details'),
      ).not.toHaveAttribute('open');
    }
    expect(screen.queryByLabelText('Armor data (YAML)')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Weapon or shield')).not.toBeVisible();
  });

  it('opens invalid YAML, guides common armor fields, and preserves advanced data on save', async () => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Layered cuirass' } });

    const armorSection = screen
      .getByText('Armor facets', { selector: 'summary' })
      .closest('details');
    expect(armorSection).not.toBeNull();
    fireEvent.click(screen.getByText('Armor facets', { selector: 'summary' }));
    fireEvent.click(screen.getByLabelText('Armor item'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit armor YAML' }));
    fireEvent.change(screen.getByLabelText('Armor data (YAML)'), {
      target: { value: 'dr: nope\nlocations: [torso]' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Armor YAML');
    await waitFor(() => expect(armorSection).toHaveAttribute('open'));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Armor data (YAML)'), {
      target: {
        value:
          'dr: 2\nlocations: [torso]\ntypedDr:\n  cut: 4\nfrontOnly: true\ndrCrushing: 5\ndb: 2',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Visual armor fields' }));
    fireEvent.change(screen.getByLabelText('Damage resistance (DR)'), {
      target: { value: '1001' },
    });
    expect(screen.getByLabelText('Damage resistance (DR)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('DR must be between 0 and 1000.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Damage resistance (DR)'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Weapon and shield facets', { selector: 'summary' }));
    fireEvent.click(screen.getByLabelText('Weapon or shield'));
    fireEvent.change(screen.getByLabelText('damage'), { target: { value: 'sw+1 cut' } });
    fireEvent.change(screen.getByLabelText('Stable mode key'), { target: { value: 'cut' } });
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
          modes: [expect.objectContaining({ key: 'cut', damage: 'sw+1 cut' })],
        }),
      }),
    );
  });
});

describe('ArmorFacetEditor repair and common fields', () => {
  it('keeps malformed starting YAML editable instead of crashing', () => {
    const onChange = vi.fn();
    const view = render(
      <ArmorFacetEditor text={"dr: 'nope'\nlocations: [torso]"} onChange={onChange} />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const yaml = screen.getByLabelText('Armor data (YAML)');
    fireEvent.change(yaml, { target: { value: 'dr: 4\nlocations: [torso]' } });
    view.rerender(<ArmorFacetEditor text={'dr: 4\nlocations: [torso]'} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Visual armor fields' }));

    expect(screen.getByLabelText('Damage resistance (DR)')).toHaveValue(4);
    expect(onChange).toHaveBeenLastCalledWith('dr: 4\nlocations: [torso]');
  });

  it('offers common GURPS armor overrides and facing fields', () => {
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
  });
});

it('keeps custom coverage visible and repairable while making facing flags exclusive', () => {
  const onChange = vi.fn();
  render(<ArmorFacetEditor text={'dr: 3\nlocations: [torso]'} onChange={onChange} />);

  fireEvent.change(screen.getByLabelText('Custom armor location'), {
    target: { value: 'Left vambrace rim' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add location' }));
  expect(screen.getByRole('button', { name: 'Remove location Left vambrace rim' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Remove location Left vambrace rim' }));
  expect(
    screen.queryByRole('button', { name: 'Remove location Left vambrace rim' }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Front only'));
  fireEvent.click(screen.getByLabelText('Back only'));
  expect(screen.getByLabelText('Front only')).not.toBeChecked();
  expect(screen.getByLabelText('Back only')).toBeChecked();
  expect(screen.queryByText('Choose Front only or Back only, not both.')).not.toBeInTheDocument();
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

it('disables the entire item draft while an atomic save is pending', () => {
  render(<ItemForm definitions={[]} isPending onCancel={vi.fn()} onSubmit={vi.fn()} />);

  expect(screen.getByLabelText('Name *')).toBeDisabled();
  expect(screen.getByText('Saving…').closest('button')).toBeDisabled();
});

it('blocks invalid imported facing YAML and saves after repair', () => {
  const onSubmit = vi.fn();
  render(<ItemForm definitions={[]} isPending={false} onCancel={vi.fn()} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Facing test armor' } });
  fireEvent.click(screen.getByText('Armor facets', { selector: 'summary' }));
  fireEvent.click(screen.getByLabelText('Armor item'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit armor YAML' }));
  fireEvent.change(screen.getByLabelText('Armor data (YAML)'), {
    target: { value: 'dr: 2\nlocations: [torso]\nfrontOnly: true\nbackOnly: true' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));

  expect(screen.getByRole('alert')).toHaveTextContent('cannot be both front only and back only');
  expect(onSubmit).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Armor data (YAML)'), {
    target: { value: 'dr: 2\nlocations: [torso]\nfrontOnly: true' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      isArmor: true,
      armor: expect.objectContaining({ frontOnly: true, backOnly: false }),
    }),
  );
});
