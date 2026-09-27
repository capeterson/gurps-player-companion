import { useState } from 'react';
import type {
  LibraryLanguageCreate,
  LibraryLanguageOut,
  LibraryStyleCreate,
  LibraryStyleOut,
  LibraryTechniqueCreate,
  LibraryTechniqueOut,
  StyleTechniqueRef,
} from '../../../shared/schemas/campaignLibrary.ts';
import {
  libraryLanguageCreate,
  libraryStyleCreate,
  libraryTechniqueCreate,
} from '../../../shared/schemas/campaignLibrary.ts';
import { libraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import { TECHNIQUE_DIFFICULTIES } from '../../../shared/schemas/technique.ts';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { LibraryFormFooter } from './LibraryFormFooter.tsx';
import { LibraryMetadataEditor } from './LibraryMetadataEditor.tsx';
import { libraryFormError } from './libraryFormErrors.ts';

type FormProps<T, R> = {
  initial?: R;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: T) => void;
  onCancel: () => void;
};

function SourceAndDescription({
  source,
  setSource,
  description,
  setDescription,
  isPending,
}: {
  source: string;
  setSource: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  isPending: boolean;
}) {
  return (
    <>
      <label className="form-control w-32">
        <span className="label-text">Source abbreviation</span>
        <input
          className="input input-bordered input-sm"
          value={source}
          maxLength={40}
          placeholder="MA-71"
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      <div className="form-control min-w-0" inert={isPending || undefined}>
        <span className="label-text">Description</span>
        <RichTextEditor
          aria-label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description (Markdown supported)…"
        />
      </div>
    </>
  );
}

export function LanguageForm(props: FormProps<LibraryLanguageCreate, LibraryLanguageOut>) {
  const { initial, isPending, error, onSubmit, onCancel } = props;
  const [metadata, setMetadata] = useState(() => libraryMetadata.parse(initial ?? {}));
  const [name, setName] = useState(initial?.name ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isSignLanguage, setIsSignLanguage] = useState(initial?.isSignLanguage ?? false);
  const [formError, setFormError] = useState<string | null>(null);
  function submit() {
    try {
      onSubmit(
        libraryLanguageCreate.parse({
          ...metadata,
          name,
          source: source || null,
          description: description || null,
          isSignLanguage,
        }),
      );
      setFormError(null);
    } catch (cause) {
      setFormError(libraryFormError(cause));
    }
  }
  return (
    <fieldset className="fieldset min-w-0 space-y-3" disabled={isPending}>
      <legend className="sr-only">{initial ? 'Edit language' : 'Add language'}</legend>
      <label className="form-control">
        <span className="label-text">Language name *</span>
        <input
          className="input input-bordered input-sm"
          value={name}
          maxLength={160}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <SourceAndDescription
        source={source}
        setSource={setSource}
        description={description}
        setDescription={setDescription}
        isPending={isPending}
      />
      <label className="label cursor-pointer justify-start gap-2">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={isSignLanguage}
          onChange={(event) => setIsSignLanguage(event.target.checked)}
        />
        <span className="label-text">Sign language (no written fluency)</span>
      </label>
      <LibraryMetadataEditor value={metadata} onChange={setMetadata} />
      <LibraryFormFooter
        noun="language"
        editing={Boolean(initial)}
        isPending={isPending}
        canSubmit={Boolean(name.trim())}
        error={error || formError}
        onCancel={onCancel}
        onSubmit={submit}
      />
    </fieldset>
  );
}

