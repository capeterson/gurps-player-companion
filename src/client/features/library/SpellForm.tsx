import { useState } from 'react';
import { SPELL_DIFFICULTIES } from '../../../shared/constants/skills.ts';
import type {
  LibrarySpellCreate,
  LibrarySpellOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { RichTextEditor } from '../../components/markdown/RichTextEditor.tsx';

interface SpellFormProps {
  initial?: LibrarySpellOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibrarySpellCreate) => void;
  onCancel: () => void;
}

export function SpellForm({ initial, isPending, error, onSubmit, onCancel }: SpellFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [college, setCollege] = useState(initial?.college ?? '');
  const [difficulty, setDifficulty] = useState<(typeof SPELL_DIFFICULTIES)[number]>(
    initial?.difficulty ?? 'H',
  );
  const [baseEnergyCost, setBaseEnergyCost] = useState(String(initial?.baseEnergyCost ?? 1));
  const [maintenanceCost, setMaintenanceCost] = useState(
    initial?.maintenanceCost != null ? String(initial.maintenanceCost) : '',
  );
  const [castingTime, setCastingTime] = useState(initial?.castingTime ?? '');
  const [duration, setDuration] = useState(initial?.duration ?? '');
  const [prerequisites, setPrerequisites] = useState(initial?.prerequisites ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [source, setSource] = useState(initial?.source ?? '');

  function handleSubmit() {
    if (!name.trim()) return;
    const cost = Number.parseInt(baseEnergyCost, 10);
    const upkeep = maintenanceCost.trim() !== '' ? Number.parseInt(maintenanceCost, 10) : null;
    onSubmit({
      name: name.trim(),
      college: college.trim() || null,
      difficulty,
      baseEnergyCost: Number.isNaN(cost) ? 1 : cost,
      maintenanceCost: upkeep != null && Number.isNaN(upkeep) ? null : upkeep,
      castingTime: castingTime.trim() || null,
      duration: duration.trim() || null,
      prerequisites: prerequisites.trim() || null,
      description: description.trim() || null,
      source: source.trim() || null,
    });
  }

  return (
    <div className="card p-card space-y-3 border border-primary/30">
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-full sm:min-w-[12rem] sm:flex-1">
          <span className="label-text">Name *</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">College</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={college}
            onChange={(e) => setCollege(e.target.value)}
            maxLength={80}
            placeholder="Fire"
          />
        </label>
        <label className="form-control">
          <span className="label-text">Difficulty</span>
          <select
            className="select select-bordered select-sm"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
          >
            {SPELL_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="form-control w-20">
          <span className="label-text">Cost</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={baseEnergyCost}
            onChange={(e) => setBaseEnergyCost(e.target.value)}
            min={0}
            max={99}
          />
        </label>
        <label className="form-control w-20">
          <span className="label-text">Upkeep</span>
          <input
            type="number"
            className="input input-bordered input-sm"
            value={maintenanceCost}
            onChange={(e) => setMaintenanceCost(e.target.value)}
            min={0}
            max={99}
            placeholder="—"
          />
        </label>
        <label className="form-control w-28">
          <span className="label-text">Source</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={40}
            placeholder="M-110"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="form-control w-40">
          <span className="label-text">Casting time</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={castingTime}
            onChange={(e) => setCastingTime(e.target.value)}
            maxLength={40}
            placeholder="1 second"
          />
        </label>
        <label className="form-control w-40">
          <span className="label-text">Duration</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            maxLength={40}
            placeholder="1 minute"
          />
        </label>
        <label className="form-control min-w-[12rem] flex-1">
          <span className="label-text">Prerequisites</span>
          <input
            type="text"
            className="input input-bordered input-sm"
            value={prerequisites}
            onChange={(e) => setPrerequisites(e.target.value)}
            placeholder="Magery 1, Ignite Fire"
          />
        </label>
      </div>
      <div className="form-control" inert={isPending}>
        <span className="label-text">Description</span>
        <RichTextEditor
          aria-label="Description"
          value={description}
          onChange={setDescription}
          placeholder="Description (Markdown supported)…"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSubmit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Add spell'}
        </button>
      </div>
      {error && <p className="alert alert-error text-sm">{error}</p>}
    </div>
  );
}

// ── Item form ───────────────────────────────────────────────────────────────
