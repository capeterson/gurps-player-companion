import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { ConditionChip } from '../../components/ui/ConditionChip.tsx';
import { PoolMeter } from '../../components/ui/PoolMeter.tsx';
import { TempBoostPopover } from '../../components/ui/TempBoostPopover.tsx';
import { WarningBanner } from '../../components/ui/WarningBanner.tsx';
import { getLocalDb } from '../../db/dexie.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../hooks/useDraftField.ts';
import { useFieldFlash } from '../../hooks/useFieldFlash.ts';
import { api } from '../../lib/api.ts';
import { makeFlashKey } from '../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../sync/outbox.ts';
import { CombatModal } from './sections/CombatModal.tsx';
import { InventoryPanel } from './sections/InventoryPanel.tsx';
import { SkillsPanel } from './sections/SkillsPanel.tsx';
import { TraitsPanel } from './sections/TraitsPanel.tsx';
import { hpVarFor } from './sections/hpColor.ts';
import { useCharacterFieldSave } from './sections/useCharacterPatch.ts';
import { useCharacterDetail } from './useCharacterDetail.ts';

type SheetTab = 'Combat' | 'Identity' | 'Traits' | 'Skills' | 'Inventory' | 'Notes';
const SHEET_TABS: readonly SheetTab[] = [
  'Combat',
  'Identity',
  'Traits',
  'Skills',
  'Inventory',
  'Notes',
] as const;

