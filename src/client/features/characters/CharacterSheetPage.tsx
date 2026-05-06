import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ATTR_INFLUENCE,
  SECONDARY_INFO,
  type SecondaryModKey,
  attrNextCost,
  attrSpent,
  secondarySpent,
} from '../../../shared/domain/attributeTooltips.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import { ConditionChip } from '../../components/ui/ConditionChip.tsx';
import { InfoTooltip } from '../../components/ui/InfoTooltip.tsx';
import { PoolMeter } from '../../components/ui/PoolMeter.tsx';
import { Stat, StatCard } from '../../components/ui/StatCard.tsx';
import { TempBoostPopover } from '../../components/ui/TempBoostPopover.tsx';
import { WarningBanner } from '../../components/ui/WarningBanner.tsx';
import { getLocalDb } from '../../db/dexie.ts';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../hooks/useDraftField.ts';
import { useFieldFlash } from '../../hooks/useFieldFlash.ts';
import { api } from '../../lib/api.ts';
import { makeFlashKey } from '../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../sync/outbox.ts';
import { CharacterMinimalView } from './CharacterMinimalView.tsx';
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
  /** "lg" renders a bordered input; "sm" renders a borderless inline number. */
  size?: 'lg' | 'sm';
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
  size = 'lg',
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
    if (size === 'sm') {
      return (
        <span className="num" aria-label={label}>
          {value}
        </span>
      );
    }
    return (
      <span className="num text-xl font-semibold" aria-label={label}>
        {value}
      </span>
    );
  }
  if (size === 'sm') {
    // Borderless inline number used inside the "base ±temp" caption.
    return (
      <input
        aria-label={label}
        className={`${DRAFT_FIELD_CLASS} num text-[11px] bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded ${width}`}
        {...draft.inputProps}
      />
    );
  }
  // Larger primary number: bordered, semibold.
  return (
    <input
      aria-label={label}
      className={`${DRAFT_FIELD_CLASS} num text-xl font-semibold bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded ${width}`}
      {...draft.inputProps}
    />
  );
}

/**
 * Compact ✦ button used inline beside an attribute input. Click to
 * open the existing TempBoostPopover for that attribute. Renders
 * `border-warning text-warning` when the temp is non-zero so a
 * glance at the row tells the player "this is currently boosted."
 *
 * Subscribes to the flashBus for the temp field so an async server
 * rejection visually pulses the button (AGENTS.md rule 2) — without
 * this the button would silently snap back to the reverted value.
 */
