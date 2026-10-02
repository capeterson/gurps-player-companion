import { useContext, useRef, useState } from 'react';
import { parse, stringify } from 'yaml';
import { withLegacyModifiers } from '../../../shared/domain/skillProcedures.ts';
import type { SituationalModifier } from '../../../shared/schemas/skill.ts';
import {
  exportSourceReferences,
  importSourceReferences,
} from '../../../shared/yaml/sourceReferences.ts';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { LibraryEntryFields } from './LibraryEntryFields.tsx';
import { LibraryFormFooter } from './LibraryFormFooter.tsx';
import { SourcebooksContext } from './SourcebooksContext.tsx';
import { objectShape, seedSchema } from './editorSchema.ts';
import {
  type LibraryEditorSection,
  libraryEditorNouns,
  libraryEditorSchemas,
} from './libraryEditorSchemas.ts';
import { libraryFormError } from './libraryFormErrors.ts';

export interface LibraryEntryEditorProps<T> {
  section: LibraryEditorSection;
  initial?: Record<string, unknown> | undefined;
  isPending: boolean;
  error?: string | null | undefined;
  onSubmit: (body: T) => void | Promise<void>;
  onCancel: () => void;
}

/** A complete form's explicit removal must not become an omitted PATCH that keeps old data. */
export function entrySaveBody(
  section: LibraryEditorSection,
  draft: Record<string, unknown>,
  initial?: Record<string, unknown>,
) {
  const body = { ...draft };
  const metadataDefaults: Record<string, unknown> = {
    status: 'complete',
    role: 'definition',
    preferredEdition: false,
    restricted: false,
  };
  if (!initial) return body;
  for (const [key, child] of Object.entries(objectShape(libraryEditorSchemas[section]))) {
    if (initial[key] === undefined || body[key] !== undefined || key === 'key') continue;
    if (child.isNullable()) body[key] = null;
    else if (Object.hasOwn(metadataDefaults, key)) body[key] = metadataDefaults[key];
    else if (section === 'skills' && key === 'techLevelPolicy')
      body[key] =
        body.techLevel == null
          ? { kind: 'not_applicable' }
          : { kind: 'fixed', techLevel: body.techLevel };
    else if (section === 'skills' && key === 'specializationPolicy')
      body[key] = body.defaultSpecialization ? { kind: 'optional_freeform' } : { kind: 'none' };
    else if (section === 'skills' && key === 'procedures')
      body[key] = withLegacyModifiers(
        undefined,
        (body.situationalModifiers ?? []) as SituationalModifier[],
      );
  }
  return body;
}

/** One complete form draft: changing view never reconstructs or drops hidden fields. */
export function LibraryEntryEditor<T>({
  section,
  initial,
  isPending,
  error,
  onSubmit,
  onCancel,
}: LibraryEntryEditorProps<T>) {
  const schema = libraryEditorSchemas[section];
  const form = useRef<HTMLFieldSetElement>(null);
  const books = useContext(SourcebooksContext);
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    initial
      ? Object.fromEntries(
          Object.keys(objectShape(schema))
            .filter((key) => key in initial)
            .map((key) => [key, initial[key]]),
        )
      : (seedSchema(schema) as Record<string, unknown>),
  );
  const [raw, setRaw] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [childrenValid, setChildrenValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewRevision, setViewRevision] = useState(0);
  const validation = schema.safeParse(draft);
  function update(next: Record<string, unknown>) {
    setDraft(next);
    setRaw(null);
    setFormError(null);
  }
  function rawText() {
    try {
      return stringify(exportSourceReferences(draft, books));
    } catch {
      return stringify(draft);
    }
  }
  function editRaw(text: string) {
    setRaw(text);
    try {
      const value: unknown = parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Enter one library definition.');
      const mapped = importSourceReferences(value as Record<string, unknown>, books) as Record<
        string,
        unknown
      >;
      // Keep incomplete but structurally readable drafts editable through the form.
      const unknownFields = Object.keys(mapped).filter((key) => !(key in objectShape(schema)));
      if (unknownFields.length) throw new Error(`Unknown fields: ${unknownFields.join(', ')}`);
      setDraft(mapped);
      setViewRevision((old) => old + 1);
      setRawError(null);
      setFormError(null);
    } catch (cause) {
      setRawError(libraryFormError(cause));
    }
  }
  async function submit() {
    if (rawError || !childrenValid) return;
    const result = validation.success
      ? schema.safeParse(entrySaveBody(section, draft, initial))
      : validation;
    if (!result.success) {
      setFormError(libraryFormError(result.error));
      const path = result.error.issues[0]?.path.join('.');
      const input = Array.from(
        form.current?.querySelectorAll<HTMLElement>('[data-field-path]') ?? [],
      ).find((element) => element.dataset.fieldPath === path);
      let parent = input?.parentElement;
      while (parent) {
        if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
        parent = parent.parentElement;
      }
      input?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSubmit(result.data as T);
    } catch (cause) {
      setFormError(libraryFormError(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <fieldset
      ref={form}
      className="card min-w-0 space-y-4 border border-primary/30 p-card"
      disabled={isPending || saving}
    >
      <fieldset disabled={Boolean(rawError)} className="min-w-0">
        <LibraryEntryFields
          key={viewRevision}
          section={section}
          value={draft}
          onChange={update}
          onValidityChange={setChildrenValid}
        />
      </fieldset>
      <LibraryAdvancedFields title="Raw YAML" error={rawError} subtle>
        <label className="form-control min-w-0 text-sm">
          Raw YAML
          <textarea
            aria-label="Raw YAML"
            className="textarea min-w-0 w-full font-mono text-xs"
            rows={12}
            spellCheck={false}
            readOnly={!childrenValid}
            value={raw ?? rawText()}
            onChange={(event) => editRaw(event.target.value)}
          />
        </label>
        {!childrenValid && (
          <p className="text-sm text-error">Correct the invalid fields above to edit YAML.</p>
        )}
        {rawError && (
          <>
            <p role="alert" className="text-error break-words">
              {rawError}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setRaw(null);
                setRawError(null);
              }}
            >
              Use last readable draft
            </button>
          </>
        )}
      </LibraryAdvancedFields>
      {formError && (
        <p role="alert" className="alert alert-error break-words">
          {formError}
        </p>
      )}
      <LibraryFormFooter
        noun={libraryEditorNouns[section]}
        editing={Boolean(initial)}
        isPending={isPending || saving}
        canSubmit={!rawError && childrenValid}
        error={error}
        onCancel={onCancel}
        onSubmit={() => void submit()}
      />
      {!validation.success && formError && (
        <p className="text-sm text-base-content/70">Correct the indicated fields before saving.</p>
      )}
    </fieldset>
  );
}
