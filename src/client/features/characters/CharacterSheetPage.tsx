import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import type { CombatStateOut } from '../../../shared/schemas/combat.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../hooks/useDraftField.ts';
import { ApiError, api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { InventoryPanel } from './sections/InventoryPanel.tsx';
import { SkillsPanel } from './sections/SkillsPanel.tsx';
import { TraitsPanel } from './sections/TraitsPanel.tsx';
import {
  applyDetailToCache,
  characterDetailKey,
  useFieldSaver,
} from './sections/useCharacterPatch.ts';

const POSTURES = [
  'standing',
  'prone',
  'kneeling',
  'crawling',
  'sitting',
  'crouching',
  'lying',
] as const;

interface MeResponse {
  id: string;
  email: string;
  displayName: string;
}

function intParser(min: number, max: number) {
  return (s: string): number => {
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('integer only');
    if (n < min || n > max) throw new Error(`must be between ${min} and ${max}`);
    return n;
  };
}

function nullableTextParser(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function nullableIntParser(min: number, max: number) {
  return (s: string): number | null => {
    const t = s.trim();
    if (t.length === 0) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('integer only');
    if (n < min || n > max) throw new Error(`must be between ${min} and ${max}`);
    return n;
  };
}

type AttrField =
  | 'st'
  | 'dx'
  | 'iq'
  | 'ht'
  | 'tempSt'
  | 'tempDx'
  | 'tempIq'
  | 'tempHt'
  | 'hpMod'
  | 'willMod'
  | 'perMod'
  | 'fpMod'
  | 'speedQuarterMod'
  | 'moveMod'
  | 'tempHpMod'
  | 'tempWillMod'
  | 'tempPerMod'
  | 'tempFpMod'
  | 'tempSpeedQuarterMod'
  | 'tempMoveMod';

interface AttrInputProps {
  label: string;
  field: AttrField;
  value: number;
  characterId: string;
  canWrite: boolean;
  min: number;
  max: number;
  width: string;
}

function AttrInput({
  label,
  field,
  value,
  characterId,
  canWrite,
  min,
  max,
  width,
}: AttrInputProps) {
  const saver = useFieldSaver(characterId);
  const draft = useDraftField<number>({
    name: label,
    serverValue: value,
    parse: intParser(min, max),
    onSave: saver(field),
  });
  if (!canWrite) {
    return (
      <span className="num font-medium" aria-label={label}>
        {value}
      </span>
    );
  }
  return (
    <input
      aria-label={label}
      className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right ${width}`}
      {...draft.inputProps}
    />
  );
}

function AttrCell(props: {
  label: string;
  field: AttrField;
  value: number;
  characterId: string;
  canWrite: boolean;
  min?: number;
  max?: number;
  width?: string;
}) {
  return (
    <AttrInput
      label={props.label}
      field={props.field}
      value={props.value}
      characterId={props.characterId}
      canWrite={props.canWrite}
      min={props.min ?? -50}
      max={props.max ?? 99}
      width={props.width ?? 'w-16'}
    />
  );
}

function IdentityPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const saver = useFieldSaver(character.id);
  const nameField = useDraftField<string>({
    name: 'name',
    serverValue: character.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    onSave: saver('name'),
  });
  const playerField = useDraftField<string | null>({
    name: 'player name',
    serverValue: character.playerName ?? '',
    parse: nullableTextParser,
    onSave: saver('playerName'),
  });
  const heightField = useDraftField<string | null>({
    name: 'height',
    serverValue: character.height ?? '',
    parse: nullableTextParser,
    onSave: saver('height'),
  });
  const weightField = useDraftField<string | null>({
    name: 'weight',
    serverValue: character.weight ?? '',
    parse: nullableTextParser,
    onSave: saver('weight'),
  });
  const ageField = useDraftField<number | null>({
    name: 'age',
    serverValue: character.age ?? null,
    format: (v) => (v === null ? '' : String(v)),
    parse: nullableIntParser(0, 10000),
    onSave: saver('age'),
  });
  const tlField = useDraftField<number | null>({
    name: 'tech level',
    serverValue: character.techLevel ?? null,
    format: (v) => (v === null ? '' : String(v)),
    parse: nullableIntParser(0, 12),
    onSave: saver('techLevel'),
  });
  const appearanceField = useDraftField<string | null>({
    name: 'appearance',
    serverValue: character.appearance ?? '',
    parse: nullableTextParser,
    onSave: saver('appearance'),
  });

  return (
    <section className="card bg-base-200 border border-base-300 p-5 space-y-3">
      <p className="label-eyebrow">Identity</p>
      {canWrite ? (
        <input
          aria-label="character name"
          className={`${DRAFT_FIELD_CLASS} font-name text-4xl bg-transparent border-0 outline-0 w-full focus:ring-2 focus:ring-primary/40 rounded px-1`}
          {...nameField.inputProps}
        />
      ) : (
        <h1 className="font-name text-4xl">{character.name}</h1>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="form-control">
          <span className="label-text-alt label-eyebrow">Player</span>
          {canWrite ? (
            <input
              aria-label="player name"
              className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm`}
              {...playerField.inputProps}
            />
          ) : (
            <span>{character.playerName ?? '—'}</span>
          )}
        </div>
        <div className="form-control">
          <span className="label-text-alt label-eyebrow">Tech level</span>
          {canWrite ? (
            <input
              aria-label="tech level"
              className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num`}
              {...tlField.inputProps}
            />
          ) : (
            <span>TL {character.techLevel ?? '—'}</span>
          )}
        </div>
        <div className="form-control">
          <span className="label-text-alt label-eyebrow">Age</span>
          {canWrite ? (
            <input
              aria-label="age"
              className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num`}
              {...ageField.inputProps}
            />
          ) : (
            <span>{character.age ?? '—'}</span>
          )}
        </div>
        <div className="form-control">
          <span className="label-text-alt label-eyebrow">Height</span>
          {canWrite ? (
            <input
              aria-label="height"
              className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm`}
              {...heightField.inputProps}
            />
          ) : (
            <span>{character.height ?? '—'}</span>
          )}
        </div>
        <div className="form-control">
          <span className="label-text-alt label-eyebrow">Weight</span>
          {canWrite ? (
            <input
              aria-label="weight"
              className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm`}
              {...weightField.inputProps}
            />
          ) : (
            <span>{character.weight ?? '—'}</span>
          )}
        </div>
      </div>
      <div className="form-control">
        <span className="label-text-alt label-eyebrow">Appearance / notes</span>
        {canWrite ? (
          <textarea
            aria-label="appearance"
            rows={2}
            className={`${DRAFT_FIELD_CLASS} textarea textarea-bordered textarea-sm`}
            value={appearanceField.value}
            onChange={(e) => appearanceField.setValue(e.target.value)}
            onBlur={appearanceField.inputProps.onBlur}
            data-flashing={appearanceField.inputProps['data-flashing']}
            data-flash-parity={appearanceField.inputProps['data-flash-parity']}
          />
        ) : (
          <p className="text-sm whitespace-pre-line">{character.appearance ?? '—'}</p>
        )}
      </div>
    </section>
  );
}

function AttributesPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const rows: Array<{
    label: string;
    base: AttrInputProps['field'];
    baseValue: number;
    temp: AttrInputProps['field'];
    tempValue: number;
    effective: number;
    min?: number;
    max?: number;
  }> = [
    {
      label: 'ST',
      base: 'st',
      baseValue: character.st,
      temp: 'tempSt',
      tempValue: character.tempSt,
      effective: character.derived.effectiveSt,
      min: 1,
    },
    {
      label: 'DX',
      base: 'dx',
      baseValue: character.dx,
      temp: 'tempDx',
      tempValue: character.tempDx,
      effective: character.derived.effectiveDx,
      min: 1,
    },
    {
      label: 'IQ',
      base: 'iq',
      baseValue: character.iq,
      temp: 'tempIq',
      tempValue: character.tempIq,
      effective: character.derived.effectiveIq,
      min: 1,
    },
    {
      label: 'HT',
      base: 'ht',
      baseValue: character.ht,
      temp: 'tempHt',
      tempValue: character.tempHt,
      effective: character.derived.effectiveHt,
      min: 1,
    },
  ];

  return (
    <section className="card bg-base-200 border border-base-300 p-5">
      <p className="label-eyebrow">Attributes</p>
      <h2 className="font-display text-2xl mb-3">Primary</h2>
      <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-3 gap-y-2 items-center">
        <span className="label-eyebrow" />
        <span className="label-eyebrow text-center">Base</span>
        <span className="label-eyebrow text-center">Temp</span>
        <span className="label-eyebrow text-center">Effective</span>
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <span className="label-eyebrow text-base font-display tracking-wider">{r.label}</span>
            <div className="text-center">
              <AttrCell
                label={`${r.label} base`}
                field={r.base}
                value={r.baseValue}
                characterId={character.id}
                canWrite={canWrite}
                {...(r.min !== undefined ? { min: r.min } : {})}
                {...(r.max !== undefined ? { max: r.max } : {})}
              />
            </div>
            <div className="text-center">
              <AttrCell
                label={`${r.label} temp`}
                field={r.temp}
                value={r.tempValue}
                characterId={character.id}
                canWrite={canWrite}
              />
            </div>
            <div className="text-center num font-medium text-lg">{r.effective}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SecondaryModsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const rows: Array<{
    label: string;
    mod: AttrInputProps['field'];
    modValue: number;
    temp: AttrInputProps['field'];
    tempValue: number;
    derived: number;
    derivedDisplay?: string;
  }> = [
    {
      label: 'HP',
      mod: 'hpMod',
      modValue: character.hpMod,
      temp: 'tempHpMod',
      tempValue: character.tempHpMod,
      derived: character.derived.hp,
    },
    {
      label: 'Will',
      mod: 'willMod',
      modValue: character.willMod,
      temp: 'tempWillMod',
      tempValue: character.tempWillMod,
      derived: character.derived.will,
    },
    {
      label: 'Per',
      mod: 'perMod',
      modValue: character.perMod,
      temp: 'tempPerMod',
      tempValue: character.tempPerMod,
      derived: character.derived.per,
    },
    {
      label: 'FP',
      mod: 'fpMod',
      modValue: character.fpMod,
      temp: 'tempFpMod',
      tempValue: character.tempFpMod,
      derived: character.derived.fp,
    },
    {
      label: 'Speed (¼)',
      mod: 'speedQuarterMod',
      modValue: character.speedQuarterMod,
      temp: 'tempSpeedQuarterMod',
      tempValue: character.tempSpeedQuarterMod,
      derived: character.derived.basicSpeedQuarters,
      derivedDisplay: `${character.derived.basicSpeed.toFixed(2)} (×4)`,
    },
    {
      label: 'Move',
      mod: 'moveMod',
      modValue: character.moveMod,
      temp: 'tempMoveMod',
      tempValue: character.tempMoveMod,
      derived: character.derived.basicMove,
    },
  ];

  return (
    <section className="card bg-base-200 border border-base-300 p-5">
      <p className="label-eyebrow">Secondary attributes</p>
      <h2 className="font-display text-2xl mb-3">Modifiers</h2>
      <div className="grid grid-cols-[auto_1fr_1fr_1.4fr] gap-x-3 gap-y-2 items-center">
        <span className="label-eyebrow" />
        <span className="label-eyebrow text-center">Mod</span>
        <span className="label-eyebrow text-center">Temp</span>
        <span className="label-eyebrow text-center">Derived</span>
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <span className="label-eyebrow text-sm font-display tracking-wider">{r.label}</span>
            <div className="text-center">
              <AttrCell
                label={`${r.label} mod`}
                field={r.mod}
                value={r.modValue}
                characterId={character.id}
                canWrite={canWrite}
              />
            </div>
            <div className="text-center">
              <AttrCell
                label={`${r.label} temp`}
                field={r.temp}
                value={r.tempValue}
                characterId={character.id}
                canWrite={canWrite}
              />
            </div>
            <div className="text-center num font-medium">{r.derivedDisplay ?? r.derived}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DerivedPanel({ character }: { character: CharacterDetail }) {
  const cells: Array<{ label: string; value: string | number }> = [
    { label: 'HP', value: character.derived.hp },
    { label: 'Will', value: character.derived.will },
    { label: 'Per', value: character.derived.per },
    { label: 'FP', value: character.derived.fp },
    { label: 'Basic Speed', value: character.derived.basicSpeed.toFixed(2) },
    { label: 'Basic Move', value: character.derived.basicMove },
    { label: 'Dodge', value: character.derived.dodge },
    { label: 'Basic Lift', value: character.derived.basicLift.toFixed(1) },
  ];
  return (
    <section className="card bg-base-200 border border-base-300 p-5">
      <p className="label-eyebrow">Derived</p>
      <h2 className="font-display text-2xl mb-3">Computed values</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="bg-base-100/40 border border-base-300 rounded p-2">
            <p className="label-eyebrow">{c.label}</p>
            <p className="num font-display text-2xl">{c.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PointsPanel({ character }: { character: CharacterDetail }) {
  const p = character.points;
  return (
    <section className="card bg-base-200 border border-base-300 p-5">
      <p className="label-eyebrow">Point ledger</p>
      <h2 className="font-display text-2xl mb-3">Spend</h2>
      <ul className="text-sm space-y-1">
        <li className="flex justify-between">
          <span>Attributes</span>
          <span className="num">{p.attributes}</span>
        </li>
        <li className="flex justify-between">
          <span>Secondary</span>
          <span className="num">{p.secondary}</span>
        </li>
        <li className="flex justify-between">
          <span>Advantages</span>
          <span className="num">{p.advantages}</span>
        </li>
        <li className="flex justify-between">
          <span>Disadvantages</span>
          <span className="num">{p.disadvantages}</span>
        </li>
        <li className="flex justify-between">
          <span>Quirks</span>
          <span className="num">{p.quirks}</span>
        </li>
        <li className="flex justify-between">
          <span>Skills</span>
          <span className="num">{p.skills}</span>
        </li>
        <li className="flex justify-between border-t border-base-300 pt-1 mt-1 font-medium">
          <span>Total</span>
          <span className="num">{p.total}</span>
        </li>
      </ul>
    </section>
  );
}

function EncumbrancePanel({ character }: { character: CharacterDetail }) {
  const e = character.encumbrance;
  return (
    <section className="card bg-base-200 border border-base-300 p-5">
      <p className="label-eyebrow">Encumbrance</p>
      <h2 className="font-display text-2xl mb-3">{e.label}</h2>
      <ul className="text-sm space-y-1">
        <li className="flex justify-between">
          <span>Worn weight</span>
          <span className="num">{e.playerWeightLbs.toFixed(1)} lb</span>
        </li>
        <li className="flex justify-between">
          <span>Basic Lift</span>
          <span className="num">{e.basicLift.toFixed(1)} lb</span>
        </li>
        <li className="flex justify-between">
          <span>Ratio</span>
          <span className="num">{Number.isFinite(e.ratio) ? e.ratio.toFixed(2) : '∞'}</span>
        </li>
        <li className="flex justify-between">
          <span>Speed ÷</span>
          <span className="num">{e.speedDivisor}</span>
        </li>
        <li className="flex justify-between">
          <span>Dodge penalty</span>
          <span className="num">{e.dodgePenalty}</span>
        </li>
      </ul>
    </section>
  );
}

function WarningsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const toasts = useToasts();
  const dismiss = useMutation({
    mutationFn: ({ code, dismissed }: { code: string; dismissed: boolean }) =>
      api<CharacterDetail>(`/characters/${character.id}/warnings/dismiss`, {
        method: 'POST',
        body: { code, dismissed },
      }),
    onSuccess: (detail) => applyDetailToCache(qc, character.id, detail),
    onError: (err) => {
      toasts.push(`Couldn't update warning — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  if (character.warnings.length === 0 && character.dismissedWarnings.length === 0) return null;

  return (
    <section className="card bg-base-200 border border-base-300 p-5 space-y-2">
      <p className="label-eyebrow">Warnings</p>
      {character.warnings.length === 0 && (
        <p className="text-sm text-base-content/60">No active warnings.</p>
      )}
      <ul className="space-y-1">
        {character.warnings.map((w) => (
          <li
            key={w.code}
            className={`flex items-start justify-between gap-3 p-2 rounded border ${
              w.severity === 'warn'
                ? 'border-warning/40 bg-warning/10'
                : 'border-info/40 bg-info/10'
            }`}
          >
            <div className="text-sm">
              <p className="label-eyebrow">{w.severity}</p>
              <p>{w.message}</p>
            </div>
            {canWrite && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => dismiss.mutate({ code: w.code, dismissed: true })}
              >
                Dismiss
              </button>
            )}
          </li>
        ))}
      </ul>
      {character.dismissedWarnings.length > 0 && canWrite && (
        <details className="text-xs">
          <summary className="cursor-pointer text-base-content/60">
            {character.dismissedWarnings.length} dismissed
          </summary>
          <ul className="mt-1 space-y-1">
            {character.dismissedWarnings.map((code) => (
              <li key={code} className="flex justify-between gap-3">
                <span className="text-base-content/60">{code}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => dismiss.mutate({ code, dismissed: false })}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function CombatPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const toasts = useToasts();
  const combat = character.combat;
  const currentHp = combat?.currentHp ?? character.derived.hp;
  const currentFp = combat?.currentFp ?? character.derived.fp;
  const posture = combat?.posture ?? 'standing';
  const maneuver = combat?.maneuver ?? '';

  const patchCombat = async (body: Record<string, unknown>) => {
    const res = await api<{ combat: CombatStateOut; character: CharacterDetail }>(
      `/characters/${character.id}/combat`,
      { method: 'PATCH', body },
    );
    applyDetailToCache(qc, character.id, res.character);
  };

  const hpField = useDraftField<number>({
    name: 'current HP',
    serverValue: currentHp,
    parse: intParser(-1000, 1000),
    onSave: (v) => patchCombat({ currentHp: v }),
  });
  const fpField = useDraftField<number>({
    name: 'current FP',
    serverValue: currentFp,
    parse: intParser(-1000, 1000),
    onSave: (v) => patchCombat({ currentFp: v }),
  });
  const maneuverField = useDraftField<string | null>({
    name: 'maneuver',
    serverValue: maneuver,
    parse: nullableTextParser,
    onSave: (v) => patchCombat({ maneuver: v }),
  });

  const setPosture = useMutation({
    mutationFn: (p: (typeof POSTURES)[number]) => patchCombat({ posture: p }),
    onError: (err) => {
      toasts.push(`Couldn't change posture — ${(err as Error).message}`, { kind: 'error' });
    },
  });

  const hpRatio = character.derived.hp > 0 ? currentHp / character.derived.hp : 0;
  const fpRatio = character.derived.fp > 0 ? currentFp / character.derived.fp : 0;
  const hpColor =
    hpRatio >= 1
      ? 'text-hp-full'
      : hpRatio >= 0.67
        ? 'text-hp-good'
        : hpRatio >= 0.34
          ? 'text-hp-warn'
          : hpRatio > 0
            ? 'text-hp-low'
            : 'text-hp-crit';
  const fpColor =
    fpRatio >= 1
      ? 'text-hp-full'
      : fpRatio >= 0.67
        ? 'text-hp-good'
        : fpRatio >= 0.34
          ? 'text-hp-warn'
          : 'text-hp-low';

  return (
    <section className="card bg-base-200 border border-base-300 p-5 space-y-3">
      <p className="label-eyebrow">Combat</p>
      <h2 className="font-display text-2xl">Current state</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="label-eyebrow">HP</p>
          <div className="flex items-baseline gap-1">
            {canWrite ? (
              <input
                aria-label="current HP"
                className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right w-20 ${hpColor} font-display text-2xl`}
                {...hpField.inputProps}
              />
            ) : (
              <span className={`num font-display text-2xl ${hpColor}`}>{currentHp}</span>
            )}
            <span className="text-base-content/60 num">/ {character.derived.hp}</span>
          </div>
        </div>
        <div>
          <p className="label-eyebrow">FP</p>
          <div className="flex items-baseline gap-1">
            {canWrite ? (
              <input
                aria-label="current FP"
                className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm num text-right w-20 ${fpColor} font-display text-2xl`}
                {...fpField.inputProps}
              />
            ) : (
              <span className={`num font-display text-2xl ${fpColor}`}>{currentFp}</span>
            )}
            <span className="text-base-content/60 num">/ {character.derived.fp}</span>
          </div>
        </div>
      </div>
      <div>
        <p className="label-eyebrow">Posture</p>
        <div className="flex flex-wrap gap-1">
          {POSTURES.map((p) => (
            <button
              key={p}
              type="button"
              className={`btn btn-xs ${posture === p ? 'btn-primary' : 'btn-ghost'} capitalize`}
              onClick={() => canWrite && setPosture.mutate(p)}
              disabled={!canWrite || setPosture.isPending}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="form-control">
        <span className="label-text-alt label-eyebrow">Active maneuver</span>
        {canWrite ? (
          <input
            aria-label="maneuver"
            className={`${DRAFT_FIELD_CLASS} input input-bordered input-sm`}
            placeholder="e.g. Attack, All-Out Defense…"
            {...maneuverField.inputProps}
          />
        ) : (
          <span>{maneuver || '—'}</span>
        )}
      </div>
    </section>
  );
}

export function CharacterSheetPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  const characterQuery = useQuery({
    queryKey: characterDetailKey(id),
    queryFn: () => api<CharacterDetail>(`/characters/${id}`),
    enabled: id.length > 0,
  });

  if (characterQuery.isLoading) {
    return <p className="text-base-content/60">Loading…</p>;
  }
  if (characterQuery.error) {
    const err = characterQuery.error as ApiError | Error;
    const status = err instanceof ApiError ? err.status : 0;
    return (
      <div className="space-y-3">
        <p className="text-error">
          Couldn't load character — {err.message}
          {status === 404 && ' (not found)'}
          {status === 403 && ' (forbidden)'}
        </p>
        <Link to="/characters" className="btn btn-sm btn-ghost">
          ← Back to characters
        </Link>
      </div>
    );
  }
  const character = characterQuery.data;
  if (!character) return null;
  const canWrite = me.data ? me.data.id === character.ownerId : false;

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/characters" className="link link-hover text-base-content/60">
          ← All characters
        </Link>
        {!canWrite && (
          <span
            className="badge badge-ghost badge-sm"
            title="You can view this sheet but not edit it"
          >
            read-only
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-xs ml-auto"
          onClick={() => qc.invalidateQueries({ queryKey: characterDetailKey(id) })}
        >
          Refresh
        </button>
      </nav>

      <IdentityPanel character={character} canWrite={canWrite} />

      <div className="grid lg:grid-cols-2 gap-4">
        <AttributesPanel character={character} canWrite={canWrite} />
        <SecondaryModsPanel character={character} canWrite={canWrite} />
      </div>

      <DerivedPanel character={character} />

      <div className="grid lg:grid-cols-3 gap-4">
        <PointsPanel character={character} />
        <EncumbrancePanel character={character} />
        <CombatPanel character={character} canWrite={canWrite} />
      </div>

      <WarningsPanel character={character} canWrite={canWrite} />

      <TraitsPanel character={character} canWrite={canWrite} />
      <SkillsPanel character={character} canWrite={canWrite} />
      <InventoryPanel character={character} canWrite={canWrite} />
    </div>
  );
}
