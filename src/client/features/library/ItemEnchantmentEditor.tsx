import { useRef, useState } from 'react';
import { canAdoptLibraryEntry } from '../../../shared/domain/libraryIdentity.ts';
import { formatSigned } from '../../../shared/format/number.ts';
import type { LibraryEnchantmentOut } from '../../../shared/schemas/campaignLibrary.ts';
import {
  type EnchantmentEffect,
  enchantmentMechanics,
  enchantmentRef,
} from '../../../shared/schemas/inventory.ts';
import { StructuredFields } from './StructuredFields.tsx';
import { newEditorId } from './editorId.ts';
import { editorLabel } from './editorSchema.ts';

const metadataSchema = enchantmentRef.omit({
  definitionId: true,
  definitionRevision: true,
  definitionSource: true,
  mechanics: true,
});
const linkedMetadataSchema = metadataSchema.omit({ spellName: true });

interface Props {
  value: unknown;
  onChange: (value: unknown) => void;
  definitions: readonly LibraryEnchantmentOut[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function effectSummary(effect: EnchantmentEffect): string {
  return `${formatSigned(effect.value)} ${effect.target === 'skill' ? effect.skillName : editorLabel(effect.target)}`;
}

/** Linked mechanics are authoritative; independent entries own their complete snapshot. */
export function ItemEnchantmentEditor({ value, onChange, definitions }: Props) {
  const entries: unknown[] = Array.isArray(value) ? value : [];
  const ids = useRef<string[]>([]);
  const [selectedDefinition, setSelectedDefinition] = useState('');
  while (ids.current.length < entries.length) ids.current.push(newEditorId());
  const attachable = definitions.filter(canAdoptLibraryEntry);
  const full = entries.length >= 50;
  function update(index: number, entry: unknown) {
    onChange(entries.map((previous, position) => (position === index ? entry : previous)));
  }
  function move(index: number, direction: number) {
    const destination = index + direction;
    if (destination < 0 || destination >= entries.length) return;
    const next = [...entries];
    [next[index], next[destination]] = [next[destination], next[index]];
    const firstId = ids.current[index];
    const secondId = ids.current[destination];
    if (firstId && secondId) {
      ids.current[index] = secondId;
      ids.current[destination] = firstId;
    }
    onChange(next);
  }
  return (
    <fieldset className="fieldset min-w-0 space-y-3">
      <legend className="fieldset-legend">Attached enchantments</legend>
      {entries.length === 0 && <p className="text-xs text-base-content/60">No enchantments.</p>}
      {entries.map((raw, index) => {
        const entry = asRecord(raw);
        const linked = typeof entry.definitionId === 'string' && entry.definitionId !== '';
        const definition = linked
          ? definitions.find((candidate) => candidate.id === entry.definitionId)
          : undefined;
        const mechanics = enchantmentMechanics.safeParse(entry.mechanics);
        return (
          <div
            key={ids.current[index]}
            className="min-w-0 space-y-3 rounded-box border border-base-300 p-3"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="break-words font-medium">
                {String(entry.spellName || `Enchantment ${index + 1}`)}
              </span>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={index === 0}
                  aria-label={`Move enchantment ${index + 1} up`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={index === entries.length - 1}
                  aria-label={`Move enchantment ${index + 1} down`}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={full}
                  aria-label={`Duplicate enchantment ${index + 1}`}
                  onClick={() => {
                    ids.current.splice(index + 1, 0, newEditorId());
                    onChange([
                      ...entries.slice(0, index + 1),
                      structuredClone(raw),
                      ...entries.slice(index + 1),
                    ]);
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  aria-label={`Remove enchantment ${index + 1}`}
                  onClick={() => {
                    ids.current.splice(index, 1);
                    onChange(entries.filter((_, position) => position !== index));
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
            <StructuredFields
              schema={linked ? linkedMetadataSchema : metadataSchema}
              value={entry}
              label={`Enchantment ${index + 1}`}
              path={`enchantments.${index}`}
              onChange={(next) => update(index, next)}
            />
            {linked ? (
              <div className="min-w-0 space-y-2">
                <p className="break-words text-xs text-base-content/60">
                  Mechanics follow{' '}
                  {definition?.name ?? String(entry.spellName ?? 'the library definition')}.
                </p>
                <details className="min-w-0">
                  <summary className="cursor-pointer text-xs text-base-content/70">
                    View linked mechanics
                  </summary>
                  {mechanics.success ? (
                    <div className="mt-2 space-y-2 break-words text-sm">
                      <p>Applies to: {editorLabel(mechanics.data.applicability)}</p>
                      <p>
                        Stacking:{' '}
                        {mechanics.data.stackingPolicy.kind === 'stack'
                          ? 'Add all contributions'
                          : `Highest in ${mechanics.data.stackingPolicy.key}`}
                      </p>
                      {mechanics.data.effects.length > 0 && (
                        <ul className="list-inside list-disc">
                          {mechanics.data.effects.map((effect, position) => (
                            <li key={`${position}-${effect.target}`}>{effectSummary(effect)}</li>
                          ))}
                        </ul>
                      )}
                      {mechanics.data.levels.map((level) => (
                        <div key={level.level}>
                          <p className="font-medium">
                            Level {level.level}
                            {level.label ? ` · ${level.label}` : ''}
                          </p>
                          <ul className="list-inside list-disc">
                            {level.effects.map((effect, position) => (
                              <li key={`${position}-${effect.target}`}>{effectSummary(effect)}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                      {mechanics.data.effects.length === 0 &&
                        mechanics.data.levels.length === 0 && <p>No mechanical effects.</p>}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-base-content/60">
                      No valid mechanics snapshot.
                    </p>
                  )}
                </details>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label={`Make enchantment ${index + 1} independent`}
                  onClick={() =>
                    update(index, {
                      ...entry,
                      definitionId: null,
                      definitionRevision: null,
                      definitionSource: null,
                    })
                  }
                >
                  Make independent
                </button>
              </div>
            ) : (
              <StructuredFields
                schema={enchantmentRef.shape.mechanics}
                value={entry.mechanics}
                label="Independent mechanics"
                path={`enchantments.${index}.mechanics`}
                onChange={(next) => {
                  const { mechanics: _previousMechanics, ...metadata } = entry;
                  update(index, next === undefined ? metadata : { ...metadata, mechanics: next });
                }}
              />
            )}
          </div>
        );
      })}
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="form-control min-w-0 text-sm">
          Library enchantment
          <select
            className="select select-sm min-w-0 w-full"
            value={selectedDefinition}
            onChange={(event) => setSelectedDefinition(event.target.value)}
          >
            <option value="">Choose a definition…</option>
            {attachable.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-sm self-end"
          disabled={full || !selectedDefinition}
          onClick={() => {
            const definition = attachable.find((candidate) => candidate.id === selectedDefinition);
            if (!definition) return;
            ids.current[entries.length] = newEditorId();
            onChange([
              ...entries,
              {
                spellName: definition.name,
                definitionId: definition.id,
                definitionRevision: definition.revision >= 0 ? definition.revision : null,
                definitionSource: definition.source,
                mechanics: structuredClone({
                  applicability: definition.applicability,
                  effects: definition.effects,
                  levels: definition.levels,
                  stackingPolicy: definition.stackingPolicy,
                }),
              },
            ]);
            setSelectedDefinition('');
          }}
        >
          Attach enchantment
        </button>
      </div>
      <button
        type="button"
        className="btn btn-sm w-fit"
        disabled={full}
        onClick={() => {
          ids.current[entries.length] = newEditorId();
          onChange([...entries, { spellName: '' }]);
        }}
      >
        Add independent enchantment
      </button>
    </fieldset>
  );
}
