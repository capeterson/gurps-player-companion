import { useId, useRef, useState } from 'react';
import { parse, stringify } from 'yaml';
import { fixedCalculation } from '../../../../shared/domain/calculation.ts';
import {
  type LibraryModifierCreate,
  type LibrarySourceCreate,
  libraryModifierCreate,
  librarySourceCreate,
} from '../../../../shared/schemas/libraryMetadata.ts';
import type { LocalLibraryModifier, LocalLibrarySource } from '../../../db/dexie.ts';
import { CalculationEditor } from '../CalculationEditor.tsx';
import { LibraryMetadataEditor } from '../LibraryMetadataEditor.tsx';
import type { LibrarySectionConfig } from '../LibrarySection.tsx';
import { libraryFormError, libraryValidationIssues } from '../libraryFormErrors.ts';
import { useLibraryEntryMutations } from '../useLocalLibrary.ts';
import { CrudLibrarySection, type LibrarySectionShellProps } from './CrudLibrarySection.tsx';

function CatalogForm({
  section,
  initial,
  onSubmit,
  onCancel,
  error,
  pending,
}: {
  section: 'sources' | 'modifiers';
  initial: LocalLibrarySource | LocalLibraryModifier | null;
  onSubmit: (body: LibrarySourceCreate | LibraryModifierCreate) => void;
  onCancel: () => void;
  error: string | undefined;
  pending: boolean;
}) {
  const [source, setSource] = useState<LibrarySourceCreate>(() =>
    initial && section === 'sources'
      ? (initial as LocalLibrarySource)
      : { name: '', abbreviation: '', priority: 100 },
  );
  const [modifier, setModifier] = useState<LibraryModifierCreate>(() =>
    initial && section === 'modifiers'
      ? (initial as LocalLibraryModifier)
      : {
          name: '',
          category: 'enhancement',
          tags: [],
          costType: 'percent',
          applicability: { universal: true, traitKinds: [], traitTags: [], traits: [] },
          calculation: fixedCalculation({ modifier: { value: 0, unit: 'percentage' } }),
        },
  );
  const [applicability, setApplicability] = useState(() => stringify(modifier.applicability));
  const [tags, setTags] = useState(() => modifier.tags.join(', '));
  const [valid, setValid] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFieldSetElement>(null);
  const errorId = useId();
  function patchSource(next: Partial<LibrarySourceCreate>) {
    setSource((current) => ({ ...current, ...next }));
    setSourceErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !(key in next))),
    );
    setLocalError(null);
  }
  function submit() {
    setLocalError(null);
    setSourceErrors({});
    try {
      const schema = section === 'sources' ? librarySourceCreate : libraryModifierCreate;
      const {
        id: _id,
        campaignId: _campaignId,
        revision: _revision,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...body
      } = (
        section === 'sources'
          ? source
          : {
              ...modifier,
              applicability: parse(applicability),
              tags: tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            }
      ) as Record<string, unknown>;
      onSubmit(schema.parse(body));
    } catch (e) {
      const labels = { name: 'Publication title', abbreviation: 'Abbreviation' };
      const issues = libraryValidationIssues(e);
      if (section === 'sources' && issues.length) {
        const errors = Object.fromEntries(
          issues.map((issue) => {
            const key = String(issue.path[0] ?? '');
            const label = labels[key as keyof typeof labels] ?? key;
            const missing =
              key in source && String(source[key as keyof typeof source] ?? '').trim() === '';
            return [key, missing ? `Enter ${label.toLowerCase()}.` : issue.message];
          }),
        );
        setSourceErrors(errors);
        const firstField = issues[0]?.path[0];
        if (typeof firstField === 'string')
          formRef.current?.querySelector<HTMLInputElement>(`[name="${firstField}"]`)?.focus();
        setLocalError(`Check the source fields: ${Object.values(errors).join(' ')}`);
      } else {
        setLocalError(libraryFormError(e));
      }
    }
  }
  return (
    <fieldset ref={formRef} disabled={pending} className="fieldset min-w-0 p-3">
      {section === 'sources' ? (
        <>
          <label>
            Publication title <span aria-hidden="true">*</span>
            <input
              name="name"
              maxLength={160}
              aria-label="Publication title"
              aria-required="true"
              aria-invalid={Boolean(sourceErrors.name)}
              aria-describedby={sourceErrors.name ? `${errorId}-name` : undefined}
              className="input w-full"
              value={source.name}
              onChange={(e) => patchSource({ name: e.target.value })}
            />
            {sourceErrors.name && (
              <span id={`${errorId}-name`} className="text-error">
                {sourceErrors.name}
              </span>
            )}
          </label>
          <label>
            Abbreviation <span aria-hidden="true">*</span>
            <input
              name="abbreviation"
              maxLength={40}
              aria-label="Abbreviation"
              aria-required="true"
              aria-invalid={Boolean(sourceErrors.abbreviation)}
              aria-describedby={sourceErrors.abbreviation ? `${errorId}-abbreviation` : undefined}
              className="input w-full"
              value={source.abbreviation}
              onChange={(e) => patchSource({ abbreviation: e.target.value })}
            />
            {sourceErrors.abbreviation && (
              <span id={`${errorId}-abbreviation`} className="text-error">
                {sourceErrors.abbreviation}
              </span>
            )}
          </label>
          <label>
            Edition
            <input
              name="edition"
              maxLength={160}
              className="input w-full"
              value={source.edition ?? ''}
              onChange={(e) => patchSource({ edition: e.target.value })}
            />
          </label>
          <label>
            Priority (lower first)
            <input
              name="priority"
              aria-invalid={Boolean(sourceErrors.priority)}
              aria-describedby={sourceErrors.priority ? `${errorId}-priority` : undefined}
              className="input w-full"
              type="number"
              min={0}
              max={100000}
              step={1}
              value={source.priority}
              onChange={(e) => patchSource({ priority: Number(e.target.value) })}
            />
            {sourceErrors.priority && (
              <span id={`${errorId}-priority`} className="text-error">
                {sourceErrors.priority}
              </span>
            )}
          </label>
          <label>
            Notes
            <textarea
              name="notes"
              maxLength={20000}
              className="textarea w-full"
              value={source.notes ?? ''}
              onChange={(e) => patchSource({ notes: e.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Modifier name
            <input
              className="input w-full"
              value={modifier.name}
              onChange={(e) => setModifier({ ...modifier, name: e.target.value })}
            />
          </label>
          <label>
            Category
            <select
              className="select"
              value={modifier.category}
              onChange={(e) =>
                setModifier({
                  ...modifier,
                  category: e.target.value as 'enhancement' | 'limitation',
                })
              }
            >
              <option value="enhancement">Enhancement</option>
              <option value="limitation">Limitation</option>
            </select>
          </label>
          <label>
            Description
            <textarea
              className="textarea w-full"
              value={modifier.description ?? ''}
              onChange={(e) => setModifier({ ...modifier, description: e.target.value })}
            />
          </label>
          <label>
            Cost type
            <select
              className="select"
              value={modifier.costType}
              onChange={(e) =>
                setModifier({ ...modifier, costType: e.target.value as 'percent' | 'flat' })
              }
            >
              <option value="percent">Percentage</option>
              <option value="flat">Points</option>
            </select>
          </label>
          <label>
            Tags (comma-separated)
            <input
              className="input w-full"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          <label>
            Mutually exclusive group
            <input
              className="input w-full"
              value={modifier.group ?? ''}
              onChange={(e) => setModifier({ ...modifier, group: e.target.value || null })}
            />
          </label>
          <label>
            Legacy citation
            <input
              className="input w-full"
              value={modifier.source ?? ''}
              onChange={(e) => setModifier({ ...modifier, source: e.target.value || null })}
            />
          </label>
          <LibraryMetadataEditor
            value={modifier}
            onChange={(metadata) => setModifier({ ...modifier, ...metadata })}
          />
          <label>
            Applicability (YAML)
            <textarea
              className="textarea w-full font-mono"
              rows={7}
              value={applicability}
              onChange={(e) => setApplicability(e.target.value)}
            />
          </label>
          <CalculationEditor
            allowBasic={false}
            value={modifier.calculation}
            onChange={(calculation) => setModifier({ ...modifier, calculation })}
            onValidityChange={setValid}
            output="modifier"
            unit={modifier.costType === 'flat' ? 'points' : 'percentage'}
          />
        </>
      )}
      {(localError || error) && (
        <p role="alert" className="text-error break-words">
          {localError || error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn" disabled={!valid} onClick={submit}>
          Save {section === 'sources' ? 'source' : 'modifier'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </fieldset>
  );
}

export function CatalogSection({
  section,
  ...shell
}: LibrarySectionShellProps & { section: 'sources' | 'modifiers' }) {
  const crud = useLibraryEntryMutations<LibrarySourceCreate | LibraryModifierCreate>(
    shell.campaignId,
    section,
  );
  const noun = section === 'sources' ? 'source' : 'modifier';
  const config: LibrarySectionConfig<LocalLibrarySource | LocalLibraryModifier> = {
    key: section,
    entityClass: section === 'sources' ? 'campaign_library_source' : 'campaign_library_modifier',
    noun,
    plural: section,
    columns: [],
    group: (row) => ('category' in row ? row.category : 'Publications'),
    meta: (row) =>
      'priority' in row
        ? `${row.abbreviation} · Priority ${row.priority}`
        : `${row.category} · ${row.status ?? 'complete'}`,
    detail: (row) => (
      <p className="whitespace-pre-wrap break-words">
        {'notes' in row ? row.notes : 'description' in row ? row.description : ''}
      </p>
    ),
    deleteTitle: `Delete library ${noun}`,
    deleteNote: 'Existing character costs remain unchanged.',
  };
  return (
    <CrudLibrarySection
      shell={shell}
      config={config}
      entries={shell.library[section]}
      crud={crud}
      renderForm={(row) => (
        <CatalogForm
          key={row?.id ?? 'new'}
          section={section}
          initial={row}
          pending={row ? crud.update.isPending : crud.create.isPending}
          error={(row ? crud.update.error : crud.create.error)?.message}
          onSubmit={(body) =>
            row ? crud.update.mutate({ id: row.id, body }) : crud.create.mutate(body)
          }
          onCancel={() => (row ? crud.setEditId(null) : crud.setAddOpen(false))}
        />
      )}
    />
  );
}