interface CountByTab {
  Skills?: number;
  Inventory?: number;
  Traits?: number;
}

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
  // Use the bundled saver so the input subscribes to the flashBus on
  // its own key.  Without `flashKey` an async server rejection would
  // toast but never visually flash this input.
  const buildSave = useCharacterFieldSave(characterId);
  const fieldSave = buildSave(field, { humanName: label });
  const draft = useDraftField<number>({
    name: label,
    serverValue: value,
    parse: intParser(min, max),
    ...fieldSave,
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

/**
 * Temp-modifier cell. Renders a chip showing the current Δ
 * (or `—` when zero); clicking opens a popover that lets the
 * player dial in the value with a stepper or raw input and
 * commits only on Apply. Replaces the prior raw `<input>` so a
 * keystroke can't accidentally fire a sync mutation while the
 * player is mid-typing a rolled value like "1d3".
 */
function TempCell({
  label,
  field,
  baseValue,
  tempValue,
  characterId,
  canWrite,
}: {
  label: string;
  field: AttrField;
  baseValue: number;
  tempValue: number;
  characterId: string;
  canWrite: boolean;
}) {
  const buildSave = useCharacterFieldSave(characterId);
  const { onSave, flashKey } = buildSave(field, { humanName: `${label} temp` });
  // Subscribe to async outbox rejections on this field's flash key so
  // the chip pulses (AGENTS.md rule 2). Without this the chip would
  // silently snap back to the reverted value when the orchestrator
  // rolls a rejected patch back in Dexie — only the toast would show.
  const flash = useFieldFlash(flashKey);
  const [open, setOpen] = useState(false);
  const display = tempValue === 0 ? '—' : tempValue > 0 ? `+${tempValue}` : String(tempValue);

  if (!canWrite) {
    return (
      <span className="num text-dim" aria-label={`${label} temp`}>
        {display}
      </span>
    );
  }
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${label} temporary modifier`}
        aria-expanded={open}
        className={`${DRAFT_FIELD_CLASS} chip num min-w-[3rem] justify-center ${tempValue !== 0 ? 'on' : ''}`}
        data-flashing={flash['data-flashing']}
        data-flash-parity={flash['data-flash-parity']}
      >
        {display}
      </button>
      {open && (
        <TempBoostPopover
          label={label}
          baseValue={baseValue}
          currentTemp={tempValue}
          onApply={(v) => {
            void onSave(v);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

function IdentityPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  // Bundled saver -- spreading `{ onSave, flashKey }` into useDraftField
  // wires the field to the flashBus so async server rejections trigger
  // the rollback animation on the offending input.
  const buildSave = useCharacterFieldSave(character.id);
  const nameField = useDraftField<string>({
    name: 'name',
    serverValue: character.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    ...buildSave('name', { humanName: 'name' }),
  });
  const playerField = useDraftField<string | null>({
    name: 'player name',
    serverValue: character.playerName ?? '',
    parse: nullableTextParser,
    ...buildSave('playerName', { humanName: 'player name' }),
  });
  const heightField = useDraftField<string | null>({
    name: 'height',
    serverValue: character.height ?? '',
    parse: nullableTextParser,
    ...buildSave('height', { humanName: 'height' }),
  });
  const weightField = useDraftField<string | null>({
    name: 'weight',
    serverValue: character.weight ?? '',
    parse: nullableTextParser,
    ...buildSave('weight', { humanName: 'weight' }),
  });
  const ageField = useDraftField<number | null>({
    name: 'age',
    serverValue: character.age ?? null,
    format: (v) => (v === null ? '' : String(v)),
    parse: nullableIntParser(0, 10000),
    ...buildSave('age', { humanName: 'age' }),
  });
  const tlField = useDraftField<number | null>({
    name: 'tech level',
    serverValue: character.techLevel ?? null,
    format: (v) => (v === null ? '' : String(v)),
    parse: nullableIntParser(0, 12),
    ...buildSave('techLevel', { humanName: 'tech level' }),
  });
  const appearanceField = useDraftField<string | null>({
    name: 'appearance',
    serverValue: character.appearance ?? '',
    parse: nullableTextParser,
    ...buildSave('appearance', { humanName: 'appearance' }),
  });

  return (
    <section className="card p-5 space-y-3">
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
    <section className="card p-5">
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
              <TempCell
                label={r.label}
                field={r.temp}
                baseValue={r.baseValue}
                tempValue={r.tempValue}
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
    <section className="card p-5">
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
              <TempCell
                label={r.label}
                field={r.temp}
                baseValue={r.derived - r.tempValue}
                tempValue={r.tempValue}
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
    <section className="card p-5">
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
    <section className="card p-5">
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
    <section className="card p-5">
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
  // Outbox-routed: changing dismissedWarnings is just a patch on the
  // character's dismissedWarnings array.  The orchestrator pushes it
  // through /sync/operations and the persistent toast covers any
  // server rejection.
  const dismissCode = (code: string, dismissed: boolean) => {
    const current = new Set(character.dismissedWarnings);
    if (dismissed) current.add(code);
    else current.delete(code);
    void enqueueFieldPatch({
      entityClass: 'character',
      entityId: character.id,
      fieldPath: 'dismissedWarnings',
      attemptedValue: [...current],
      humanName: 'dismissed warnings',
      flashKey: makeFlashKey('character', character.id, 'dismissedWarnings'),
    });
  };
  const dismiss = {
    mutate: ({ code, dismissed }: { code: string; dismissed: boolean }) =>
      dismissCode(code, dismissed),
  };

  if (character.warnings.length === 0 && character.dismissedWarnings.length === 0) return null;

  return (
    <section className="space-y-2">
      <ul className="space-y-2">
        {character.warnings.map((w) => (
          <li key={w.code}>
            <WarningBanner
              severity={w.severity === 'warn' ? 'warn' : 'info'}
              title={w.code}
              onDismiss={
                canWrite ? () => dismiss.mutate({ code: w.code, dismissed: true }) : undefined
              }
            >
              {w.message}
            </WarningBanner>
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
  const combat = character.combat;
  const currentHp = combat?.currentHp ?? character.derived.hp;
  const currentFp = combat?.currentFp ?? character.derived.fp;
  const posture = combat?.posture ?? 'standing';
  const maneuver = combat?.maneuver ?? '';

  // Combat is 1:1 keyed by characterId.  If a local row doesn't exist
  // yet (first edit on this device) we materialize a default row in
  // Dexie so the per-field patch has something to update; the
  // orchestrator's whole-body upsert handles the server side.
  const patchCombat = async (field: string, value: unknown) => {
    const db = getLocalDb();
    const existing = await db.characterCombat.get(character.id);
    if (!existing) {
      await db.characterCombat.put({
        id: character.id,
        characterId: character.id,
        currentHp: character.derived.hp,
        currentFp: character.derived.fp,
        conditions: [],
        maneuver: null,
        posture: 'standing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: -1,
      });
    }
    await enqueueFieldPatch({
      entityClass: 'character_combat',
      entityId: character.id,
      fieldPath: field,
      attemptedValue: value,
      humanName: field,
      flashKey: makeFlashKey('character_combat', character.id, field),
      characterId: character.id,
    });
  };

  const hpField = useDraftField<number>({
    name: 'current HP',
    serverValue: currentHp,
    parse: intParser(-1000, 1000),
    onSave: (v) => patchCombat('currentHp', v),
    flashKey: makeFlashKey('character_combat', character.id, 'currentHp'),
  });
  const fpField = useDraftField<number>({
    name: 'current FP',
    serverValue: currentFp,
    parse: intParser(-1000, 1000),
    onSave: (v) => patchCombat('currentFp', v),
    flashKey: makeFlashKey('character_combat', character.id, 'currentFp'),
  });
  const maneuverField = useDraftField<string | null>({
    name: 'maneuver',
    serverValue: maneuver,
    parse: nullableTextParser,
    onSave: (v) => patchCombat('maneuver', v),
    flashKey: makeFlashKey('character_combat', character.id, 'maneuver'),
  });

  const setPosture = {
    isPending: false,
    mutate: (p: (typeof POSTURES)[number]) => {
      void patchCombat('posture', p);
    },
  };

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
    <section className="card p-5 space-y-3">
      <p className="label-eyebrow">Combat</p>
      <h2 className="font-display text-2xl">Current state</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
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
          <PoolMeter
            current={currentHp}
            max={character.derived.hp}
            tone="hp"
            ariaLabel="Hit points"
          />
        </div>
        <div className="space-y-1.5">
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
          <PoolMeter
            current={currentFp}
            max={character.derived.fp}
            tone="fp"
            ariaLabel="Fatigue points"
          />
        </div>
      </div>
      <div>
        <p className="label-eyebrow">Posture</p>
        <div className="flex flex-wrap gap-1">
          {POSTURES.map((p) => (
            <ConditionChip
              key={p}
              label={p}
              active={posture === p}
              onClick={() => canWrite && setPosture.mutate(p)}
              disabled={!canWrite || setPosture.isPending}
              className="capitalize"
            />
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

/**
 * Identity hero — the design's full-width header on the sheet view:
 * eyebrow kicker → big display-font name (drop-cap fires automatically)
 * → a horizontal row of read-only Race/TL/Age/Height/Weight pairs →
 * Points / Unspent badges on the right.
 *
 * The detail editors for each of those fields live in the "Identity"
 * tab below; this hero is presentational + holds the inline name editor.
 */
function IdentityHero({
  character,
  pointTarget,
  canWrite,
}: {
  character: CharacterDetail;
  pointTarget: number | null;
  canWrite: boolean;
}) {
  const buildSave = useCharacterFieldSave(character.id);
  const nameField = useDraftField<string>({
    name: 'name',
    serverValue: character.name,
    parse: (s) => s.trim(),
    validate: (v) => (v.length > 0 ? null : 'name cannot be empty'),
    ...buildSave('name', { humanName: 'name' }),
  });

  const chips: Array<[string, string]> = [
    ['Player', character.playerName ?? '—'],
    ['TL', character.techLevel != null ? String(character.techLevel) : '—'],
    ['Age', character.age != null ? String(character.age) : '—'],
    ['Height', character.height ?? '—'],
    ['Weight', character.weight ?? '—'],
  ];

  const total = character.points.total;
  const remaining = pointTarget != null ? pointTarget - total : null;

  return (
    <div className="grid items-end gap-6 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <p className="label-eyebrow">Player Character · 4e</p>
        {canWrite ? (
          <input
            aria-label="character name"
            className={`${DRAFT_FIELD_CLASS} font-name w-full bg-transparent border-0 outline-0 px-0 text-5xl leading-tight focus:ring-2 focus:ring-primary/40 rounded`}
            {...nameField.inputProps}
          />
        ) : (
          <h1 className="font-name text-5xl leading-tight">{character.name}</h1>
        )}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
          {chips.map(([k, v]) => (
            <span key={k}>
              <span className="label-eyebrow mr-1.5 inline">{k}</span>
              <span>{v}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex gap-2.5">
        <div className="card min-w-[6rem] px-4 py-2.5 text-center">
          <p className="label-eyebrow">Points</p>
          <p className="num mt-0.5 text-2xl font-semibold">
            {total}
            {pointTarget != null && <span className="text-sm text-dim"> / {pointTarget}</span>}
          </p>
        </div>
        {remaining != null && (
          <div className="card min-w-[6rem] px-4 py-2.5 text-center">
            <p className="label-eyebrow">{remaining < 0 ? 'Over' : 'Unspent'}</p>
            <p
              className="num mt-0.5 text-2xl font-semibold"
              style={{
                color: remaining < 0 ? 'var(--color-error)' : 'var(--color-primary)',
              }}
            >
              {remaining}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface CampaignSummary {
  id: string;
  name: string;
  pointTarget: number | null;
}

export function CharacterSheetPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [tab, setTab] = useState<SheetTab>('Combat');
  const [combatOpen, setCombatOpen] = useState(false);

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api<MeResponse>('/auth/me'),
  });

  // Local-first: read from Dexie via useLiveQuery.  The orchestrator
  // pulls /sync/cursor in the background to keep this fresh; we never
  // hit /characters/{id} directly anymore.
  const character = useCharacterDetail(id);

  // Fetch the character's campaign (if any) so the hero can show
  // a `Points / Target` ratio. Campaigns are cheap to read from Dexie;
  // missing target just collapses the second card.
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignSummary[]>('/campaigns'),
    enabled: !!character?.campaignId,
  });

  if (character === undefined) {
    return <p className="text-muted">Loading…</p>;
  }
  if (character === null) {
    return (
      <div className="space-y-3">
        <p className="text-error">Couldn't load character — not found locally.</p>
        <Link to="/characters" className="btn btn-sm btn-ghost">
          ← Back to characters
        </Link>
      </div>
    );
  }
  const canWrite = me.data ? me.data.id === character.ownerId : false;

  const campaign = campaigns.data?.find((c) => c.id === character.campaignId);
  const pointTarget = campaign?.pointTarget ?? null;

  const counts: CountByTab = {
    Traits: character.traits.length,
    Skills: character.skills.length,
    Inventory: character.inventory.length,
  };

  const hpRatio =
    character.derived.hp > 0
      ? (character.combat?.currentHp ?? character.derived.hp) / character.derived.hp
      : 0;
  const fabHpColor = hpVarFor(hpRatio);

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm">
        <Link to="/characters" className="link link-hover text-muted">
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
      </nav>

      <IdentityHero character={character} pointTarget={pointTarget} canWrite={canWrite} />

      <WarningsPanel character={character} canWrite={canWrite} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AttributesPanel character={character} canWrite={canWrite} />
        <SecondaryModsPanel character={character} canWrite={canWrite} />
        <DerivedPanel character={character} />
        <div className="grid grid-cols-1 gap-4">
          <PointsPanel character={character} />
          <EncumbrancePanel character={character} />
        </div>
      </div>

      <div className="panel-tabs">
        {SHEET_TABS.map((t) => {
          const count = counts[t as keyof CountByTab];
          return (
            <button
              key={t}
              type="button"
              className={`panel-tab ${tab === t ? 'active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
              {count !== undefined && <span className="num text-dim text-[11px]">{count}</span>}
            </button>
          );
        })}
      </div>

      <div>
        {tab === 'Combat' && <CombatPanel character={character} canWrite={canWrite} />}
        {tab === 'Identity' && <IdentityPanel character={character} canWrite={canWrite} />}
        {tab === 'Traits' && <TraitsPanel character={character} canWrite={canWrite} />}
        {tab === 'Skills' && <SkillsPanel character={character} canWrite={canWrite} />}
        {tab === 'Inventory' && <InventoryPanel character={character} canWrite={canWrite} />}
        {tab === 'Notes' && <NotesPanel character={character} canWrite={canWrite} />}
      </div>

      <button
        type="button"
        className="combat-fab"
        onClick={() => setCombatOpen(true)}
        aria-label="Open combat tracker"
      >
        <span aria-hidden="true">⚔</span>
        <span>Combat</span>
        <span aria-hidden="true" className="text-primary-content/60">
          ·
        </span>
        <span className="num" style={{ color: fabHpColor }}>
          {character.combat?.currentHp ?? character.derived.hp}
        </span>
        <span className="num text-primary-content/60">/ {character.derived.hp}</span>
      </button>

      {combatOpen && (
        <CombatModal
          character={character}
          canWrite={canWrite}
          onClose={() => setCombatOpen(false)}
        />
      )}
    </div>
  );
}

