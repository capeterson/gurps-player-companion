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
    fireEvent.change(screen.getByLabelText('Race or lens name'), { target: { value: 'Stonekin' } });
    fireEvent.change(screen.getByLabelText('Package points'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('ST'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Features (one per line)'), {
      target: { value: 'Stone skin\nLong lived' },
    });
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
    fireEvent.change(screen.getByLabelText('ST'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add race' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('ST')).toHaveValue(1.5);
    expect(screen.getByRole('button', { name: 'Add race' })).toBeEnabled();
  });
  it('exposes lens compatibility and explicit replacement keys', () => {
    const submit = vi.fn();
    render(<RaceForm isPending={false} onSubmit={submit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('Definition type'), { target: { value: 'lens' } });
    fireEvent.change(screen.getByLabelText('Compatible race keys (one per line)'), {
      target: { value: 'human\nstonekin' },
    });
    fireEvent.change(screen.getByLabelText('Replaced trait keys (one per line)'), {
      target: { value: 'night-vision' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add race' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'lens',
        compatibleRaceKeys: ['human', 'stonekin'],
        removesTraits: ['night-vision'],
      }),
    );
  });
});
