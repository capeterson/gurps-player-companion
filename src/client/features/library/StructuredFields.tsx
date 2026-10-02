import { type ReactNode, useContext, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { SourcebooksContext, sourcebookLabel } from './SourcebooksContext.tsx';
import { newEditorId } from './editorId.ts';
import {
  choiceTag,
  editorLabel,
  matchesChoice,
  objectShape,
  schemaChoices,
  seedSchema,
  unwrapSchema,
} from './editorSchema.ts';

export interface StructuredFieldProps {
  schema: z.ZodTypeAny;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  path?: string | undefined;
  /** Domain controls (references, effects, rich text) can replace one field. */
  renderField?: ((props: StructuredFieldProps) => ReactNode | undefined) | undefined;
}

/** Typed controls, never a JSON textarea. Invalid numeric/string drafts stay in the model. */
export function StructuredFields(props: StructuredFieldProps) {
  const { schema, value, onChange, label, path = '', renderField } = props;
  const id = useId();
  const books = useContext(SourcebooksContext);
  const custom = renderField?.(props);
  if (custom !== undefined) return custom;
  const base = unwrapSchema(schema);
  const optional = schema.isOptional();
  const nullable = schema.isNullable();
  if (optional || nullable) {
    const presentChoices = schemaChoices(base).filter(
      (choice) => !(choice instanceof z.ZodNull) && !(choice instanceof z.ZodUndefined),
    );
    const presentBase =
      presentChoices.length > 1
        ? z.union(presentChoices as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
        : (presentChoices[0] ?? z.string());
    return <OptionalField {...props} base={presentBase} optional={optional} nullable={nullable} />;
  }
  if (base instanceof z.ZodLiteral || base instanceof z.ZodNull || base instanceof z.ZodUndefined)
    return null;
  const choices = schemaChoices(base);
  if (choices.length > 1) return <ChoiceField {...props} choices={choices} />;
  if (base instanceof z.ZodObject) {
    const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    return (
      <fieldset className="fieldset min-w-0 space-y-3 sm:col-span-2">
        <legend className="fieldset-legend break-words">{label}</legend>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {Object.entries(objectShape(base)).map(([key, child]) => (
            <StructuredFields
              key={key}
              schema={child}
              value={row[key]}
              label={editorLabel(key)}
              path={path ? `${path}.${key}` : key}
              renderField={renderField}
              onChange={(next) => {
                const updated = { ...row, [key]: next };
                if (next === undefined) delete updated[key];
                onChange(updated);
              }}
            />
          ))}
        </div>
      </fieldset>
    );
  }
  if (base instanceof z.ZodArray)
    return <ArrayField {...props} element={base.element} maximum={base._def.maxLength?.value} />;
  if (base instanceof z.ZodRecord) return <RecordField {...props} element={base._def.valueType} />;
  if (base instanceof z.ZodBoolean)
    return (
      <label className="flex min-w-0 items-center gap-2 text-sm">
        <input
          id={id}
          data-field-path={path}
          aria-label={label}
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  if (base instanceof z.ZodEnum)
    return (
      <label className="form-control min-w-0 text-sm" htmlFor={id}>
        {label}
        <select
          id={id}
          className="select select-sm min-w-0 w-full"
          data-field-path={path}
          value={String(value ?? base.options[0])}
          onChange={(e) => onChange(e.target.value)}
        >
          {base.options.map((option: string) => (
            <option key={option} value={option}>
              {editorLabel(option)}
            </option>
          ))}
        </select>
      </label>
    );
  if (path.endsWith('sourceId'))
    return (
      <label className="form-control min-w-0 text-sm" htmlFor={id}>
        {label}
        <select
          id={id}
          className="select select-sm w-full min-w-0"
          data-field-path={path}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose a sourcebook…</option>
          {value && !books.some((b) => b.id === value) ? (
            <option value={String(value)}>Unavailable sourcebook</option>
          ) : null}
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {sourcebookLabel(book)}
            </option>
          ))}
        </select>
      </label>
    );
  const numeric = base instanceof z.ZodNumber;
  const longText = /description|notes|sourceText|prerequisites|rawText|advisory/i.test(path);
  return (
    <label className="form-control min-w-0 text-sm" htmlFor={id}>
      {label}
      {longText ? (
        <textarea
          id={id}
          className="textarea min-w-0 w-full"
          data-field-path={path}
          rows={3}
          value={String(value ?? '')}
          maxLength={base instanceof z.ZodString ? (base.maxLength ?? undefined) : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="input input-sm min-w-0 w-full"
          data-field-path={path}
          type="text"
          inputMode={numeric ? 'decimal' : undefined}
          min={numeric ? (base.minValue ?? undefined) : undefined}
          max={numeric ? (base.maxValue ?? undefined) : undefined}
          step={numeric && base.isInt ? 1 : 'any'}
          maxLength={base instanceof z.ZodString ? (base.maxLength ?? undefined) : undefined}
          value={typeof value === 'object' ? '' : String(value ?? '')}
          onChange={(e) =>
            onChange(
              numeric &&
                e.target.value.trim() !== '' &&
                !e.target.value.trim().endsWith('.') &&
                e.target.value.trim() !== '-0' &&
                Number.isFinite(Number(e.target.value))
                ? Number(e.target.value)
                : e.target.value,
            )
          }
          onBlur={() => {
            if (
              numeric &&
              typeof value === 'string' &&
              value.trim() !== '' &&
              Number.isFinite(Number(value))
            )
              onChange(Number(value));
          }}
        />
      )}
    </label>
  );
}

function OptionalField({
  base,
  optional,
  nullable,
  ...props
}: StructuredFieldProps & { base: z.ZodTypeAny; optional: boolean; nullable: boolean }) {
  const { value, onChange, label } = props;
  const retained = useRef<unknown>(undefined);
  if (value != null) retained.current = value;
  const present = value != null;
  return (
    <div
      className={`min-w-0 space-y-2 ${base instanceof z.ZodString || base instanceof z.ZodNumber || base instanceof z.ZodBoolean || base instanceof z.ZodEnum ? '' : 'sm:col-span-2'}`}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium break-words">{label}</span>
        <select
          aria-label={`${label} setting`}
          className="select select-xs min-w-0 max-w-full"
          value={value === undefined ? 'omitted' : value === null ? 'null' : 'value'}
          onChange={(e) =>
            onChange(
              e.target.value === 'omitted'
                ? undefined
                : e.target.value === 'null'
                  ? null
                  : (retained.current ?? seedSchema(base)),
            )
          }
        >
          {optional && <option value="omitted">Not specified</option>}
          {nullable && <option value="null">None</option>}
          <option value="value">Set value</option>
        </select>
      </div>
      {present && <StructuredFields {...props} schema={base} renderField={props.renderField} />}
    </div>
  );
}

function ChoiceField({ choices, ...props }: StructuredFieldProps & { choices: z.ZodTypeAny[] }) {
  const { value, onChange, label } = props;
  const retained = useRef(new Map<number, unknown>());
  const [selected, setSelected] = useState(() =>
    choices.findIndex((option) => matchesChoice(option, value)),
  );
  retained.current.set(selected, value);
  return (
    <div className="min-w-0 space-y-3 rounded-box border border-base-300 p-3 sm:col-span-2">
      <label className="form-control min-w-0 text-sm">
        {label} type
        <select
          aria-label={`${label} type`}
          className="select select-sm min-w-0 w-full"
          value={selected}
          onChange={(e) => {
            const index = Number(e.target.value);
            const target = choices[index];
            if (!target) return;
            setSelected(index);
            const previous =
              value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
            const seed = seedSchema(target);
            const common = Object.fromEntries(
              Object.entries(objectShape(target))
                .filter(([key]) => key in previous && key !== 'kind' && key !== 'op')
                .map(([key]) => [key, previous[key]]),
            );
            const next = retained.current.get(index) ?? seed;
            onChange(
              next && typeof next === 'object' && !Array.isArray(next)
                ? { ...next, ...common }
                : next,
            );
          }}
        >
          {selected < 0 && <option value={-1}>Choose a type…</option>}
          {choices.map((option, i) => (
            <option key={`${i}-${choiceTag(option)}`} value={i}>
              {editorLabel(choiceTag(option))}
            </option>
          ))}
        </select>
      </label>
      <StructuredFields {...props} schema={choices[selected] ?? choices[0] ?? z.string()} />
    </div>
  );
}

function ArrayField({
  element,
  maximum,
  ...props
}: StructuredFieldProps & { element: z.ZodTypeAny; maximum?: number | undefined }) {
  const { value, onChange, label, path = '', renderField } = props;
  const rows = Array.isArray(value) ? value : [];
  const ids = useRef<string[]>([]);
  while (ids.current.length < rows.length) ids.current.push(newEditorId());
  const move = (index: number, direction: number) => {
    const other = index + direction;
    if (other < 0 || other >= rows.length) return;
    const next = [...rows];
    [next[index], next[other]] = [next[other], next[index]];
    const first = ids.current[index];
    const second = ids.current[other];
    if (first && second) {
      ids.current[index] = second;
      ids.current[other] = first;
    }
    onChange(next);
  };
  return (
    <fieldset className="fieldset min-w-0 space-y-3 sm:col-span-2">
      <legend className="fieldset-legend break-words">{label}</legend>
      {rows.length === 0 && (
        <p className="text-xs text-base-content/60">
          {path.endsWith('defaults') ? 'No defaults allowed.' : 'No entries.'}
        </p>
      )}
      {rows.map((row, index) => (
        <div
          key={ids.current[index]}
          className="min-w-0 rounded-box border border-base-300 p-3 space-y-2"
        >
          <div className="flex flex-wrap justify-end gap-1">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              aria-label={`Move ${label} ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              aria-label={`Move ${label} ${index + 1} down`}
              disabled={index === rows.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={maximum !== undefined && rows.length >= maximum}
              onClick={() => {
                ids.current.splice(index + 1, 0, newEditorId());
                const copy = structuredClone(row);
                if (copy && typeof copy === 'object' && 'id' in copy)
                  (copy as Record<string, unknown>).id = newEditorId();
                onChange([...rows.slice(0, index + 1), copy, ...rows.slice(index + 1)]);
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              aria-label={`Remove ${label} ${index + 1}`}
              onClick={() => {
                ids.current.splice(index, 1);
                onChange(rows.filter((_, i) => i !== index));
              }}
            >
              Remove
            </button>
          </div>
          <StructuredFields
            schema={element}
            value={row}
            label={`${label} ${index + 1}`}
            path={`${path}.${index}`}
            renderField={renderField}
            onChange={(next) => onChange(rows.map((old, i) => (i === index ? next : old)))}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm w-fit"
        disabled={maximum !== undefined && rows.length >= maximum}
        onClick={() => {
          const next = seedSchema(element);
          if (next && typeof next === 'object' && 'id' in next)
            (next as Record<string, unknown>).id = newEditorId();
          ids.current[rows.length] = newEditorId();
          onChange([...rows, next]);
        }}
      >
        Add {label.toLowerCase()}
      </button>
    </fieldset>
  );
}

function RecordField({ element, ...props }: StructuredFieldProps & { element: z.ZodTypeAny }) {
  const { value, onChange, label, path = '', renderField } = props;
  const rows = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const [newKey, setNewKey] = useState('');
  return (
    <fieldset className="fieldset min-w-0 space-y-3 sm:col-span-2">
      <legend className="fieldset-legend">{label}</legend>
      {Object.entries(rows).map(([key, row]) => (
        <div key={key} className="min-w-0 space-y-2">
          <StructuredFields
            schema={element}
            value={row}
            label={key}
            path={`${path}.${key}`}
            renderField={renderField}
            onChange={(next) => onChange({ ...rows, [key]: next })}
          />
          <button
            type="button"
            className="btn btn-ghost btn-xs text-error"
            onClick={() => {
              const next = { ...rows };
              delete next[key];
              onChange(next);
            }}
          >
            Remove {key}
          </button>
        </div>
      ))}
      <label className="form-control min-w-0 text-sm">
        {label} name
        <input
          className="input input-sm w-full min-w-0"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-sm w-fit"
        disabled={!newKey.trim() || Object.hasOwn(rows, newKey)}
        onClick={() => {
          onChange({ ...rows, [newKey]: seedSchema(element) });
          setNewKey('');
        }}
      >
        Add {label.toLowerCase()}
      </button>
    </fieldset>
  );
}