/** Notes tab — for now a thin shim around the existing `appearance`
 * field on the character. The design's prototype shows a free-form
 * textarea under a Notes tab; rather than introduce a new column we
 * surface the existing field here. */
function NotesPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const buildSave = useCharacterFieldSave(character.id);
  const notesField = useDraftField<string | null>({
    name: 'notes',
    serverValue: character.appearance ?? '',
    parse: nullableTextParser,
    ...buildSave('appearance', { humanName: 'notes' }),
  });
  return (
    <section className="card p-card">
      <p className="label-eyebrow mb-2">Notes</p>
      {canWrite ? (
        <textarea
          aria-label="notes"
          rows={10}
          className={`${DRAFT_FIELD_CLASS} w-full resize-y bg-transparent text-base leading-relaxed focus:outline-none`}
          value={notesField.value}
          onChange={(e) => notesField.setValue(e.target.value)}
          onBlur={notesField.inputProps.onBlur}
          data-flashing={notesField.inputProps['data-flashing']}
          data-flash-parity={notesField.inputProps['data-flash-parity']}
          placeholder="Session notes, NPC names, things to remember…"
        />
      ) : (
        <p className="whitespace-pre-line text-base leading-relaxed">
          {character.appearance ?? '—'}
        </p>
      )}
    </section>
  );
}