function TempBoostButton({
  label,
  field,
  baseValue,
  tempValue,
  characterId,
  displayScale,
}: {
  label: string;
  field: AttrField;
  baseValue: number;
  tempValue: number;
  characterId: string;
  displayScale?: number;
}) {
  const buildSave = useCharacterFieldSave(characterId);
  const { onSave, flashKey } = buildSave(field, { humanName: `${label} temp` });
  const flash = useFieldFlash(flashKey);
  const [open, setOpen] = useState(false);
  const active = tempValue !== 0;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Set temporary ${label}`}
        aria-expanded={open}
        title="Add temporary buff"
        className={`${DRAFT_FIELD_CLASS} num text-[10px] rounded px-1 border transition-colors ${
          active
            ? 'border-warning text-warning'
            : 'border-base-content/20 text-base-content/60 hover:text-base-content hover:border-base-content/40'
        }`}
        data-flashing={flash['data-flashing']}
        data-flash-parity={flash['data-flash-parity']}
      >
        ✦
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
          displayScale={displayScale}
        />
      )}
    </span>
  );
}

/**
 * Single primary-attribute cell. When `tempValue` is non-zero, the
 * effective value reads as the big number and the input shrinks to a
 * small "base ±temp" line beneath it (mirroring the legacy gurps-player-web
 * pattern). Tooltip on the label shows points spent / next +1 cost / what
 * the attribute influences.
 */
function PrimaryAttrCell({
  label,
  base,
  baseValue,
  temp,
  tempValue,
  effective,
  min,
  characterId,
  canWrite,
}: {
  label: 'ST' | 'DX' | 'IQ' | 'HT';
  base: AttrField;
  baseValue: number;
  temp: AttrField;
  tempValue: number;
  effective: number;
  min: number;
  characterId: string;
  canWrite: boolean;
}) {
  const tooltip = (
    <div className="grid gap-1.5">
      <div className="font-semibold text-base-content">{label}</div>
      <div className="num">
        Spent: <span className="text-base-content">{attrSpent(label, baseValue)} pts</span>
        {' · '}
        Next: <span className="text-base-content">+1 = {attrNextCost(label)} pts</span>
      </div>
      <div>
        <div className="label-eyebrow">Influences</div>
        <ul className="mt-1 list-disc pl-4 space-y-0.5 text-base-content/70">
          {ATTR_INFLUENCE[label].map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <InfoTooltip content={tooltip}>
        <span className="label-eyebrow">{label}</span>
      </InfoTooltip>
      <span className="flex items-baseline gap-2">
        {tempValue !== 0 ? (
          <>
            <span
              className="num text-2xl font-semibold text-warning"
              title={`Effective ${effective} (base ${baseValue} ${tempValue >= 0 ? '+' : ''}${tempValue})`}
            >
              {effective}
            </span>
            <span className="num text-[11px] text-base-content/60 flex items-baseline gap-0.5">
              <AttrInput
                label={`${label} base`}
                field={base}
                value={baseValue}
                characterId={characterId}
                canWrite={canWrite}
                min={min}
                max={99}
                width="w-9"
                size="sm"
              />
              <span className="text-warning">
                {tempValue >= 0 ? '+' : ''}
                {tempValue}
              </span>
            </span>
          </>
        ) : (
          <AttrInput
            label={`${label} base`}
            field={base}
            value={baseValue}
            characterId={characterId}
            canWrite={canWrite}
            min={min}
            max={99}
            width="w-14"
            size="lg"
          />
        )}
        {canWrite && (
          <TempBoostButton
            label={label}
            field={temp}
            baseValue={baseValue}
            tempValue={tempValue}
            characterId={characterId}
          />
        )}
      </span>
    </div>
  );
}

/**
 * Secondary-mod cell (HP / Will / Per / FP / Speed / Move). Same
 * inline pattern as PrimaryAttrCell but displays the derived value
 * (mod offset from the calculated base) rather than the raw mod.
 */
function SecondaryModCell({
  label,
  modField,
  modValue,
  tempField,
  tempValue,
  derived,
  derivedDisplay,
  modScale,
  infoKey,
  characterId,
  canWrite,
}: {
  label: string;
  modField: AttrField;
  modValue: number;
  tempField: AttrField;
  tempValue: number;
  derived: number;
  /** Optional override for the derived display (e.g. "5.50" for Speed). */
  derivedDisplay?: string;
  /** Scale factor for displaying mod/temp values (e.g. 0.25 converts quarter-units to decimal). */
  modScale?: number;
  infoKey: SecondaryModKey;
  characterId: string;
  canWrite: boolean;
}) {
  const info = SECONDARY_INFO[infoKey];
  const fmtMod = (v: number) => (modScale ? (v * modScale).toFixed(2) : String(v));
  const fmtDelta = (v: number) => {
    const s = fmtMod(Math.abs(v));
    return v >= 0 ? `+${s}` : `-${s}`;
  };
  const tooltip = (
    <div className="grid gap-1.5">
      <div className="font-semibold text-base-content">{info.label}</div>
      <div className="num">
        Spent: <span className="text-base-content">{secondarySpent(infoKey, modValue)} pts</span>
        {' · '}
        Next: <span className="text-base-content">{info.nextCostLabel}</span>
      </div>
      <div>
        <div className="label-eyebrow">Influences</div>
        <ul className="mt-1 list-disc pl-4 space-y-0.5 text-base-content/70">
          {info.influences.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
  const baseDerived = derived - tempValue;

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <InfoTooltip content={tooltip}>
        <span className="label-eyebrow">{label}</span>
      </InfoTooltip>
      <span className="flex items-baseline gap-2">
        {tempValue !== 0 ? (
          <>
            <span
              className="num text-xl font-semibold text-warning"
              title={`Effective ${derivedDisplay ?? derived} (base ${fmtMod(baseDerived)} ${fmtDelta(tempValue)})`}
            >
              {derivedDisplay ?? derived}
            </span>
            <span className="num text-[11px] text-base-content/60 flex items-baseline gap-0.5">
              {!canWrite && modScale ? (
                <span className="num" aria-label={`${label} mod`}>
                  {fmtMod(modValue)}
                </span>
              ) : (
                <AttrInput
                  label={`${label} mod`}
                  field={modField}
                  value={modValue}
                  characterId={characterId}
                  canWrite={canWrite}
                  min={-50}
                  max={50}
                  width="w-9"
                  size="sm"
                />
              )}
              <span className="text-warning">{fmtDelta(tempValue)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="num text-xl font-semibold">{derivedDisplay ?? derived}</span>
            <span className="num text-[11px] text-base-content/60 flex items-baseline gap-1">
              <span>mod</span>
              {!canWrite && modScale ? (
                <span className="num" aria-label={`${label} mod`}>
                  {fmtMod(modValue)}
                </span>
              ) : (
                <AttrInput
                  label={`${label} mod`}
                  field={modField}
                  value={modValue}
                  characterId={characterId}
                  canWrite={canWrite}
                  min={-50}
                  max={50}
                  width="w-9"
                  size="sm"
                />
              )}
            </span>
          </>
        )}
        {canWrite && (
          <TempBoostButton
            label={label}
            field={tempField}
            baseValue={baseDerived}
            tempValue={tempValue}
            characterId={characterId}
            displayScale={modScale}
          />
        )}
      </span>
    </div>
  );
}

function IdentityPanel({
  character,
  canWrite,
  campaigns,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  campaigns: CampaignSummary[];
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
        <div className="form-control">
          <span className="label-text-alt label-eyebrow">Campaign</span>
          {canWrite ? (
            <select
              aria-label="campaign"
              className="select select-bordered select-sm"
              value={character.campaignId ?? ''}
              onChange={(e) => {
                const next = e.target.value || null;
                void enqueueFieldPatch({
                  entityClass: 'character',
                  entityId: character.id,
                  fieldPath: 'campaignId',
                  attemptedValue: next,
                  humanName: 'campaign',
                  flashKey: makeFlashKey('character', character.id, 'campaignId'),
                });
              }}
            >
              <option value="">No campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span>{campaigns.find((c) => c.id === character.campaignId)?.name ?? '—'}</span>
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

/** All temp-modifier fields on a character. Used for the "Revert all" bulk action. */
const TEMP_FIELDS: readonly AttrField[] = [
  'tempSt',
  'tempDx',
  'tempIq',
  'tempHt',
  'tempHpMod',
  'tempWillMod',
  'tempPerMod',
  'tempFpMod',
  'tempSpeedQuarterMod',
  'tempMoveMod',
];

/** True when any temporary modifier on the character is non-zero. */
function anyTempActive(c: CharacterDetail): boolean {
  return TEMP_FIELDS.some((f) => (c as unknown as Record<AttrField, number>)[f] !== 0);
}

/**
 * Enqueue a per-field patch for every temp field that's currently
 * non-zero, setting it back to 0. Each goes through the standard
 * outbox path so an offline bulk-revert is durable.
 */
function revertAllTemps(c: CharacterDetail): void {
  for (const f of TEMP_FIELDS) {
    const value = (c as unknown as Record<AttrField, number>)[f];
    if (value === 0) continue;
    void enqueueFieldPatch({
      entityClass: 'character',
      entityId: c.id,
      fieldPath: f,
      attemptedValue: 0,
      humanName: `${f} temp`,
      flashKey: makeFlashKey('character', c.id, f),
    });
  }
}

function AttributesPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  const tempActive = canWrite && anyTempActive(character);
  return (
    <StatCard title="Attributes" points={character.points.attributes}>
      <div className="grid grid-cols-2 gap-3.5">
        <PrimaryAttrCell
          label="ST"
          base="st"
          baseValue={character.st}
          temp="tempSt"
          tempValue={character.tempSt}
          effective={character.derived.effectiveSt}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
        <PrimaryAttrCell
          label="DX"
          base="dx"
          baseValue={character.dx}
          temp="tempDx"
          tempValue={character.tempDx}
          effective={character.derived.effectiveDx}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
        <PrimaryAttrCell
          label="IQ"
          base="iq"
          baseValue={character.iq}
          temp="tempIq"
          tempValue={character.tempIq}
          effective={character.derived.effectiveIq}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
        <PrimaryAttrCell
          label="HT"
          base="ht"
          baseValue={character.ht}
          temp="tempHt"
          tempValue={character.tempHt}
          effective={character.derived.effectiveHt}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
      </div>
      {tempActive && (
        <button
          type="button"
          onClick={() => revertAllTemps(character)}
          className="num mt-3 h-7 w-full rounded-lg border border-dashed border-warning/60 text-[11px] text-warning hover:bg-warning/10 transition-colors"
        >
          Revert all temporary buffs
        </button>
      )}
    </StatCard>
  );
}

function SecondaryModsPanel({
  character,
  canWrite,
}: {
  character: CharacterDetail;
  canWrite: boolean;
}) {
  return (
    <StatCard title="Secondary" points={character.points.secondary}>
      <div className="grid grid-cols-2 gap-3.5">
        <SecondaryModCell
          label="HP"
          modField="hpMod"
          modValue={character.hpMod}
          tempField="tempHpMod"
          tempValue={character.tempHpMod}
          derived={character.derived.hp}
          infoKey="hp"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="Will"
          modField="willMod"
          modValue={character.willMod}
          tempField="tempWillMod"
          tempValue={character.tempWillMod}
          derived={character.derived.will}
          infoKey="will"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="Per"
          modField="perMod"
          modValue={character.perMod}
          tempField="tempPerMod"
          tempValue={character.tempPerMod}
          derived={character.derived.per}
          infoKey="per"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="FP"
          modField="fpMod"
          modValue={character.fpMod}
          tempField="tempFpMod"
          tempValue={character.tempFpMod}
          derived={character.derived.fp}
          infoKey="fp"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="Speed"
          modField="speedQuarterMod"
          modValue={character.speedQuarterMod}
          tempField="tempSpeedQuarterMod"
          tempValue={character.tempSpeedQuarterMod}
          derived={character.derived.basicSpeedQuarters}
          derivedDisplay={character.derived.basicSpeed.toFixed(2)}
          modScale={0.25}
          infoKey="speed"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="Move"
          modField="moveMod"
          modValue={character.moveMod}
          tempField="tempMoveMod"
          tempValue={character.tempMoveMod}
          derived={character.derived.basicMove}
          infoKey="move"
          characterId={character.id}
          canWrite={canWrite}
        />
      </div>
    </StatCard>
  );
}

function DerivedPanel({ character }: { character: CharacterDetail }) {
  const d = character.derived;
  return (
    <StatCard title="Derived">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>HP</strong> defaults to ST. The current pool can be pushed past max with
                  the double-press override in the combat panel.
                </span>
              }
            >
              <span>HP</span>
            </InfoTooltip>
          }
          value={d.hp}
        />
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>Will</strong> defaults to IQ; the secondary mod shifts it independently.
                </span>
              }
            >
              <span>Will</span>
            </InfoTooltip>
          }
          value={d.will}
        />
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>Per</strong> defaults to IQ; sense rolls use this, not raw IQ.
                </span>
              }
            >
              <span>Per</span>
            </InfoTooltip>
          }
          value={d.per}
        />
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>FP</strong> defaults to HT. Spent on running, spellcasting, extra-effort.
                </span>
              }
            >
              <span>FP</span>
            </InfoTooltip>
          }
          value={d.fp}
        />
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>Basic Speed</strong> = (DX + HT)/4. Drives Dodge and Basic Move.
                </span>
              }
            >
              <span>Basic Speed</span>
            </InfoTooltip>
          }
          value={d.basicSpeed.toFixed(2)}
        />
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>Basic Move</strong> drops the fractional part of Basic Speed, then applies
                  any secondary +Move.
                </span>
              }
            >
              <span>Basic Move</span>
            </InfoTooltip>
          }
          value={d.basicMove}
        />
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>Dodge</strong> = Basic Speed + 3, then encumbrance penalty applies.
                </span>
              }
            >
              <span>Dodge</span>
            </InfoTooltip>
          }
          value={d.dodge}
        />
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>Basic Lift</strong> = ST²/5 lbs. Encumbrance levels are multiples of this.
                </span>
              }
            >
              <span>Basic Lift</span>
            </InfoTooltip>
          }
          value={`${d.basicLift.toFixed(1)} lb`}
        />
      </div>
    </StatCard>
  );
}

function PointsPanel({ character }: { character: CharacterDetail }) {
  const p = character.points;
  return (
    <StatCard title="Point ledger" points={p.total}>
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
    </StatCard>
  );
}

function EncumbrancePanel({ character }: { character: CharacterDetail }) {
  const e = character.encumbrance;
  return (
    <StatCard
      title="Encumbrance"
      headerExtra={<span className="badge badge-ghost">{e.label}</span>}
    >
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
    </StatCard>
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
  ownerId: string;
  pointTarget: number | null;
  shareCharacterSheets: boolean;
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
    // Always fetch when the user is known so the Identity panel can offer
    // the full campaign list — even for characters not yet in a campaign.
    enabled: !!me.data,
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

  // Minimal-view gate: when the character belongs to a campaign that
  // has flipped `shareCharacterSheets` off, members other than the
  // character's owner and the campaign GM see only the "readily
  // apparent" identity bits. Owners and GMs always see the full sheet.
  // Mirrors the server-side gate in `shouldUseMinimalView` so the
  // local-first path renders consistently with the API contract.
  const myId = me.data?.id ?? null;
  const isOwner = myId !== null && myId === character.ownerId;
  const isGm = myId !== null && campaign != null && myId === campaign.ownerId;
  const sharesSheets = campaign?.shareCharacterSheets !== false; // undefined → default true
  if (!isOwner && !isGm && campaign != null && !sharesSheets) {
    return (
      <CharacterMinimalView
        data={{
          view: 'minimal',
          id: character.id,
          ownerId: character.ownerId,
          // The schema marks `campaignId` optional+nullable, so coerce
          // `undefined` to null for the minimal-view props (which only
          // allow string|null).  Same coercion applies to the rest.
          campaignId: character.campaignId ?? null,
          name: character.name,
          playerName: character.playerName ?? null,
          height: character.height ?? null,
          weight: character.weight ?? null,
          age: character.age ?? null,
          appearance: character.appearance ?? null,
          techLevel: character.techLevel ?? null,
          updatedAt: character.updatedAt,
        }}
      />
    );
  }

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
        {tab === 'Identity' && (
          <IdentityPanel
            character={character}
            canWrite={canWrite}
            campaigns={campaigns.data ?? []}
          />
        )}
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
