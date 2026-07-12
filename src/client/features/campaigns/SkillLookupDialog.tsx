/**
 * GM "Skill Lookup" modal — lets the GM search for a skill (or core
 * stat) by name and broadcast it to every character card on the
 * dashboard. Picking an option immediately applies it and closes the
 * dialog; there is no separate confirm step, matching "pick and see
 * it everywhere" from the feature request.
 *
 * Options are the six core stats (quick picks) plus every distinct
 * skill name across the campaign's characters — not the campaign
 * library, since the library may list skills nobody has actually
 * taken and we want every suggestion to resolve on at least one card.
 */

import { useCallback, useMemo, useState } from 'react';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { LibraryAutocomplete } from '../../components/ui/LibraryAutocomplete.tsx';
import { useDialogState } from '../../hooks/useDialogState.ts';
import { STAT_LOOKUP_NAMES } from './skillLookup.ts';

interface Props {
  open: boolean;
  characters: CharacterDetail[];
  onClose: () => void;
  onSelect: (name: string) => void;
}

interface Option {
  name: string;
  isStat: boolean;
}

export function SkillLookupDialog({ open, characters, onClose, onSelect }: Props) {
  const ref = useDialogState(open);
  const [query, setQuery] = useState('');

  const options = useMemo<Option[]>(() => {
    const seen = new Map<string, string>();
    for (const character of characters) {
      for (const skill of character.skills) {
        const key = skill.name.toLowerCase();
        if (!seen.has(key)) seen.set(key, skill.name);
      }
    }
    const skillNames = Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
    return [
      ...STAT_LOOKUP_NAMES.map((name) => ({ name, isStat: true })),
      ...skillNames.map((name) => ({ name, isStat: false })),
    ];
  }, [characters]);

  const fetchOptions = useCallback(
    (q: string) => {
      const term = q.trim().toLowerCase();
      const filtered = term ? options.filter((o) => o.name.toLowerCase().includes(term)) : options;
      return Promise.resolve(filtered.slice(0, 30));
    },
    [options],
  );

  const pick = (option: Option) => {
    onSelect(option.name);
    setQuery('');
    onClose();
  };

  if (!open) return null;

  return (
    <dialog ref={ref} onClose={onClose} className="modal-back" aria-labelledby="skill-lookup-title">
      <div className="card relative w-[24rem] max-w-[calc(100vw-3rem)] p-5 gap-3">
        <header className="flex items-baseline justify-between">
          <div>
            <p className="label-eyebrow">GM tool</p>
            <h2 id="skill-lookup-title" className="font-display text-2xl font-semibold">
              Skill lookup
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <p className="text-xs text-base-content/60">
          Pick a skill or stat to show its value on every character card.
        </p>

        <LibraryAutocomplete<Option>
          value={query}
          onChange={setQuery}
          onPick={pick}
          fetchOptions={fetchOptions}
          getOptionKey={(o) => o.name}
          renderOption={(o) => (
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{o.name}</span>
              {o.isStat && <span className="chip text-[10px]">stat</span>}
            </span>
          )}
          placeholder="Search skills or stats…"
          aria-label="Search skills or stats"
        />

        <div className="flex justify-end pt-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