export function TechniqueForm(props: FormProps<LibraryTechniqueCreate, LibraryTechniqueOut>) {
  const { initial, isPending, error, onSubmit, onCancel } = props;
  const [metadata, setMetadata] = useState(() => libraryMetadata.parse(initial ?? {}));
  const [name, setName] = useState(initial?.name ?? '');
  const [defaultSkillName, setDefaultSkillName] = useState(initial?.defaultSkillName ?? '');
  const [difficulty, setDifficulty] = useState<(typeof TECHNIQUE_DIFFICULTIES)[number]>(
    initial?.difficulty ?? 'A',
  );
  const [maxLevel, setMaxLevel] = useState(
    initial?.maxLevel == null ? '' : String(initial.maxLevel),
  );
  const [defaultModifier, setDefaultModifier] = useState(String(initial?.defaultModifier ?? 0));
  const [source, setSource] = useState(initial?.source ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [prereq, setPrereq] = useState(initial?.prereq ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  function submit() {
    try {
      onSubmit(
        libraryTechniqueCreate.parse({
          ...metadata,
          name,
          defaultSkillName,
          difficulty,
          maxLevel: maxLevel.trim() ? Number(maxLevel) : null,
          defaultModifier: Number(defaultModifier),
          source: source || null,
          description: description || null,
          prereq: prereq || null,
        }),
      );
      setFormError(null);
    } catch (cause) {
      setFormError(libraryFormError(cause));
    }
  }
  return (
    <fieldset className="fieldset min-w-0 space-y-3" disabled={isPending}>
      <legend className="sr-only">{initial ? 'Edit technique' : 'Add technique'}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text">Technique name *</span>
          <input
            className="input input-bordered input-sm"
            value={name}
            maxLength={160}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text">Defaults from skill *</span>
          <input
            className="input input-bordered input-sm"
            value={defaultSkillName}
            maxLength={160}
            required
            placeholder="e.g. Karate"
            onChange={(event) => setDefaultSkillName(event.target.value)}
          />
        </label>
        <label className="form-control">
          <span className="label-text">Difficulty</span>
          <select
            className="select select-bordered select-sm"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
          >
            {TECHNIQUE_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {value === 'A' ? 'Average' : 'Hard'} ({value})
              </option>
            ))}
          </select>
        </label>
        <label className="form-control">
          <span className="label-text">Default penalty to skill</span>
          <input
            aria-label="Default penalty to skill"
            type="number"
            className="input input-bordered input-sm"
            min={-99}
            max={0}
            value={defaultModifier}
            onChange={(event) => setDefaultModifier(event.target.value)}
          />
          <span className="label">For example, Karate-1 starts one level below Karate.</span>
        </label>
        <label className="form-control">
          <span className="label-text">Maximum levels above default</span>
          <input
            aria-label="Maximum levels above default"
            type="number"
            className="input input-bordered input-sm"
            min={0}
            max={20}
            value={maxLevel}
            placeholder="No cap"
            onChange={(event) => setMaxLevel(event.target.value)}
          />
          <span className="label">
            A cap of +1 lets a Karate-1 technique reach full Karate. Leave blank for no cap.
          </span>
        </label>
        <SourceAndDescription
          source={source}
          setSource={setSource}
          description={description}
          setDescription={setDescription}
          isPending={isPending}
        />
      </div>
      <LibraryAdvancedFields
        title="Prerequisites"
        defaultOpen={Boolean(prereq)}
        hint="Optional rule text shown when players review the technique."
      >
        <textarea
          aria-label="Technique prerequisites"
          className="textarea textarea-bordered w-full"
          rows={3}
          maxLength={2000}
          value={prereq}
          onChange={(event) => setPrereq(event.target.value)}
        />
      </LibraryAdvancedFields>
      <LibraryMetadataEditor value={metadata} onChange={setMetadata} />
      <LibraryFormFooter
        noun="technique"
        editing={Boolean(initial)}
        isPending={isPending}
        canSubmit={Boolean(name.trim() && defaultSkillName.trim())}
        error={error || formError}
        onCancel={onCancel}
        onSubmit={submit}
      />
    </fieldset>
  );
}

type EditableTechnique = StyleTechniqueRef & { editorId: string };
const splitNames = (value: string) =>
  value
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);

