import { useState } from 'react';
import {
  type ActiveEffectDefinition,
  activeEffectDefinitionCreate,
} from '../../../shared/schemas/activeEffects.ts';
import { EffectsEditor } from './EffectsEditor.tsx';

export function ActiveEffectForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ActiveEffectDefinition;
  onSave: (value: ActiveEffectDefinition) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '');
  const [effects, setEffects] = useState(initial?.effects ?? []);
  const [valid, setValid] = useState(true);
  const [capabilities, setCapabilities] = useState(
    (initial?.capabilities ?? []).map((c) => ({ ...c, editorId: crypto.randomUUID() })),
  );
  const [duration, setDuration] = useState(initial?.duration.kind ?? 'indefinite');
  const [amount, setAmount] = useState(
    initial?.duration.kind !== 'indefinite' && initial?.duration.amount
      ? String(initial.duration.amount)
      : '10',
  );
  const [stacking, setStacking] = useState(initial?.stacking.kind ?? 'additive');
  const [stackKey, setStackKey] = useState(initial?.stacking.key ?? '');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save() {
    const parsed = activeEffectDefinitionCreate.safeParse({
      name,
      description: description || null,
      source: source || null,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      effects,
      capabilities: capabilities.map(({ editorId: _, ...c }) => c),
      duration:
        duration === 'indefinite' ? { kind: duration } : { kind: duration, amount: Number(amount) },
      stacking: { kind: stacking, key: stackKey },
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      return;
    }
    setPending(true);
    setError('');
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <fieldset disabled={pending} className="card p-card space-y-3 border border-primary/30">
      <label className="block">
        Effect name
        <input
          aria-label="Effect name"
          className="input input-bordered w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block">
        Description
        <textarea
          className="textarea textarea-bordered w-full"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="block">
        Source
        <input
          className="input input-bordered w-full"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
      </label>
      <label className="block">
        Tags
        <input
          className="input input-bordered w-full"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <label>
          Duration
          <select
            aria-label="Effect duration"
            className="select select-bordered"
            value={duration}
            onChange={(e) => setDuration(e.target.value as typeof duration)}
          >
            {['indefinite', 'rounds', 'minutes', 'hours'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        {duration !== 'indefinite' && (
          <label>
            Amount
            <input
              aria-label="Duration amount"
              type="number"
              min="1"
              className="input input-bordered w-24"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        )}
        <label>
          Stacking
          <select
            aria-label="Stacking policy"
            className="select select-bordered"
            value={stacking}
            onChange={(e) => setStacking(e.target.value as typeof stacking)}
          >
            {['additive', 'highest', 'replace'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Stacking key
          <input
            aria-label="Stacking key"
            className="input input-bordered"
            value={stackKey}
            onChange={(e) => setStackKey(e.target.value)}
          />
        </label>
      </div>
      <p className="text-xs text-dim">
        Effects sharing a key use the chosen policy. Highest keeps the strongest value per target;
        replace keeps the latest application.
      </p>
      <EffectsEditor effects={effects} onChange={setEffects} onValidityChange={setValid} />
      <div className="space-y-2">
        <p>Capabilities, senses and resistances</p>
        {capabilities.map((c, i) => (
          <div key={c.editorId} className="flex flex-wrap gap-2">
            <select
              aria-label={`Capability ${i + 1} kind`}
              className="select select-bordered"
              value={c.kind}
              onChange={(e) =>
                setCapabilities((cs) =>
                  cs.map((v, j) => (j === i ? { ...v, kind: e.target.value as typeof c.kind } : v)),
                )
              }
            >
              {['capability', 'sense', 'resistance'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <input
              aria-label={`Capability ${i + 1} key`}
              placeholder="Stable key"
              className="input input-bordered"
              value={c.key}
              onChange={(e) =>
                setCapabilities((cs) =>
                  cs.map((v, j) => (j === i ? { ...v, key: e.target.value } : v)),
                )
              }
            />
            <input
              aria-label={`Capability ${i + 1} label`}
              placeholder="Label"
              className="input input-bordered"
              value={c.label}
              onChange={(e) =>
                setCapabilities((cs) =>
                  cs.map((v, j) => (j === i ? { ...v, label: e.target.value } : v)),
                )
              }
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setCapabilities((cs) => cs.filter((_, j) => i !== j))}
            >
              Remove capability
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setCapabilities((cs) => [
              ...cs,
              { kind: 'capability', key: '', label: '', editorId: crypto.randomUUID() },
            ])
          }
        >
          Add capability
        </button>
      </div>
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={!valid}
        onClick={() => void save()}
      >
        Save effect
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
    </fieldset>
  );
}
