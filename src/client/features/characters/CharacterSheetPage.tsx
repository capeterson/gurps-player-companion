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
import { hasMagery } from '../../../shared/domain/spellCalc.ts';
import { formatScaled } from '../../../shared/format/number.ts';
import {
  type CharacterDetail,
  MANUAL_TEMP_EFFECT_ID,
  TEMP_AXIS_LABELS,
  TEMP_STAT_AXES,
  type TempStatAxis,
} from '../../../shared/schemas/character.ts';
import { ConditionChip } from '../../components/ui/ConditionChip.tsx';
import { InfoTooltip } from '../../components/ui/InfoTooltip.tsx';
import { PoolMeter } from '../../components/ui/PoolMeter.tsx';
import { Stat, StatCard } from '../../components/ui/StatCard.tsx';
import { TempBoostPopover } from '../../components/ui/TempBoostPopover.tsx';
import { WarningBanner } from '../../components/ui/WarningBanner.tsx';
import { DRAFT_FIELD_CLASS, useDraftField } from '../../hooks/useDraftField.ts';
import { useFieldFlash } from '../../hooks/useFieldFlash.ts';
import { api } from '../../lib/api.ts';
import {
  intParser,
  nullableIntParser,
  nullableTextParser,
  scaledIntParser,
} from '../../lib/parsers.ts';
import { useToasts } from '../../lib/toast.tsx';
import { makeFlashKey } from '../../sync/flashBus.ts';
import { enqueueFieldPatch } from '../../sync/outbox.ts';
import { CharacterMinimalView } from './CharacterMinimalView.tsx';
import { CombatModal } from './sections/CombatModal.tsx';
import { HistoryPanel } from './sections/HistoryPanel.tsx';
import { InventoryPanel } from './sections/InventoryPanel.tsx';
import { MagicItemsPanel, PowerstonesPanel } from './sections/PowerstonesPanel.tsx';
import { SkillsPanel } from './sections/SkillsPanel.tsx';
import { SpellsPanel } from './sections/SpellsPanel.tsx';
import { TraitsPanel } from './sections/TraitsPanel.tsx';
import { hpVarFor } from './sections/hpColor.ts';
import { useCharacterFieldSave } from './sections/useCharacterPatch.ts';
import { useCombatPatch } from './sections/useCombatPatch.ts';
import {
  type TempEffectMods,
  type TempEffectsApi,
  useTempEffects,
} from './sections/useTempEffects.ts';
import { type CampaignSummary, useCharacterAccessLocal } from './useCharacterAccess.ts';
import { useCharacterDetail } from './useCharacterDetail.ts';
import { useMirrorCampaigns } from './useMirrorCampaigns.ts';

type SheetTab =
  | 'Combat'
  | 'Identity'
  | 'Traits'
  | 'Skills'
  | 'Magic'
  | 'Inventory'
  | 'Notes'
  | 'History';
const SHEET_TABS: readonly SheetTab[] = [
  'Combat',
  'Identity',
  'Traits',
  'Skills',
  'Magic',
  'Inventory',
  'Notes',
  'History',
] as const;

