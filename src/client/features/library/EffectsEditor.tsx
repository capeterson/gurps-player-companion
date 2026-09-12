import { useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryItemOut } from '../../../shared/schemas/campaignLibrary.ts';
import {
  EFFECT_TARGETS,
  type EffectTarget,
  type TraitEffect,
  WEAPON_EFFECT_TARGETS,
  type WeaponSelector,
  libraryTraitEffect,
  traitEffect,
} from '../../../shared/schemas/effects.ts';
import type { InventoryItemOut } from '../../../shared/schemas/inventory.ts';

const TARGET_LABELS: Record<EffectTarget, string> = {
  st: 'ST',
  dx: 'DX',
  iq: 'IQ',
  ht: 'HT',
  hp: 'HP',
  fp: 'FP',
  will: 'Will',
  per: 'Per',
  basic_speed: 'Basic Speed',
  basic_move: 'Basic Move',
  dodge: 'Dodge',
  parry: 'All Parries',
  block: 'All Blocks',
  dr: 'Damage Resistance',
  fright_check: 'Fright checks',
  skill: 'Skill',
  damage_thrust: 'Thrust damage',
  damage_swing: 'Swing damage',
  weapon_attack: 'Weapon attack',
  weapon_parry: 'Weapon Parry',
  weapon_block: 'Weapon Block',
  weapon_damage: 'Weapon damage',
  weapon_accuracy: 'Weapon Accuracy',
};

interface EffectDraft {
  id: string;
  target: EffectTarget;
  value: string;
  scaling: 'flat' | 'per_level';
  skillName: string;
  skillSpecialty: string;
  hitLocation: string;
  conditionGroup: string;
  conditionLabel: string;
  selector: WeaponSelector | null;
}

function draftFromEffect(effect: TraitEffect): EffectDraft {
  return {
    id: crypto.randomUUID(),
    target: effect.target,
    value: String(effect.value),
    scaling: effect.scaling,
    skillName: effect.skillName ?? '',
    skillSpecialty: effect.skillSpecialty ?? '',
    hitLocation: effect.hitLocation ?? '',
    conditionGroup: effect.conditionGroup ?? '',
    conditionLabel: effect.conditionLabel ?? '',
    selector: effect.weaponSelector ?? null,
  };
}

function defaultDraft(): EffectDraft {
  return {
    id: crypto.randomUUID(),
    target: 'skill',
    value: '1',
    scaling: 'flat',
    skillName: '',
    skillSpecialty: '',
    hitLocation: '',
    conditionGroup: '',
    conditionLabel: '',
    selector: null,
  };
}

function isWeaponTarget(target: EffectTarget): boolean {
  return WEAPON_EFFECT_TARGETS.includes(target as (typeof WEAPON_EFFECT_TARGETS)[number]);
}

function candidateFromDraft(draft: EffectDraft): unknown {
  const value = draft.value.trim() === '' ? Number.NaN : Number(draft.value);
  return {
    target: draft.target,
    value,
    scaling: draft.scaling,
    ...(draft.target === 'skill'
      ? {
          skillName: draft.skillName.trim(),
          ...(draft.skillSpecialty.trim() ? { skillSpecialty: draft.skillSpecialty.trim() } : {}),
        }
      : {}),
    ...(draft.target === 'dr' && draft.hitLocation.trim()
      ? { hitLocation: draft.hitLocation.trim() }
      : {}),
    ...(isWeaponTarget(draft.target) && draft.selector ? { weaponSelector: draft.selector } : {}),
    ...(draft.conditionGroup.trim() ? { conditionGroup: draft.conditionGroup.trim() } : {}),
    ...(draft.conditionLabel.trim() ? { conditionLabel: draft.conditionLabel.trim() } : {}),
  };
}

export function effectPreview(effect: TraitEffect): string {
  const signed = `${effect.value >= 0 ? '+' : ''}${effect.value}`;
  const scale = effect.scaling === 'per_level' ? '/level' : '';
  let target = TARGET_LABELS[effect.target];
  if (effect.target === 'skill') {
    target = `${effect.skillName}${effect.skillSpecialty ? ` (${effect.skillSpecialty})` : ''}`;
  }
  const selector = effect.weaponSelector;
  if (selector) {
    if (selector.kind === 'weapon_skill') {
      target += ` using ${selector.skillName}${selector.skillSpecialty ? ` (${selector.skillSpecialty})` : ''}`;
    } else if (selector.kind === 'weapon_name') target += ` for “${selector.weaponName}”`;
    else if (selector.kind === 'library_item') target += ` for “${selector.libraryItemName}”`;
    else target += ' for selected inventory item';
    if (selector.modeName) target += ` · ${selector.modeName} mode`;
  }
  const condition = effect.conditionLabel ?? effect.conditionGroup;
  return `${signed}${scale} to ${target}${condition ? ` while ${condition}` : ''}`;
}

