import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RaceForm } from './RaceForm.tsx';
vi.mock('../../components/markdown/RichTextEditor.tsx', () => ({
  RichTextEditor: ({
    value,
    onChange,
    ...props
  }: { value: string; onChange: (s: string) => void; 'aria-label': string }) => (
    <textarea
      aria-label={props['aria-label']}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
vi.mock('./EffectsEditor.tsx', () => ({ EffectsEditor: () => null }));
describe('Race library authoring', () => {
  it('creates a structured race through labeled fields', () => {
    const submit = vi.fn();
    render(<RaceForm isPending={false} onSubmit={submit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Stonekin' } });
    fireEvent.click(screen.getByText('Racial profile and options', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('Points'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('ST setting'), { target: { value: 'value' } });
    fireEvent.change(screen.getByLabelText('ST'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add features' }));
    fireEvent.change(screen.getByLabelText('Features 1'), { target: { value: 'Stone skin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add features' }));
    fireEvent.change(screen.getByLabelText('Features 2'), { target: { value: 'Long lived' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add race' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Stonekin',
        points: 25,
        attributeModifiers: expect.objectContaining({ st: 2 }),
        features: ['Stone skin', 'Long lived'],
      }),
    );
  });
  it('keeps invalid drafts available for correction', () => {
    const submit = vi.fn();
    render(<RaceForm isPending={false} onSubmit={submit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Racial profile and options', { selector: 'summary' }));
    fireEvent.change(screen.getByLabelText('ST setting'), { target: { value: 'value' } });
    fireEvent.change(screen.getByLabelText('ST'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add race' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('ST')).toHaveValue('1.5');
    expect(screen.getByRole('button', { name: 'Add race' })).toBeEnabled();
    expect(screen.getByRole('alert')).toBeVisible();
  });
  it('exposes lens compatibility and explicit replacement keys', () => {
    const submit = vi.fn();
    render(<RaceForm isPending={false} onSubmit={submit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Raw YAML'), {
      target: {
        value:
          'name: Stonekin lens\nkind: lens\ncompatibleRaceKeys: [human, stonekin]\nremovesTraits: [night-vision]',
      },
    });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Stonekin Lens' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add race' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'lens',
        name: 'Stonekin Lens',
        compatibleRaceKeys: ['human', 'stonekin'],
        removesTraits: ['night-vision'],
      }),
    );
  });
});
