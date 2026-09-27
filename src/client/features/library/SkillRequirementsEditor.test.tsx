import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SkillRequirementsEditor } from './SkillRequirementsEditor.tsx';

function Harness() {
  const [prerequisites, setPrerequisites] = useState(
    JSON.stringify({
      kind: 'all',
      children: [
        { kind: 'attribute', attribute: 'IQ', minimum: 11 },
        { kind: 'skill', name: 'Sword', minimumPoints: 4 },
      ],
    }),
  );
  const [defaults, setDefaults] = useState(
    JSON.stringify([{ kind: 'skill', name: 'Shield', modifier: -4 }]),
  );
  return (
    <>
      <SkillRequirementsEditor
        prerequisites={prerequisites}
        defaults={defaults}
        onPrerequisitesChange={setPrerequisites}
        onDefaultsChange={setDefaults}
      />
      <output aria-label="Prerequisites value">{prerequisites}</output>
      <output aria-label="Defaults value">{defaults}</output>
    </>
  );
}

describe('SkillRequirementsEditor guided rules', () => {
  it('wraps advanced prerequisite JSON with the selected AND/OR rule', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Combine with existing'), { target: { value: 'any' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add prerequisite' }));

    const value = JSON.parse(screen.getByLabelText('Prerequisites value').textContent ?? 'null');
    expect(value.kind).toBe('any');
    expect(value.children[0]).toEqual({
      kind: 'all',
      children: [
        { kind: 'attribute', attribute: 'IQ', minimum: 11 },
        { kind: 'skill', name: 'Sword', minimumPoints: 4 },
      ],
    });
    expect(value.children[1]).toEqual({ kind: 'attribute', attribute: 'IQ', minimum: 10 });
  });

  it('adds a guided default without dropping existing defaults', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add default' }));

    expect(JSON.parse(screen.getByLabelText('Defaults value').textContent ?? 'null')).toEqual([
      { kind: 'skill', name: 'Shield', modifier: -4 },
      { kind: 'attribute', attribute: 'IQ', modifier: -5 },
    ]);
  });
});