interface CountByTab {
  Skills?: number;
  Inventory?: number;
  Traits?: number;
  Magic?: number;
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

type AttrField =
  | 'st'
  | 'dx'
  | 'iq'
  | 'ht'
  | 'hpMod'
  | 'willMod'
  | 'perMod'
  | 'fpMod'
  | 'speedQuarterMod'
  | 'moveMod';

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
  /** Scale factor for display (e.g. 0.25 converts stored quarter-units to decimal). */
  displayScale?: number | undefined;
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
  displayScale = 1,
}: AttrInputProps) {
  // Use the bundled saver so the input subscribes to the flashBus on
  // its own key.  Without `flashKey` an async server rejection would
  // toast but never visually flash this input.
  const buildSave = useCharacterFieldSave(characterId);
  const fieldSave = buildSave(field, { humanName: label });
  const draft = useDraftField<number>({
    name: label,
    serverValue: value,
    format: (v) => formatScaled(v, displayScale),
    parse: displayScale !== 1 ? scaledIntParser(displayScale, min, max) : intParser(min, max),
    ...fieldSave,
  });
  if (!canWrite) {
    const display = formatScaled(value, displayScale);
    if (size === 'sm') {
      return (
        <span className="num" aria-label={label}>
          {display}
        </span>
      );
    }
    return (
      <span className="num text-xl font-semibold" aria-label={label}>
        {display}
      </span>
    );
  }
  if (size === 'sm') {
    // Borderless inline number used inside the "base ±temp" caption.
    // On mobile add a visible chip + 28px touch target so the input
    // reads as editable; ≥sm reverts to the borderless inline style.
    return (
      <input
        aria-label={label}
        className={`${DRAFT_FIELD_CLASS} num text-[11px] bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded border border-base-300/60 px-1 h-7 min-w-[2rem] sm:border-0 sm:px-0 sm:h-auto sm:min-w-0 ${width}`}
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
 * Compact ✦ button used inline beside a stat. Click to open the
 * shared modifier popover. The popover edits a temp delta and,
 * optionally, a permanent modifier (used by secondary stats whose
 * "base" is computed from primary attributes and can only be
 * shifted via a stored mod). Renders `border-warning text-warning`
 * when any modifier is non-zero so a glance tells the player
 * "this stat is being adjusted."
 *
 * Subscribes to the flashBus for both fields so an async server
 * rejection on either visually pulses the button (AGENTS.md rule 2).
 */
function ModifierButton({
  label,
  baseValue,
  characterId,
  tempTotal,
  tempManual,
  tempNamed,
  onApplyTempManual,
  tempFlashKey,
  permField,
  permValue,
  permCostLabel,
  displayScale,
}: {
  label: string;
  /** Raw base before perm mod and temp (display-scaled inside the popover). */
  baseValue: number;
  characterId: string;
  /** `totals[axis]` from useTempEffects -- manual + every named effect. */
  tempTotal: number;
  /** The 'manual' effect's axis value -- what this popover's Temporary
   * section actually edits. */
  tempManual: number;
  /** `tempTotal - tempManual` -- contribution from named effects, shown
   * read-only in the popover. */
  tempNamed: number;
  onApplyTempManual: (next: number) => void;
  /** Shared across every axis -- all of them patch the same `tempEffects` field. */
  tempFlashKey: string;
  /** Optional permanent-modifier field; omit for primary attributes. */
  permField?: AttrField;
  permValue?: number;
  permCostLabel?: string;
  displayScale?: number | undefined;
}) {
  const buildSave = useCharacterFieldSave(characterId);
  const permSaver = permField ? buildSave(permField, { humanName: `${label} mod` }) : null;
  const tempFlash = useFieldFlash(tempFlashKey);
  const permFlash = useFieldFlash(permSaver?.flashKey);
  const [open, setOpen] = useState(false);
  const permActive = permValue !== undefined && permValue !== 0;
  const active = tempTotal !== 0 || permActive;
  const flashing = tempFlash.flashing || permFlash.flashing ? 'true' : 'false';
  const parity = tempFlash.flashing
    ? tempFlash['data-flash-parity']
    : permFlash['data-flash-parity'];
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Edit ${label} modifiers`}
        aria-expanded={open}
        title="Edit modifiers"
        className={`${DRAFT_FIELD_CLASS} num text-[10px] rounded px-1 border transition-colors ${
          active
            ? 'border-warning text-warning'
            : 'border-base-content/20 text-base-content/60 hover:text-base-content hover:border-base-content/40'
        }`}
        data-flashing={flashing}
        data-flash-parity={parity}
      >
        ✦
      </button>
      {open && (
        <TempBoostPopover
          label={label}
          baseValue={baseValue}
          temp={{
            value: tempManual,
            onApply: onApplyTempManual,
            // Mirrors the bounds the legacy inline AttrInput enforced;
            // keeps a stray "100" from corrupting Dexie before the
            // server's mod-schema rejects it.
            min: -50,
            max: 50,
          }}
          namedTempContribution={tempNamed}
          perm={
            permSaver && permValue !== undefined
              ? {
                  value: permValue,
                  onApply: (v) => {
                    void permSaver.onSave(v);
                  },
                  min: -50,
                  max: 50,
                }
              : undefined
          }
          permCostLabel={permCostLabel}
          onClose={() => setOpen(false)}
          displayScale={displayScale}
        />
      )}
    </span>
  );
}

/**
 * Tooltip body shared by primary attribute and secondary mod cells:
 * "Spent X · Next Y" plus a plain-language influence list.
 */
function StatTooltipContent({
  title,
  spent,
  nextCostLabel,
  influences,
}: {
  title: string;
  spent: number;
  nextCostLabel: string;
  influences: readonly string[];
}) {
  return (
    <div className="grid gap-1.5">
      <div className="font-semibold text-base-content">{title}</div>
      <div className="num">
        Spent: <span className="text-base-content">{spent} pts</span>
        {' · '}
        Next: <span className="text-base-content">{nextCostLabel}</span>
      </div>
      <div>
        <div className="label-eyebrow">Influences</div>
        <ul className="mt-1 list-disc pl-4 space-y-0.5 text-base-content/70">
          {influences.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Render a signed delta with an optional display scale. Delegates
 * magnitude formatting to the shared `formatScaled` helper, which uses
 * an ASCII hyphen-minus for negative values (was U+2212 '−').
 */
function fmtSignedDelta(value: number, scale = 1): string {
  const text = formatScaled(Math.abs(value), scale);
  return value >= 0 ? `+${text}` : `-${text}`;
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
  axis,
  tempEffects,
  effective,
  min,
  characterId,
  canWrite,
}: {
  label: 'ST' | 'DX' | 'IQ' | 'HT';
  base: AttrField;
  baseValue: number;
  axis: TempStatAxis;
  tempEffects: TempEffectsApi;
  effective: number;
  min: number;
  characterId: string;
  canWrite: boolean;
}) {
  const tempTotal = tempEffects.totals[axis];
  const manualEffect = tempEffects.effects.find((e) => e.id === MANUAL_TEMP_EFFECT_ID);
  const tempManual = manualEffect?.mods[axis] ?? 0;
  const tempNamed = tempTotal - tempManual;
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <InfoTooltip
        content={
          <StatTooltipContent
            title={label}
            spent={attrSpent(label, baseValue)}
            nextCostLabel={`+1 = ${attrNextCost(label)} pts`}
            influences={ATTR_INFLUENCE[label]}
          />
        }
      >
        <span className="label-eyebrow">{label}</span>
      </InfoTooltip>
      <span className="flex items-baseline gap-2">
        {tempTotal !== 0 ? (
          <>
            <span
              className="num text-2xl font-semibold text-warning"
              title={`Effective ${effective} (base ${baseValue} ${fmtSignedDelta(tempTotal)})`}
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
                width="w-12 sm:w-9"
                size="sm"
              />
              <span className="text-warning">{fmtSignedDelta(tempTotal)}</span>
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
          <ModifierButton
            label={label}
            tempTotal={tempTotal}
            tempManual={tempManual}
            tempNamed={tempNamed}
            onApplyTempManual={(v) => tempEffects.setManualAxis(axis, v)}
            tempFlashKey={tempEffects.flashKey}
            baseValue={baseValue}
            characterId={characterId}
          />
        )}
      </span>
    </div>
  );
}

/**
 * Secondary-mod cell (HP / Will / Per / FP / Speed / Move). The big
 * number is the effective derived value; both the permanent mod and
 * the temporary delta are edited through the shared modifier popover
 * (the ✦ button), so we hide the inline detail line entirely when
 * neither is set — mirroring how PrimaryAttrCell hides its "base ±
 * temp" line when temp is zero.
 */
function SecondaryModCell({
  label,
  modField,
  modValue,
  axis,
  tempEffects,
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
  axis: TempStatAxis;
  tempEffects: TempEffectsApi;
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
  const fmtRaw = (v: number) => formatScaled(v, modScale ?? 1);
  const tempTotal = tempEffects.totals[axis];
  const manualEffect = tempEffects.effects.find((e) => e.id === MANUAL_TEMP_EFFECT_ID);
  const tempManual = manualEffect?.mods[axis] ?? 0;
  const tempNamed = tempTotal - tempManual;
  const baseRaw = derived - modValue - tempTotal;
  const adjusted = modValue !== 0 || tempTotal !== 0;
  const displayValue = derivedDisplay ?? String(derived);
  const breakdown = `base ${fmtRaw(baseRaw)}${
    modValue !== 0 ? ` ${fmtSignedDelta(modValue, modScale ?? 1)}` : ''
  }${tempTotal !== 0 ? ` ${fmtSignedDelta(tempTotal, modScale ?? 1)}` : ''}`;

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <InfoTooltip
        content={
          <StatTooltipContent
            title={info.label}
            spent={secondarySpent(infoKey, modValue)}
            nextCostLabel={info.nextCostLabel}
            influences={info.influences}
          />
        }
      >
        <span className="label-eyebrow">{label}</span>
      </InfoTooltip>
      <span className="flex items-baseline gap-2">
        <span
          className={`num text-xl font-semibold ${adjusted ? 'text-warning' : ''}`}
          title={adjusted ? `Effective ${displayValue} (${breakdown})` : undefined}
        >
          {displayValue}
        </span>
        {adjusted && (
          <span className="num text-[10px] text-base-content/60 flex items-baseline gap-0.5">
            <span>{fmtRaw(baseRaw)}</span>
            {modValue !== 0 && (
              <span className="text-warning">{fmtSignedDelta(modValue, modScale ?? 1)}</span>
            )}
            {tempTotal !== 0 && (
              <span className="text-warning">{fmtSignedDelta(tempTotal, modScale ?? 1)}</span>
            )}
          </span>
        )}
        {canWrite && (
          <ModifierButton
            label={label}
            baseValue={baseRaw}
            characterId={characterId}
            tempTotal={tempTotal}
            tempManual={tempManual}
            tempNamed={tempNamed}
            onApplyTempManual={(v) => tempEffects.setManualAxis(axis, v)}
            tempFlashKey={tempEffects.flashKey}
            permField={modField}
            permValue={modValue}
            permCostLabel={info.nextCostLabel}
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
  const campaignFlashKey = makeFlashKey('character', character.id, 'campaignId');
  const campaignFlash = useFieldFlash(campaignFlashKey);

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
              className={`${DRAFT_FIELD_CLASS} select select-bordered select-sm`}
              value={character.campaignId ?? ''}
              data-flashing={campaignFlash['data-flashing']}
              data-flash-parity={campaignFlash['data-flash-parity']}
              onChange={(e) => {
                const next = e.target.value || null;
                void enqueueFieldPatch({
                  entityClass: 'character',
                  entityId: character.id,
                  fieldPath: 'campaignId',
                  attemptedValue: next,
                  humanName: 'campaign',
                  flashKey: campaignFlashKey,
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

/**
 * "ST +2, HT +1" -- every axis an effect touches, signed and labeled.
 * `speedQuarter` is stored in quarter-Speed-point units (S2/S3 raw
 * value); scale it back to whole Speed points for display, mirroring
 * `SecondaryModCell`'s `modScale={0.25}` for the same axis so the row
 * and the "±N from effects" caption agree (PR #46 review finding).
 */
export function formatEffectMods(mods: TempEffectMods): string {
  const parts: string[] = [];
  for (const axis of TEMP_STAT_AXES) {
    const v = mods[axis];
    if (v === undefined || v === 0) continue;
    const scale = axis === 'speedQuarter' ? 0.25 : 1;
    parts.push(`${TEMP_AXIS_LABELS[axis]} ${fmtSignedDelta(v, scale)}`);
  }
  return parts.join(', ');
}

/**
 * Named-effects list + compact add form, rendered under the Attributes
 * panel's revert-all button. The 'manual' entry (driven by the ✦
 * popovers) shows read-only here -- it has no remove button because
 * the popovers already manage it via "Clear".
 *
 * Rendered for every viewer who HAS effect data, including full
 * read-only viewers (e.g. a GM) -- only the add form and the per-row
 * remove buttons are gated on `canWrite` (PR #46 review finding: this
 * used to gate the whole list, hiding named effects from read-only
 * viewers entirely). Share-gate minimal viewers already receive
 * `tempEffects: []` from the server, so there's nothing to leak here.
 */
function TempEffectsList({
  tempEffects,
  canWrite,
}: {
  tempEffects: TempEffectsApi;
  canWrite: boolean;
}) {
  const toasts = useToasts();
  const flash = useFieldFlash(tempEffects.flashKey);
  const manualEffect = tempEffects.effects.find((e) => e.id === MANUAL_TEMP_EFFECT_ID);
  const namedEffects = tempEffects.effects.filter((e) => e.id !== MANUAL_TEMP_EFFECT_ID);
  const [name, setName] = useState('');
  const [axis, setAxis] = useState<TempStatAxis>('st');
  const [amount, setAmount] = useState('');

  function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    // Speed is stored in quarter-Speed-point units (mods.speedQuarter),
    // but the input reads in whole Speed points -- e.g. typing "1"
    // means "+1 Speed" and must store 4 quarters, not 1 (PR #46 review:
    // this used to write the raw parsed integer straight into
    // mods.speedQuarter, silently storing 1/4 of the intended boost).
    // scaledIntParser both does the ×4 conversion and rejects amounts
    // that aren't exact quarter-steps.
    let n: number;
    try {
      n =
        axis === 'speedQuarter'
          ? scaledIntParser(0.25, -50, 50)(amount)
          : intParser(-50, 50)(amount);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'invalid amount';
      toasts.push(`Couldn't add effect — ${msg}`, { kind: 'error' });
      return;
    }
    if (n === 0) return;
    tempEffects.addEffect(name, { [axis]: n });
    setName('');
    setAmount('');
  }

  return (
    <div
      className="mt-3 space-y-1.5"
      data-flashing={flash['data-flashing']}
      data-flash-parity={flash['data-flash-parity']}
    >
      {manualEffect && formatEffectMods(manualEffect.mods) && (
        <div className="num text-[11px] text-base-content/60">
          Manual adjustment — {formatEffectMods(manualEffect.mods)}
        </div>
      )}
      {namedEffects.map((effect) => (
        <div key={effect.id} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="num truncate">
            {effect.name} — {formatEffectMods(effect.mods)}
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={() => tempEffects.removeEffect(effect.id)}
              aria-label={`Remove ${effect.name}`}
              className="btn btn-ghost btn-xs px-1.5"
            >
              ×
            </button>
          )}
        </div>
      ))}
      {canWrite && (
        <form onSubmit={submitAdd} className="flex items-center gap-1.5">
          <input
            aria-label="New effect name"
            placeholder="Effect name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input input-bordered input-xs flex-1 min-w-0"
          />
          <select
            aria-label="Effect axis"
            value={axis}
            onChange={(e) => setAxis(e.target.value as TempStatAxis)}
            className="select select-bordered select-xs"
          >
            {TEMP_STAT_AXES.map((a) => (
              <option key={a} value={a}>
                {TEMP_AXIS_LABELS[a]}
              </option>
            ))}
          </select>
          <input
            aria-label="Effect amount"
            type="number"
            step={axis === 'speedQuarter' ? 0.25 : 1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="num input input-bordered input-xs w-14"
          />
          <button type="submit" className="btn btn-ghost btn-xs">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function AttributesPanel({
  character,
  canWrite,
  tempEffects,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  tempEffects: TempEffectsApi;
}) {
  const tempActive = canWrite && TEMP_STAT_AXES.some((axis) => tempEffects.totals[axis] !== 0);
  return (
    <StatCard title="Attributes" points={character.points.attributes}>
      <div className="grid grid-cols-2 gap-3.5">
        <PrimaryAttrCell
          label="ST"
          base="st"
          baseValue={character.st}
          axis="st"
          tempEffects={tempEffects}
          effective={character.derived.effectiveSt}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
        <PrimaryAttrCell
          label="DX"
          base="dx"
          baseValue={character.dx}
          axis="dx"
          tempEffects={tempEffects}
          effective={character.derived.effectiveDx}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
        <PrimaryAttrCell
          label="IQ"
          base="iq"
          baseValue={character.iq}
          axis="iq"
          tempEffects={tempEffects}
          effective={character.derived.effectiveIq}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
        <PrimaryAttrCell
          label="HT"
          base="ht"
          baseValue={character.ht}
          axis="ht"
          tempEffects={tempEffects}
          effective={character.derived.effectiveHt}
          min={1}
          characterId={character.id}
          canWrite={canWrite}
        />
      </div>
      {tempActive && (
        <button
          type="button"
          onClick={() => tempEffects.clearAll()}
          className="num mt-3 h-7 w-full rounded-lg border border-dashed border-warning/60 text-[11px] text-warning hover:bg-warning/10 transition-colors"
        >
          Revert all temporary buffs
        </button>
      )}
      {(canWrite || tempEffects.effects.length > 0) && (
        <TempEffectsList tempEffects={tempEffects} canWrite={canWrite} />
      )}
    </StatCard>
  );
}

function SecondaryModsPanel({
  character,
  canWrite,
  tempEffects,
}: {
  character: CharacterDetail;
  canWrite: boolean;
  tempEffects: TempEffectsApi;
}) {
  return (
    <StatCard title="Secondary" points={character.points.secondary}>
      <div className="grid grid-cols-2 gap-3.5">
        <SecondaryModCell
          label="HP"
          modField="hpMod"
          modValue={character.hpMod}
          axis="hp"
          tempEffects={tempEffects}
          derived={character.derived.hp}
          infoKey="hp"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="Will"
          modField="willMod"
          modValue={character.willMod}
          axis="will"
          tempEffects={tempEffects}
          derived={character.derived.will}
          infoKey="will"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="Per"
          modField="perMod"
          modValue={character.perMod}
          axis="per"
          tempEffects={tempEffects}
          derived={character.derived.per}
          infoKey="per"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="FP"
          modField="fpMod"
          modValue={character.fpMod}
          axis="fp"
          tempEffects={tempEffects}
          derived={character.derived.fp}
          infoKey="fp"
          characterId={character.id}
          canWrite={canWrite}
        />
        <SecondaryModCell
          label="Speed"
          modField="speedQuarterMod"
          modValue={character.speedQuarterMod}
          axis="speedQuarter"
          tempEffects={tempEffects}
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
          axis="move"
          tempEffects={tempEffects}
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
        <Stat
          label={
            <InfoTooltip
              content={
                <span>
                  <strong>Basic damage</strong> from ST (B16): thrust for stabs and punches, swing
                  for swung weapons. Weapon lines add their own modifiers.
                </span>
              }
            >
              <span>Thr / Sw</span>
            </InfoTooltip>
          }
          value={`${d.thrust} / ${d.swing}`}
        />
      </div>
    </StatCard>
  );
}

function PointsPanel({ character }: { character: CharacterDetail }) {
  const p = character.points;
  const [open, setOpen] = useState(false);
  return (
    <StatCard
      title="Point ledger"
      points={p.total}
      headerExtra={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="btn btn-ghost btn-xs px-1 text-base-content/50"
          aria-expanded={open}
          aria-label={open ? 'Collapse point ledger' : 'Expand point ledger'}
        >
          {open ? '▾' : '▸'}
        </button>
      }
    >
      {open && (
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
      )}
    </StatCard>
  );
}

const ENCUMBRANCE_TONE = [
  { badge: 'badge-success', fill: 'bg-success' },
  { badge: 'badge-info', fill: 'bg-info' },
  { badge: 'badge-warning', fill: 'bg-warning' },
  { badge: 'badge-error', fill: 'bg-error' },
  { badge: 'badge-error', fill: 'bg-error' },
] as const;

function EncumbrancePanel({ character }: { character: CharacterDetail }) {
  const e = character.encumbrance;
  const d = character.derived;
  const bl = e.basicLift;
  const tiers = [
    { label: 'None', from: 0, to: bl, level: 0 },
    { label: 'Light', from: bl, to: bl * 2, level: 1 },
    { label: 'Medium', from: bl * 2, to: bl * 3, level: 2 },
    { label: 'Heavy', from: bl * 3, to: bl * 6, level: 3 },
    { label: 'X-Heavy', from: bl * 6, to: bl * 10, level: 4 },
  ] as const;
  const maxWeight = bl * 10;
  const fillPct =
    maxWeight > 0 ? Math.max(0, Math.min(100, (e.playerWeightLbs / maxWeight) * 100)) : 100;
  const nextTier = tiers[e.level + 1];
  // At X-Heavy there's no next tier, but the player can still be below
  // the 10×BL carry cap — show headroom against `maxWeight` until they
  // actually reach it; otherwise the bar would lie.
  const nextThresholdLb = nextTier ? nextTier.from : maxWeight;
  const nextThresholdLabel = nextTier ? nextTier.label : 'cap';
  const lbToNext = Math.max(0, nextThresholdLb - e.playerWeightLbs);
  const atCap = !nextTier && e.playerWeightLbs >= maxWeight;
  const tone = ENCUMBRANCE_TONE[e.level] ?? ENCUMBRANCE_TONE[0];

  // Move at encumbrance is floor(Basic Move × multiplier) but never
  // below 1 while the load is legal (B17); past 10×BL you can't move.
  const overCarryCap = e.ratio > 10;
  const moveFloor = d.basicMove > 0 ? 1 : 0;
  const moveNet = overCarryCap
    ? 0
    : Math.max(moveFloor, Math.floor(d.basicMove * e.moveMultiplier));
  const movePenalty = d.basicMove - moveNet;
  const dodgePenaltyAbs = -e.dodgePenalty;
  const dodgeNet = d.dodge + e.dodgePenalty;

  const tierBreakdown = (
    <div className="grid gap-1.5">
      <div className="font-semibold text-base-content">Encumbrance tiers</div>
      <div className="text-base-content/60">
        Carried weight relative to your Basic Lift ({bl.toFixed(1)} lb).
      </div>
      <ul className="num grid gap-0.5">
        {tiers.map((row) => (
          <li
            key={row.label}
            className={`flex justify-between gap-3 ${
              row.level === e.level ? 'text-base-content font-semibold' : 'text-base-content/60'
            }`}
          >
            <span>{row.label}</span>
            <span>
              {row.from.toFixed(1)} – {row.to.toFixed(1)} lb
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  const equation = (base: number, penalty: number, net: number) => (
    <span className="num">
      <span className="text-base-content/60">{base}</span>
      <span className="text-base-content/40"> − </span>
      <span className="text-base-content/60">{penalty}</span>
      <span className="text-base-content/40"> = </span>
      <span className="font-semibold text-base-content">{net}</span>
    </span>
  );

  return (
    <StatCard
      title="Encumbrance"
      headerExtra={<span className={`badge ${tone.badge}`}>{e.label}</span>}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <InfoTooltip content={tierBreakdown}>
              <span>Carrying</span>
            </InfoTooltip>
            <span className="num">
              <span className="font-semibold text-base-content">
                {e.playerWeightLbs.toFixed(1)}
              </span>
              <span className="text-base-content/50"> / {maxWeight.toFixed(1)} lb</span>
            </span>
          </div>
          <div
            className="relative h-2.5 rounded-full bg-base-200 overflow-hidden"
            aria-label={`Encumbrance ${e.label}, carrying ${e.playerWeightLbs.toFixed(1)} of ${maxWeight.toFixed(1)} lb`}
          >
            <div
              className={`absolute inset-y-0 left-0 ${tone.fill} transition-[width]`}
              style={{ width: `${fillPct}%` }}
            />
            {[10, 20, 30, 60].map((pct) => (
              <div
                key={pct}
                className="absolute inset-y-0 w-px bg-base-100"
                style={{ left: `${pct}%` }}
              />
            ))}
          </div>
          <div className="text-xs text-base-content/60 num">
            {atCap ? 'Maxed out' : `${lbToNext.toFixed(1)} lb until ${nextThresholdLabel}`}
          </div>
        </div>

        <ul className="text-sm space-y-1 border-t border-base-300/60 pt-2">
          <li className="flex justify-between gap-2">
            <InfoTooltip
              content={
                <div className="grid gap-1">
                  <div className="font-semibold text-base-content">Move</div>
                  <div>
                    Move at encumbrance = Basic Move × encumbrance multiplier, rounded down.
                  </div>
                  <div className="num text-base-content/60">
                    × <span className="text-base-content">{e.moveMultiplier}</span> at {e.label}
                  </div>
                </div>
              }
            >
              <span>Move</span>
            </InfoTooltip>
            {equation(d.basicMove, movePenalty, moveNet)}
          </li>
          <li className="flex justify-between gap-2">
            <InfoTooltip
              content={
                <div className="grid gap-1">
                  <div className="font-semibold text-base-content">Dodge</div>
                  <div>Each encumbrance level subtracts 1 from Dodge.</div>
                </div>
              }
            >
              <span>Dodge</span>
            </InfoTooltip>
            {equation(d.dodge, dodgePenaltyAbs, dodgeNet)}
          </li>
        </ul>
      </div>
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

  // Ensure-row + outbox enqueue logic is shared with CombatModal (and
  // future combat surfaces) via useCombatPatch — see that hook for the
  // materialize-default-row rationale.
  const patchCombat = useCombatPatch(character);

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
 * Unspent badge on the right when the campaign defines a point target
 * (the running total lives in the Point Ledger card below).
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
  // a `Points / Target` ratio, and so the Identity panel can offer the
  // full campaign list. This is the online refresher only — see
  // useMirrorCampaigns.ts; the share-gate decision itself is
  // local-first via useCharacterAccessLocal below and does not wait on
  // this REST call.
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api<CampaignSummary[]>('/campaigns'),
    // Always fetch when the user is known so the Identity panel can offer
    // the full campaign list — even for characters not yet in a campaign.
    enabled: !!me.data,
  });

  // Mirror the fetched campaigns into Dexie — see useMirrorCampaigns.ts.
  // The local-first detail builder (useCharacterDetail) reads caps +
  // mana level from `db.campaigns`, so this keeps offline sessions warm.
  useMirrorCampaigns(campaigns.data);

  // Access + share-gate decision, single-sourced (AGENTS.md: never
  // re-derive the share gate ad hoc; see useCharacterAccess.ts). Reads
  // campaign rows from Dexie rather than this REST query so the
  // decision is available offline / on a cold cache. Called before the
  // loading / not-found early returns so hook order stays stable; the
  // hook degrades gracefully while `character` is still loading.
  const access = useCharacterAccessLocal(character, me.data?.id);

  // Lifted to ONE hook instance shared by AttributesPanel,
  // SecondaryModsPanel, and the effects list (see useTempEffects.ts's
  // header comment for why -- calling it once per consumer would give
  // each its own latest-intended-array ref, reintroducing the compose
  // race the ref exists to prevent). Called before the early returns
  // below for the same Rules-of-Hooks reason as `access`; the hook
  // tolerates `character` still being null/undefined.
  const tempEffects = useTempEffects(character, access.canWrite);

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

  // Hold the gate: a non-owner viewing a campaign character whose
  // local Dexie campaigns table hasn't resolved yet must not
  // momentarily see the full sheet before the minimal (share-gated)
  // decision is known. See useCharacterAccessLocal.
  if (access.accessPending) {
    return <p className="text-muted">Loading…</p>;
  }

  const { canWrite, isMinimal, campaign } = access;
  const pointTarget = campaign?.pointTarget ?? null;

  if (isMinimal) {
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

  const powerstoneCount = character.inventory.filter((i) => i.powerstoneData != null).length;
  const magicItemCount = character.inventory.filter((i) => i.magicItemData != null).length;
  const magicTabCount = character.spells.length + powerstoneCount + magicItemCount;
  const counts: CountByTab = {
    Traits: character.traits.length,
    Skills: character.skills.length,
    Magic: magicTabCount,
    Inventory: character.inventory.length,
  };
  // Show the Magic section by default for any caster (Magery present, or
  // already has at least one spell / powerstone / magic item).  Owners
  // without any magic can still tab to it to add their first.
  const showMagicTab = hasMagery(character.traits) || magicTabCount > 0 || canWrite;
  const visibleTabs = showMagicTab ? SHEET_TABS : SHEET_TABS.filter((t) => t !== 'Magic');

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
        <Link to={`/characters/${character.id}/play`} className="btn btn-ghost btn-xs ml-auto">
          <span aria-hidden="true">⚔</span> Play
        </Link>
      </nav>

      <IdentityHero character={character} pointTarget={pointTarget} canWrite={canWrite} />

      <WarningsPanel character={character} canWrite={canWrite} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AttributesPanel character={character} canWrite={canWrite} tempEffects={tempEffects} />
        <SecondaryModsPanel character={character} canWrite={canWrite} tempEffects={tempEffects} />
        <DerivedPanel character={character} />
        <div className="grid grid-cols-1 gap-4">
          <PointsPanel character={character} />
          <EncumbrancePanel character={character} />
        </div>
      </div>

      <div className="panel-tabs">
        {visibleTabs.map((t) => {
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
        {tab === 'Magic' && (
          <div className="space-y-4">
            <SpellsPanel character={character} canWrite={canWrite} />
            <PowerstonesPanel character={character} canWrite={canWrite} />
            <MagicItemsPanel character={character} canWrite={canWrite} />
          </div>
        )}
        {tab === 'Inventory' && <InventoryPanel character={character} canWrite={canWrite} />}
        {tab === 'Notes' && <NotesPanel character={character} canWrite={canWrite} />}
        {tab === 'History' && <HistoryPanel characterId={character.id} />}
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