interface Props<T extends TraitEffect> {
  effects: T[];
  libraryItems?: readonly LibraryItemOut[];
  inventoryItems?: readonly InventoryItemOut[];
  /** Portable editors reject exact character inventory bindings. */
  portable?: boolean;
  onChange: (effects: T[]) => void;
  onValidityChange?: (valid: boolean) => void;
}

/** Reusable, ordered, target-aware editor for library and character-owned mechanics. */
export function EffectsEditor<T extends TraitEffect>({
  effects,
  libraryItems = [],
  inventoryItems = [],
  portable = true,
  onChange,
  onValidityChange,
}: Props<T>) {
  const [drafts, setDrafts] = useState<EffectDraft[]>(() => effects.map(draftFromEffect));
  const [errors, setErrors] = useState<string[][]>(() => effects.map(() => []));
  const externalKey = JSON.stringify(effects);
  const lastPublishedKey = useRef(externalKey);
  const weaponItems = useMemo(
    () => libraryItems.filter((item) => item.weaponData != null),
    [libraryItems],
  );
  const inventoryWeapons = useMemo(
    () => inventoryItems.filter((item) => item.weaponData != null),
    [inventoryItems],
  );

  // A server rollback/refetch may replace the controlled value. Preserve
  // in-progress invalid drafts while the parent value is unchanged, but
  // rebuild when a genuinely external value arrives.
  useEffect(() => {
    if (externalKey === lastPublishedKey.current) return;
    setDrafts(effects.map(draftFromEffect));
    setErrors(effects.map(() => []));
    lastPublishedKey.current = externalKey;
    onValidityChange?.(true);
  }, [effects, externalKey, onValidityChange]);

  function publish(next: EffectDraft[]) {
    setDrafts(next);
    const schema = portable ? libraryTraitEffect : traitEffect;
    const parsed = next.map((draft) => schema.safeParse(candidateFromDraft(draft)));
    setErrors(
      parsed.map((result) =>
        result.success
          ? []
          : result.error.issues.map(
              (issue) => `${issue.path.join('.') || 'effect'}: ${issue.message}`,
            ),
      ),
    );
    const valid = parsed.every((result) => result.success);
    onValidityChange?.(valid);
    if (valid) {
      const value = parsed.map((result) => (result as unknown as { data: T }).data);
      lastPublishedKey.current = JSON.stringify(value);
      onChange(value);
    }
  }

  function update(index: number, mutate: (draft: EffectDraft) => EffectDraft) {
    publish(drafts.map((draft, i) => (i === index ? mutate(draft) : draft)));
  }

  function changeTarget(index: number, target: EffectTarget) {
    update(index, (draft) => {
      let selector = isWeaponTarget(target)
        ? (draft.selector ?? { kind: 'weapon_skill' as const, skillName: '' })
        : null;
      // Parry/Block are item-level defenses. Clear a now-hidden attack mode
      // immediately so changing target never strands an invalid hidden value.
      if ((target === 'weapon_parry' || target === 'weapon_block') && selector?.modeName) {
        const { modeName: _modeName, ...itemSelector } = selector;
        selector = itemSelector as WeaponSelector;
      }
      return {
        ...draft,
        target,
        skillName: target === 'skill' ? draft.skillName : '',
        skillSpecialty: target === 'skill' ? draft.skillSpecialty : '',
        hitLocation: target === 'dr' ? draft.hitLocation : '',
        selector,
      };
    });
  }

  function changeSelectorKind(index: number, kind: WeaponSelector['kind']) {
    update(index, (draft) => ({
      ...draft,
      selector:
        kind === 'weapon_skill'
          ? {
              kind,
              skillName: '',
              ...(draft.selector?.modeName ? { modeName: draft.selector.modeName } : {}),
            }
          : kind === 'weapon_name'
            ? {
                kind,
                weaponName: '',
                ...(draft.selector?.modeName ? { modeName: draft.selector.modeName } : {}),
              }
            : kind === 'inventory_item'
              ? {
                  kind,
                  inventoryItemId: '',
                  ...(draft.selector?.modeName ? { modeName: draft.selector.modeName } : {}),
                }
              : {
                  kind,
                  libraryItemId: weaponItems[0]?.id,
                  libraryItemName: weaponItems[0]?.name ?? '',
                  ...(draft.selector?.modeName ? { modeName: draft.selector.modeName } : {}),
                },
    }));
  }

  return (
    <fieldset className="space-y-2 rounded-lg border border-base-300 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <legend className="label-text font-semibold">Mechanical effects</legend>
          <p className="text-xs text-base-content/60">
            Ordered bonuses {portable ? 'copied with this definition' : 'owned by this trait'}.
            Skill and weapon matching is exact;
            <code className="mx-1">*</code> is an explicit wildcard.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs shrink-0"
          onClick={() => publish([...drafts, defaultDraft()])}
        >
          + Add effect
        </button>
      </div>

      {drafts.length === 0 && (
        <p className="rounded bg-base-200/60 p-2 text-xs text-base-content/60">
          No mechanical effects. Add one for stat, skill, defense, DR, damage, or weapon bonuses.
        </p>
      )}

      {drafts.map((draft, index) => {
        const selector = draft.selector;
        return (
          <div key={draft.id} className="space-y-2 rounded-lg bg-base-200/60 p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(9rem,1fr)_6rem_8rem_auto]">
              <label className="form-control">
                <span className="label-text text-xs">Target</span>
                <select
                  aria-label={`Effect ${index + 1} target`}
                  className="select select-bordered select-sm"
                  value={draft.target}
                  onChange={(event) => changeTarget(index, event.target.value as EffectTarget)}
                >
                  {EFFECT_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {TARGET_LABELS[target]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text text-xs">Bonus</span>
                <input
                  aria-label={`Effect ${index + 1} bonus`}
                  className="input input-bordered input-sm num"
                  inputMode="numeric"
                  value={draft.value}
                  onChange={(event) =>
                    update(index, (row) => ({ ...row, value: event.target.value }))
                  }
                />
              </label>
              <label className="form-control">
                <span className="label-text text-xs">Scaling</span>
                <select
                  className="select select-bordered select-sm"
                  value={draft.scaling}
                  onChange={(event) =>
                    update(index, (row) => ({
                      ...row,
                      scaling: event.target.value as EffectDraft['scaling'],
                    }))
                  }
                >
                  <option value="flat">Flat</option>
                  <option value="per_level">Per level</option>
                </select>
              </label>
              <div className="flex items-end justify-end gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label={`Move effect ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => {
                    const next = [...drafts];
                    const previous = next[index - 1];
                    const current = next[index];
                    if (!previous || !current) return;
                    next[index - 1] = current;
                    next[index] = previous;
                    publish(next);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  aria-label={`Move effect ${index + 1} down`}
                  disabled={index === drafts.length - 1}
                  onClick={() => {
                    const next = [...drafts];
                    const current = next[index];
                    const following = next[index + 1];
                    if (!current || !following) return;
                    next[index] = following;
                    next[index + 1] = current;
                    publish(next);
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() =>
                    publish([
                      ...drafts,
                      {
                        ...draft,
                        id: crypto.randomUUID(),
                        selector: selector ? { ...selector } : null,
                      },
                    ])
                  }
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => publish(drafts.filter((_, i) => i !== index))}
                >
                  Delete
                </button>
              </div>
            </div>

            {draft.target === 'skill' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text text-xs">Skill name *</span>
                  <input
                    className="input input-bordered input-sm"
                    value={draft.skillName}
                    placeholder="Public Speaking or *"
                    onChange={(event) =>
                      update(index, (row) => ({ ...row, skillName: event.target.value }))
                    }
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">Specialty (optional)</span>
                  <input
                    className="input input-bordered input-sm"
                    value={draft.skillSpecialty}
                    placeholder="Pistol or *"
                    onChange={(event) =>
                      update(index, (row) => ({ ...row, skillSpecialty: event.target.value }))
                    }
                  />
                </label>
              </div>
            )}

            {draft.target === 'dr' && (
              <label className="form-control max-w-xs">
                <span className="label-text text-xs">Hit location (optional)</span>
                <input
                  className="input input-bordered input-sm"
                  value={draft.hitLocation}
                  placeholder="torso"
                  onChange={(event) =>
                    update(index, (row) => ({ ...row, hitLocation: event.target.value }))
                  }
                />
              </label>
            )}

            {isWeaponTarget(draft.target) && selector && (
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="form-control">
                  <span className="label-text text-xs">Match weapon by</span>
                  <select
                    className="select select-bordered select-sm"
                    value={selector.kind}
                    onChange={(event) =>
                      changeSelectorKind(index, event.target.value as WeaponSelector['kind'])
                    }
                  >
                    <option value="weapon_skill">Governing skill</option>
                    <option value="weapon_name">Exact weapon name</option>
                    <option value="library_item">Library item</option>
                    {!portable && <option value="inventory_item">This inventory item</option>}
                  </select>
                </label>
                {selector.kind === 'weapon_skill' && (
                  <>
                    <label className="form-control">
                      <span className="label-text text-xs">Governing skill *</span>
                      <input
                        className="input input-bordered input-sm"
                        value={selector.skillName}
                        placeholder="Broadsword"
                        onChange={(event) =>
                          update(index, (row) => ({
                            ...row,
                            selector: { ...selector, skillName: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text text-xs">Specialty (optional)</span>
                      <input
                        className="input input-bordered input-sm"
                        value={selector.skillSpecialty ?? ''}
                        placeholder="Pistol or *"
                        onChange={(event) =>
                          update(index, (row) => ({
                            ...row,
                            selector: {
                              ...selector,
                              skillSpecialty: event.target.value || undefined,
                            },
                          }))
                        }
                      />
                    </label>
                  </>
                )}
                {selector.kind === 'weapon_name' && (
                  <label className="form-control sm:col-span-2">
                    <span className="label-text text-xs">Exact normalized name *</span>
                    <input
                      className="input input-bordered input-sm"
                      value={selector.weaponName}
                      placeholder="Broadsword"
                      onChange={(event) =>
                        update(index, (row) => ({
                          ...row,
                          selector: { ...selector, weaponName: event.target.value },
                        }))
                      }
                    />
                  </label>
                )}
                {selector.kind === 'library_item' && (
                  <label className="form-control sm:col-span-2">
                    <span className="label-text text-xs">Weapon definition *</span>
                    <select
                      className="select select-bordered select-sm"
                      value={selector.libraryItemId ?? ''}
                      onChange={(event) => {
                        const item = weaponItems.find(
                          (candidate) => candidate.id === event.target.value,
                        );
                        update(index, (row) => ({
                          ...row,
                          selector: {
                            ...selector,
                            libraryItemId: item?.id,
                            libraryItemName: item?.name ?? '',
                          },
                        }));
                      }}
                    >
                      <option value="">Select a library weapon…</option>
                      {weaponItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selector.kind === 'inventory_item' && (
                  <label className="form-control sm:col-span-2">
                    <span className="label-text text-xs">Inventory weapon *</span>
                    <select
                      className="select select-bordered select-sm"
                      value={selector.inventoryItemId}
                      onChange={(event) =>
                        update(index, (row) => ({
                          ...row,
                          selector: { ...selector, inventoryItemId: event.target.value },
                        }))
                      }
                    >
                      <option value="">Select an inventory weapon…</option>
                      {inventoryWeapons.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.equipped ? '' : ' (unequipped)'}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {draft.target !== 'weapon_parry' && draft.target !== 'weapon_block' && (
                  <label className="form-control sm:col-span-3">
                    <span className="label-text text-xs">Attack mode (optional, exact)</span>
                    <input
                      className="input input-bordered input-sm"
                      value={selector.modeName ?? ''}
                      placeholder="Primary or exact alternate mode; blank applies to every mode"
                      onChange={(event) =>
                        update(index, (row) => ({
                          ...row,
                          selector: { ...selector, modeName: event.target.value || undefined },
                        }))
                      }
                    />
                  </label>
                )}
              </div>
            )}

            <details>
              <summary className="cursor-pointer text-xs text-base-content/70">Condition</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text text-xs">Group key</span>
                  <input
                    className="input input-bordered input-sm"
                    value={draft.conditionGroup}
                    placeholder="vs_fear"
                    onChange={(event) =>
                      update(index, (row) => ({ ...row, conditionGroup: event.target.value }))
                    }
                  />
                </label>
                <label className="form-control">
                  <span className="label-text text-xs">Player-facing label</span>
                  <input
                    className="input input-bordered input-sm"
                    value={draft.conditionLabel}
                    placeholder="Against fear"
                    onChange={(event) =>
                      update(index, (row) => ({ ...row, conditionLabel: event.target.value }))
                    }
                  />
                </label>
              </div>
            </details>

            {errors[index]?.length ? (
              <ul className="text-xs text-error" aria-label={`Effect ${index + 1} errors`}>
                {errors[index]?.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-base-content/70">
                {(() => {
                  const parsed = (portable ? libraryTraitEffect : traitEffect).safeParse(
                    candidateFromDraft(draft),
                  );
                  return parsed.success ? effectPreview(parsed.data) : '';
                })()}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