export function StyleForm(props: FormProps<LibraryStyleCreate, LibraryStyleOut>) {
  const { initial, isPending, error, onSubmit, onCancel } = props;
  const [metadata, setMetadata] = useState(() => libraryMetadata.parse(initial ?? {}));
  const [name, setName] = useState(initial?.name ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [skills, setSkills] = useState((initial?.skills ?? []).join('\n'));
  const [perks, setPerks] = useState((initial?.perks ?? []).join('\n'));
  const [techniques, setTechniques] = useState<EditableTechnique[]>(() =>
    (initial?.techniques ?? []).map((row) => ({ ...row, editorId: crypto.randomUUID() })),
  );
  const [formError, setFormError] = useState<string | null>(null);
  function patchTechnique(index: number, patch: Partial<EditableTechnique>) {
    setTechniques((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    );
  }
  function submit() {
    try {
      onSubmit(
        libraryStyleCreate.parse({
          ...metadata,
          name,
          source: source || null,
          description: description || null,
          skills: splitNames(skills),
          perks: splitNames(perks),
          techniques: techniques.map(({ editorId: _editorId, ...row }) => ({
            ...row,
            maxLevel: row.maxLevel ?? null,
          })),
        }),
      );
      setFormError(null);
    } catch (cause) {
      setFormError(libraryFormError(cause));
    }
  }
  return (
    <fieldset className="fieldset min-w-0 space-y-3" disabled={isPending}>
      <legend className="sr-only">{initial ? 'Edit style' : 'Add style'}</legend>
      <label className="form-control">
        <span className="label-text">Style name *</span>
        <input
          className="input input-bordered input-sm"
          value={name}
          maxLength={160}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <SourceAndDescription
        source={source}
        setSource={setSource}
        description={description}
        setDescription={setDescription}
        isPending={isPending}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="form-control">
          <span className="label-text">Skills (one per line)</span>
          <textarea
            className="textarea textarea-bordered"
            rows={3}
            value={skills}
            onChange={(event) => setSkills(event.target.value)}
            placeholder="Karate&#10;Judo"
          />
        </label>
        <label className="form-control">
          <span className="label-text">Perks (one per line)</span>
          <textarea
            className="textarea textarea-bordered"
            rows={3}
            value={perks}
            onChange={(event) => setPerks(event.target.value)}
            placeholder="Style Adaptation"
          />
        </label>
      </div>
      <section
        className="space-y-2 rounded-box border border-base-300 p-3"
        aria-label="Style techniques"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Techniques in this style</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              setTechniques((rows) => [
                ...rows,
                {
                  editorId: crypto.randomUUID(),
                  name: '',
                  defaultSkillName: '',
                  difficulty: 'A',
                  defaultModifier: 0,
                  maxLevel: null,
                },
              ])
            }
          >
            Add technique
          </button>
        </div>
        <p className="text-sm text-base-content/70">
          Add the style’s skills, perks, and techniques here. A character learns those entries
          individually from the character sheet.
        </p>
        {techniques.map((row, index) => (
          <div
            key={row.editorId}
            className="grid gap-2 rounded-box bg-base-200/50 p-3 sm:grid-cols-2"
          >
            <label className="form-control">
              <span className="label-text">Technique {index + 1}</span>
              <input
                aria-label={`Technique ${index + 1} name`}
                className="input input-bordered input-sm"
                value={row.name}
                onChange={(event) => patchTechnique(index, { name: event.target.value })}
              />
            </label>
            <label className="form-control">
              <span className="label-text">Default skill</span>
              <input
                aria-label={`Technique ${index + 1} default skill`}
                className="input input-bordered input-sm"
                value={row.defaultSkillName}
                onChange={(event) =>
                  patchTechnique(index, { defaultSkillName: event.target.value })
                }
              />
            </label>
            <label className="form-control">
              <span className="label-text">Difficulty</span>
              <select
                aria-label={`Technique ${index + 1} difficulty`}
                className="select select-bordered select-sm"
                value={row.difficulty}
                onChange={(event) =>
                  patchTechnique(index, { difficulty: event.target.value as typeof row.difficulty })
                }
              >
                {TECHNIQUE_DIFFICULTIES.map((value) => (
                  <option key={value} value={value}>
                    {value === 'A' ? 'Average' : 'Hard'}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text">Default modifier</span>
              <input
                aria-label={`Technique ${index + 1} default modifier`}
                type="number"
                min={-99}
                max={0}
                className="input input-bordered input-sm"
                value={row.defaultModifier}
                onChange={(event) =>
                  patchTechnique(index, { defaultModifier: Number(event.target.value) })
                }
              />
            </label>
            <label className="form-control">
              <span className="label-text">Maximum above default</span>
              <input
                aria-label={`Technique ${index + 1} maximum above default`}
                type="number"
                min={0}
                max={20}
                className="input input-bordered input-sm"
                value={row.maxLevel ?? ''}
                placeholder="No cap"
                onChange={(event) =>
                  patchTechnique(index, {
                    maxLevel: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost btn-sm justify-self-start text-error"
              onClick={() =>
                setTechniques((rows) => rows.filter((_, rowIndex) => rowIndex !== index))
              }
            >
              Remove technique {index + 1}
            </button>
          </div>
        ))}
      </section>
      <LibraryMetadataEditor value={metadata} onChange={setMetadata} />
      <LibraryFormFooter
        noun="style"
        editing={Boolean(initial)}
        isPending={isPending}
        canSubmit={Boolean(
          name.trim() && techniques.every((row) => row.name.trim() && row.defaultSkillName.trim()),
        )}
        error={error || formError}
        onCancel={onCancel}
        onSubmit={submit}
      />
    </fieldset>
  );
}
