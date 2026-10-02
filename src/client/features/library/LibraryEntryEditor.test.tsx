import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { LibraryEntryEditor, entrySaveBody } from './LibraryEntryEditor.tsx';

const technicalFields = {
  id: '0193b3c0-f1f0-7000-8000-000000000001',
  campaignId: '0193b3c0-f1f0-7000-8000-000000000002',
  revision: 17,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const legacyModifier = {
  name: 'Darkness',
  modifier: -2,
  description: 'No light is available.',
};
const legacyMirror = {
  id: 'legacy-1',
  label: 'Darkness',
  when: [
    {
      input: { domain: 'task', key: 'legacy-1', label: 'Darkness' },
      operator: 'equals',
      value: true,
    },
  ],
  value: { kind: 'fixed', value: -2 },
  appliesTo: 'task_roll',
  stacking: 'stack',
  sourceText: 'No light is available.',
};
const customLegacyRule = {
  id: 'legacy-authored',
  label: 'House rule',
  when: [],
  value: { kind: 'fixed', value: -7 },
  appliesTo: 'task_roll',
  stacking: 'stack',
};

function skillInitial(overrides: Record<string, unknown> = {}) {
  return {
    ...technicalFields,
    name: 'Bow',
    attribute: 'DX',
    difficulty: 'A',
    ...overrides,
  };
}

function readRawDraft() {
  return parse((screen.getByLabelText('Raw YAML') as HTMLTextAreaElement).value) as Record<
    string,
    unknown
  >;
}

async function openAdvancedSection(title: string) {
  const summary = screen.getByText(title, { selector: 'summary' });
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  if (!(details as HTMLDetailsElement).open) fireEvent.click(summary);
  await waitFor(() => expect(details).toHaveProperty('open', true));
}

describe('LibraryEntryEditor shared draft', () => {
  it('sends explicit clears and defaults when optional skill settings are removed', () => {
    const body = entrySaveBody(
      'skills',
      {
        name: 'Swordsmanship',
        attribute: 'DX',
        difficulty: 'A',
        techLevel: null,
        defaultSpecialization: null,
        groups: [],
        tags: [],
      },
      {
        name: 'Swordsmanship',
        attribute: 'DX',
        difficulty: 'A',
        techLevel: null,
        techLevelPolicy: { kind: 'fixed', techLevel: 3 },
        specializationPolicy: { kind: 'fixed', specialization: 'Broadsword' },
        defaultSpecialization: 'Broadsword',
        defaults: [{ name: 'DX', modifier: -4 }],
        prerequisiteRules: { all: [] },
        procedures: { modifiers: [], actions: [{ id: 'a' }], benefits: [] },
        status: 'needs_review',
        role: 'reference',
        preferredEdition: true,
        restricted: true,
      },
    );
    expect(body).toMatchObject({
      defaults: null,
      prerequisiteRules: null,
      techLevelPolicy: { kind: 'not_applicable' },
      specializationPolicy: { kind: 'none' },
      procedures: { modifiers: [], actions: [], benefits: [] },
      status: 'complete',
      role: 'definition',
      preferredEdition: false,
      restricted: false,
    });
  });

  it('keeps metadata, tags, and suggestedFrom through visual and raw YAML edits', () => {
    const onSubmit = vi.fn();
    render(
      <LibraryEntryEditor
        section="skills"
        initial={{
          ...technicalFields,
          name: 'Bow',
          attribute: 'DX',
          difficulty: 'A',
          tags: ['combat', 'ranged weapons'],
          techLevelPolicy: { kind: 'required', suggestedFrom: 'character' },
        }}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const details = screen.getByText('Groups and tags', { selector: 'summary' });
    fireEvent.click(details);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Longbow' } });
    const raw = screen.getByLabelText('Raw YAML');
    const firstDraft = parse((raw as HTMLTextAreaElement).value) as Record<string, unknown>;
    expect(firstDraft).toMatchObject({
      name: 'Longbow',
      tags: ['combat', 'ranged weapons'],
      techLevelPolicy: { kind: 'required', suggestedFrom: 'character' },
    });
    for (const transportField of ['id', 'campaignId', 'revision', 'createdAt', 'updatedAt']) {
      expect(firstDraft).not.toHaveProperty(transportField);
    }

    const editedRaw = JSON.stringify({
      ...firstDraft,
      name: 'Composite bow',
      tags: ['combat', 'ranged weapons', 'two-handed'],
    });
    fireEvent.change(raw, { target: { value: editedRaw } });
    expect(screen.getByLabelText('Name')).toHaveValue('Composite bow');
    const policy = screen.getByText('TL policy', { selector: 'legend' }).closest('fieldset');
    expect(policy).not.toBeNull();
    expect(within(policy as HTMLElement).getByLabelText('Suggest learned TL from')).toHaveValue(
      'character',
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Composite longbow' } });
    const finalDraft = parse((raw as HTMLTextAreaElement).value) as Record<string, unknown>;
    expect(finalDraft).toMatchObject({
      name: 'Composite longbow',
      tags: ['combat', 'ranged weapons', 'two-handed'],
      techLevelPolicy: { kind: 'required', suggestedFrom: 'character' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Composite longbow',
        tags: ['combat', 'ranged weapons', 'two-handed'],
        techLevelPolicy: { kind: 'required', suggestedFrom: 'character' },
      }),
    );
  });

  it('retains invalid raw YAML in the draft and blocks saving until it is repaired', () => {
    const onSubmit = vi.fn();
    render(
      <LibraryEntryEditor
        section="skills"
        initial={{ name: 'Bow', attribute: 'DX', difficulty: 'A' }}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const raw = screen.getByLabelText('Raw YAML');
    const invalid = 'name: [unfinished\nattribute: DX\ndifficulty: A';
    fireEvent.change(raw, { target: { value: invalid } });
    expect(raw).toHaveValue(invalid);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();

    const repaired = 'name: Repaired bow\nattribute: DX\ndifficulty: A';
    fireEvent.change(raw, { target: { value: repaired } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Repaired bow', attribute: 'DX', difficulty: 'A' }),
    );
  });

  it('shows a flat situational modifier once when its exact generated procedure mirror exists', async () => {
    const { container } = render(
      <LibraryEntryEditor
        section="skills"
        initial={skillInitial({
          situationalModifiers: [legacyModifier],
          procedures: { modifiers: [legacyMirror], actions: [], benefits: [] },
        })}
        isPending={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await openAdvancedSection('Contextual rules and actions');
    expect(
      container.querySelector('[data-field-path="situationalModifiers.0.name"]'),
    ).toBeVisible();
    expect(
      container.querySelector('[data-field-path="procedures.modifiers.0.id"]'),
    ).not.toBeInTheDocument();
  });

  it('refreshes exact flat mirrors while retaining and showing authored legacy-prefix rules', async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <LibraryEntryEditor
        section="skills"
        initial={skillInitial({
          situationalModifiers: [legacyModifier],
          procedures: {
            modifiers: [legacyMirror, customLegacyRule],
            actions: [],
            benefits: [],
          },
        })}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await openAdvancedSection('Contextual rules and actions');
    const authoredRule = container.querySelector('[data-field-path="procedures.modifiers.0.id"]');
    expect(authoredRule).toHaveValue('legacy-authored');
    const modifier = container.querySelector('[data-field-path="situationalModifiers.0.modifier"]');
    expect(modifier).not.toBeNull();
    fireEvent.change(modifier as HTMLInputElement, { target: { value: '-4' } });

    const draft = readRawDraft();
    expect(draft.situationalModifiers).toEqual([{ ...legacyModifier, modifier: -4 }]);
    expect(draft.procedures).toMatchObject({
      modifiers: expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-1',
          label: 'Darkness',
          value: { kind: 'fixed', value: -4 },
        }),
        customLegacyRule,
      ]),
    });

    fireEvent.change(screen.getByLabelText('Situational Modifiers setting'), {
      target: { value: 'omitted' },
    });
    const cleared = readRawDraft();
    expect(cleared).not.toHaveProperty('situationalModifiers');
    expect(cleared.procedures).toMatchObject({ modifiers: [customLegacyRule] });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        procedures: expect.objectContaining({ modifiers: [customLegacyRule] }),
      }),
    );
  });

  it('keeps malformed raw situational modifier rows visible and blocks invalid saves', () => {
    const onSubmit = vi.fn();
    render(
      <LibraryEntryEditor
        section="skills"
        initial={skillInitial()}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const raw = screen.getByLabelText('Raw YAML');
    fireEvent.change(raw, {
      target: {
        value: 'name: Bow\nattribute: DX\ndifficulty: A\nsituationalModifiers:\n  - null\n',
      },
    });

    expect((raw as HTMLTextAreaElement).value).toContain('situationalModifiers');
    expect(screen.getByText('Contextual rules and actions', { selector: 'summary' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.getByRole('alert')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves one canonical fixed tech level after editing the policy value', async () => {
    const onSubmit = vi.fn();
    render(
      <LibraryEntryEditor
        section="skills"
        initial={skillInitial({
          techLevel: 8,
          techLevelPolicy: { kind: 'fixed', techLevel: 8 },
        })}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await openAdvancedSection('Requirements and defaults');
    const techLevelFields = screen.getAllByLabelText('Tech level');
    expect(techLevelFields).toHaveLength(1);
    fireEvent.change(techLevelFields[0] as HTMLInputElement, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        techLevel: 7,
        techLevelPolicy: { kind: 'fixed', techLevel: 7 },
      }),
    );
  });

  it('repairs an invalid raw metadata status by omitting it and saves the default', () => {
    const onSubmit = vi.fn();
    render(
      <LibraryEntryEditor
        section="skills"
        initial={skillInitial({
          status: 'needs_review',
          role: 'reference',
          preferredEdition: true,
          restricted: true,
        })}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Raw YAML'), {
      target: { value: 'name: Bow\nattribute: DX\ndifficulty: A\nstatus: invalid\n' },
    });

    fireEvent.change(screen.getByLabelText('Status setting'), {
      target: { value: 'omitted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: 'Bow',
      status: 'complete',
      role: 'definition',
      preferredEdition: false,
      restricted: false,
    });
  });

  it('omits status when an initially unmarked entry removes an invalid raw status', () => {
    const onSubmit = vi.fn();
    render(
      <LibraryEntryEditor
        section="skills"
        initial={skillInitial()}
        isPending={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Raw YAML'), {
      target: { value: 'name: Bow\nattribute: DX\ndifficulty: A\nstatus: invalid\n' },
    });
    fireEvent.change(screen.getByLabelText('Status setting'), {
      target: { value: 'omitted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('status');
  });
});
