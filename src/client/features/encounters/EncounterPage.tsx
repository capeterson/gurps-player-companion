import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { COMMON_CONDITIONS } from '../../../shared/constants/combat.ts';
import { EFFECT_TEMPLATES } from '../../../shared/constants/effectTemplates.ts';
import { parseSpellDurationText } from '../../../shared/domain/effectDuration.ts';
import {
  effectRemainingLabel,
  isEffectExpired,
  needsMaintenance,
} from '../../../shared/domain/encounterEffects.ts';
import type { CampaignOut } from '../../../shared/schemas/campaign.ts';
import type {
  CombatantCreate,
  CombatantUpdate,
  EffectCreate,
  EffectDuration,
  EffectUpdate,
  EncounterOut,
} from '../../../shared/schemas/encounter.ts';
import { type LocalCharacter, type LocalCharacterSpell, getLocalDb } from '../../db/dexie.ts';
import { api } from '../../lib/api.ts';
import { useToasts } from '../../lib/toast.tsx';
import { useCampaignCharactersList } from '../characters/useCharacterDetail.ts';
import { PlayerCharacterQuickActions } from './PlayerCharacterQuickActions.tsx';
import { cleanupLinkedSheetEffect } from './effectSheetCleanup.ts';
import { encounterKeys, encountersApi } from './encountersApi.ts';
import { useEncounter } from './useEncounters.ts';

function problem(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}

type Effect = EncounterOut['effects'][number];
type Combatant = EncounterOut['combatants'][number];

interface NpcHpIntent {
  value: number;
  committedValue: number;
  inFlight: boolean;
}

function orderKeyForMove(combatants: readonly Combatant[], index: number, direction: -1 | 1) {
  const current = combatants[index];
  const neighbor = combatants[index + direction];
  if (!current) return null;
  if (!neighbor) return current.orderKey + direction * 10;
  const outer = combatants[index + direction * 2];
  return outer ? (neighbor.orderKey + outer.orderKey) / 2 : neighbor.orderKey + direction * 10;
}

export function EncounterPage() {
  const { id = '', encounterId = '' } = useParams<{ id: string; encounterId: string }>();
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [npcName, setNpcName] = useState('');
  const [npcHp, setNpcHp] = useState('10');
  const [pcCharacterId, setPcCharacterId] = useState('');
  const [editingNpc, setEditingNpc] = useState<Combatant | null | undefined>(undefined);
  const [editingEffect, setEditingEffect] = useState<Effect | null | undefined>(undefined);
  const encounter = useEncounter(id, encounterId);
  const npcHpIntents = useRef(new Map<string, NpcHpIntent>());
  const campaign = useQuery({
    queryKey: ['campaigns', id],
    queryFn: () => api<CampaignOut>(`/campaigns/${id}`),
    enabled: !!id,
  });
  const roster = useCampaignCharactersList(id || undefined);
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: () => api<{ id: string }>('/auth/me') });
  const membership = campaign.data?.members.find((member) => member.userId === me.data?.id);
  const canManage = campaign.data
    ? me.data?.id === campaign.data.ownerId || membership?.role === 'manager'
    : false;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: encounterKeys.detail(id, encounterId) });
    void queryClient.invalidateQueries({ queryKey: encounterKeys.list(id) });
  };
  const mutation = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (error) => toasts.push(problem(error), { kind: 'error' }),
  });

  // Encounter mutations are online-only. Keep the latest intended HP per NPC
  // until its serialized requests settle so a refetch cannot lose a rapid tap.
  useEffect(() => {
    for (const combatant of encounter.data?.combatants ?? []) {
      if (combatant.kind !== 'npc') continue;
      const hp = combatant.currentHp ?? 0;
      const intent = npcHpIntents.current.get(combatant.id);
      if (!intent || !intent.inFlight)
        npcHpIntents.current.set(combatant.id, {
          value: hp,
          committedValue: hp,
          inFlight: false,
        });
    }
  }, [encounter.data?.combatants]);

  const decrementNpcHp = (combatant: Combatant) => {
    if (combatant.kind !== 'npc') return;
    const existingIntent = npcHpIntents.current.get(combatant.id);
    const hp = combatant.currentHp ?? 0;
    const intent = existingIntent ?? { value: hp, committedValue: hp, inFlight: false };
    if (!existingIntent) npcHpIntents.current.set(combatant.id, intent);
    // GURPS tracks HP below zero for knockdown/death checks, so damage is not
    // clamped at zero here; the schema and detailed editor already allow it.
    intent.value = intent.value - 1;
    if (intent.inFlight) return;

    const save = async () => {
      const sent = intent.value;
      intent.inFlight = true;
      try {
        await encountersApi.updateCombatant(id, encounterId, combatant.id, { currentHp: sent });
        intent.committedValue = sent;
        refresh();
      } catch (error) {
        toasts.push(problem(error), { kind: 'error' });
        if (intent.value === sent) intent.value = intent.committedValue;
      } finally {
        if (intent.value !== sent) {
          void save();
        } else {
          intent.inFlight = false;
        }
      }
    };
    void save();
  };
  if (!id || !encounterId) return <p className="alert alert-error">Missing encounter.</p>;
  if (encounter.isLoading || campaign.isLoading)
    return <p className="text-sm text-base-content/60">Loading encounter...</p>;
  if (!encounter.data)
    return (
      <p className="alert alert-error">{problem(encounter.error) || 'Encounter not found.'}</p>
    );
  const data = encounter.data;
  const activeName =
    data.combatants.find((row) => row.id === data.activeCombatantId)?.name ?? 'No active combatant';
  const createNpc = () => {
    const maxHp = Number(npcHp);
    if (!npcName.trim() || !Number.isInteger(maxHp) || maxHp < 1)
      return toasts.push('NPC needs a name and positive HP', { kind: 'error' });
    mutation.mutate(() =>
      encountersApi.createCombatant(id, encounterId, {
        kind: 'npc',
        name: npcName.trim(),
        basicSpeed: 5,
        dx: 10,
        maxHp,
      }),
    );
    setNpcName('');
  };
  const addPc = () => {
    if (!pcCharacterId) return;
    mutation.mutate(() =>
      encountersApi.createCombatant(id, encounterId, { kind: 'pc', characterId: pcCharacterId }),
    );
    setPcCharacterId('');
  };
  const cleanup = async (effect: Effect) =>
    cleanupLinkedSheetEffect(
      effect,
      data.combatants.find((row) => row.id === effect.targetCombatantId),
      {
        viewerId: me.data?.id,
        isStaff: canManage,
        allowGmCharacterEditing: campaign.data?.allowGmCharacterEditing ?? false,
      },
    );
  const removeEffect = (effect: Effect, label = 'Remove') => {
    if (!window.confirm(`${label} ${effect.name}? Linked sheet effects will be cleared.`)) return;
    mutation.mutate(async () => {
      await encountersApi.deleteEffect(id, encounterId, effect.id);
      await cleanup(effect);
    });
  };
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 card border border-base-300 p-4">
        <div>
          <Link to={`/campaigns/${id}`} className="label-eyebrow link">
            ← Campaign
          </Link>
          <h1 className="font-display text-3xl">{data.name}</h1>
          <p className="text-sm text-base-content/60">
            Round {data.round} · {activeName}
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            {data.status === 'active' && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate(() =>
                      encountersApi.advance(id, encounterId, {
                        direction: 'previous',
                        expectedRound: data.round,
                        expectedActiveCombatantId: data.activeCombatantId,
                        expectedVersion: data.version,
                      }),
                    )
                  }
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate(() =>
                      encountersApi.advance(id, encounterId, {
                        direction: 'next',
                        expectedRound: data.round,
                        expectedActiveCombatantId: data.activeCombatantId,
                        expectedVersion: data.version,
                      }),
                    )
                  }
                >
                  Next turn
                </button>
              </>
            )}
            {data.status === 'active' && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={mutation.isPending}
                onClick={() => {
                  if (window.confirm('End this combat?'))
                    mutation.mutate(() =>
                      encountersApi.update(id, encounterId, { status: 'ended' }),
                    );
                }}
              >
                End combat
              </button>
            )}
          </div>
        ) : (
          <span className="chip">Player view</span>
        )}
      </header>
      {data.status === 'ended' && (
        <section className="card border border-base-300 p-4">
          <h2 className="font-semibold">Combat ended</h2>
          <p className="text-sm text-base-content/70">
            Ended {data.endedAt ? new Date(data.endedAt).toLocaleString() : 'just now'} at round{' '}
            {data.round} with {data.combatants.length} combatants.
          </p>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Initiative</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.combatants.map((combatant, index) => (
            <article
              key={combatant.id}
              className={`card border p-3 ${combatant.id === data.activeCombatantId ? 'border-primary bg-primary/10' : 'border-base-300'}`}
            >
              <div className="flex justify-between gap-2">
                <strong>{combatant.name}</strong>
                {combatant.id === data.activeCombatantId && (
                  <span className="badge badge-primary">Acting</span>
                )}
              </div>
              <p className="text-sm text-base-content/70">
                HP {combatant.currentHp ?? '—'} / {combatant.maxHp ?? '—'} · Move{' '}
                {combatant.move ?? '—'} · Dodge {combatant.dodge ?? '—'}
              </p>
              {canManage && combatant.kind === 'npc' && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => decrementNpcHp(combatant)}
                  >
                    HP -1
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => setEditingNpc(combatant)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() =>
                      mutation.mutate(() =>
                        encountersApi.deleteCombatant(id, encounterId, combatant.id),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              )}
              {canManage && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={index === 0 || mutation.isPending}
                    onClick={() => {
                      const orderKey = orderKeyForMove(data.combatants, index, -1);
                      if (orderKey != null)
                        mutation.mutate(() =>
                          encountersApi.updateCombatant(id, encounterId, combatant.id, {
                            orderKey,
                          }),
                        );
                    }}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={index === data.combatants.length - 1 || mutation.isPending}
                    onClick={() => {
                      const orderKey = orderKeyForMove(data.combatants, index, 1);
                      if (orderKey != null)
                        mutation.mutate(() =>
                          encountersApi.updateCombatant(id, encounterId, combatant.id, {
                            orderKey,
                          }),
                        );
                    }}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={index === data.combatants.length - 1 || mutation.isPending}
                    onClick={() =>
                      mutation.mutate(() =>
                        encountersApi.updateCombatant(id, encounterId, combatant.id, {
                          orderKey: (data.combatants.at(-1)?.orderKey ?? 0) + 10,
                        }),
                      )
                    }
                  >
                    Wait
                  </button>
                </div>
              )}
              {combatant.kind === 'pc' && (
                <PlayerCharacterQuickActions
                  characterId={combatant.characterId}
                  meId={me.data?.id}
                />
              )}
            </article>
          ))}
        </div>
      </section>
      {canManage && (
        <section className="card border border-base-300 p-4">
          <h2 className="font-semibold">Add combatant</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              aria-label="Campaign PC"
              className="select select-bordered select-sm"
              value={pcCharacterId}
              onChange={(event) => setPcCharacterId(event.target.value)}
            >
              <option value="">Choose PC from campaign roster</option>
              {(roster ?? [])
                .filter(
                  (character) =>
                    !data.combatants.some((combatant) => combatant.characterId === character.id),
                )
                .map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={addPc}>
              Add PC
            </button>
          </div>
          <h3 className="mt-4 text-sm font-semibold">Add NPC</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              aria-label="NPC name"
              className="input input-bordered input-sm"
              value={npcName}
              onChange={(event) => setNpcName(event.target.value)}
              placeholder="Name"
            />
            <input
              aria-label="NPC max HP"
              className="input input-bordered input-sm w-24"
              type="number"
              value={npcHp}
              onChange={(event) => setNpcHp(event.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={createNpc}>
              Add NPC
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditingNpc(null)}
            >
              Detailed NPC
            </button>
          </div>
        </section>
      )}
      {editingNpc !== undefined && (
        <NpcDialog
          combatant={editingNpc}
          onClose={() => setEditingNpc(undefined)}
          onSave={(body) =>
            mutation.mutate(
              () =>
                editingNpc
                  ? encountersApi.updateCombatant(
                      id,
                      encounterId,
                      editingNpc.id,
                      body as CombatantUpdate,
                    )
                  : encountersApi.createCombatant(id, encounterId, body as CombatantCreate),
              { onSuccess: () => setEditingNpc(undefined) },
            )
          }
        />
      )}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Effects</h2>
          {canManage && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setEditingEffect(null)}
            >
              Add effect
            </button>
          )}
        </div>
        {data.effects.length === 0 && (
          <p className="text-sm text-base-content/60">No active effects.</p>
        )}
        {data.effects.map((effect) => (
          <EffectRow
            key={effect.id}
            effect={effect}
            round={data.round}
            canManage={canManage}
            onEdit={() => setEditingEffect(effect)}
            onMaintain={() =>
              mutation.mutate(() =>
                encountersApi.updateEffect(id, encounterId, effect.id, {
                  lastMaintainedRound: data.round,
                }),
              )
            }
            onAcknowledge={() => {
              if (
                !window.confirm(
                  `Acknowledge expiry for ${effect.name} and clear linked sheet effects?`,
                )
              )
                return;
              mutation.mutate(async () => {
                await encountersApi.updateEffect(id, encounterId, effect.id, {
                  expiryAcknowledgedAtRound: data.round,
                });
                await cleanup(effect);
              });
            }}
            onRemove={() => removeEffect(effect)}
          />
        ))}
      </section>
      {editingEffect !== undefined && (
        <EffectDialog
          encounter={data}
          effect={editingEffect}
          onClose={() => setEditingEffect(undefined)}
          onSave={(body) =>
            mutation.mutate(
              async () => {
                if (editingEffect)
                  return encountersApi.updateEffect(
                    id,
                    encounterId,
                    editingEffect.id,
                    body as EffectUpdate,
                  );
                return encountersApi.createEffect(id, encounterId, body as EffectCreate);
              },
              { onSuccess: () => setEditingEffect(undefined) },
            )
          }
        />
      )}
    </div>
  );
}

function NpcDialog({
  combatant,
  onClose,
  onSave,
}: {
  combatant: Combatant | null;
  onClose(): void;
  onSave(body: CombatantCreate | CombatantUpdate): void;
}) {
  const [name, setName] = useState(combatant?.name ?? '');
  const [basicSpeed, setBasicSpeed] = useState(String(combatant?.basicSpeed ?? 5));
  const [dx, setDx] = useState(String(combatant?.dx ?? 10));
  const [maxHp, setMaxHp] = useState(String(combatant?.maxHp ?? 10));
  const [currentHp, setCurrentHp] = useState(String(combatant?.currentHp ?? 10));
  const [move, setMove] = useState(combatant?.move == null ? '' : String(combatant.move));
  const [dodge, setDodge] = useState(combatant?.dodge == null ? '' : String(combatant.dodge));
  const [dr, setDr] = useState(combatant?.dr == null ? '' : String(combatant.dr));
  const [maneuver, setManeuver] = useState(combatant?.maneuver ?? '');
  const [conditions, setConditions] = useState((combatant?.conditions ?? []).join(', '));
  const [hiddenFromPlayers, setHidden] = useState(combatant?.hiddenFromPlayers ?? false);
  const [active, setActive] = useState(combatant?.active ?? true);
  const [notes, setNotes] = useState(combatant?.notes ?? '');
  const optionalNumber = (value: string) => (value.trim() === '' ? null : Number(value));
  const submit = () => {
    const values = {
      name: name.trim(),
      basicSpeed: Number(basicSpeed),
      dx: Number(dx),
      maxHp: Number(maxHp),
      currentHp: Number(currentHp),
      move: optionalNumber(move),
      dodge: optionalNumber(dodge),
      dr: optionalNumber(dr),
      maneuver: maneuver.trim() || null,
      conditions: conditions
        .split(',')
        .map((condition) => condition.trim())
        .filter(Boolean),
      hiddenFromPlayers,
      active,
      notes: notes.trim() || null,
    };
    if (
      !values.name ||
      !Number.isFinite(values.basicSpeed) ||
      !Number.isInteger(values.dx) ||
      !Number.isInteger(values.maxHp) ||
      values.maxHp < 1 ||
      !Number.isInteger(values.currentHp) ||
      [values.move, values.dodge, values.dr].some(
        (value) => value !== null && !Number.isInteger(value),
      )
    )
      return;
    onSave(
      combatant
        ? values
        : {
            kind: 'npc',
            ...values,
            maneuver: values.maneuver ?? undefined,
            notes: values.notes ?? undefined,
            move: values.move ?? undefined,
            dodge: values.dodge ?? undefined,
            dr: values.dr ?? undefined,
          },
    );
  };
  const numberField = (label: string, value: string, setValue: (value: string) => void) => (
    <label className="form-control">
      <span className="label-text">{label}</span>
      <input
        aria-label={label}
        className="input input-bordered"
        type="number"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </label>
  );
  return (
    <dialog open className="modal">
      <div className="modal-box max-w-2xl">
        <h3 className="font-display text-2xl">{combatant ? 'Edit NPC' : 'Add NPC'}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="form-control sm:col-span-3">
            <span className="label-text">Name</span>
            <input
              aria-label="NPC name"
              className="input input-bordered"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {numberField('Basic Speed', basicSpeed, setBasicSpeed)}
          {numberField('DX', dx, setDx)}
          {numberField('Max HP', maxHp, setMaxHp)}
          {numberField('Current HP', currentHp, setCurrentHp)}
          {numberField('Move', move, setMove)}
          {numberField('Dodge', dodge, setDodge)}
          {numberField('DR', dr, setDr)}
          <label className="form-control">
            <span className="label-text">Maneuver</span>
            <input
              aria-label="NPC maneuver"
              className="input input-bordered"
              value={maneuver}
              onChange={(event) => setManeuver(event.target.value)}
            />
          </label>
          <label className="form-control sm:col-span-3">
            <span className="label-text">Conditions (comma-separated)</span>
            <input
              aria-label="NPC conditions"
              className="input input-bordered"
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
            />
          </label>
          <label className="label cursor-pointer justify-start gap-2">
            <input
              className="checkbox"
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span className="label-text">Active in turn order</span>
          </label>
          <label className="label cursor-pointer justify-start gap-2">
            <input
              className="checkbox"
              type="checkbox"
              checked={hiddenFromPlayers}
              onChange={(event) => setHidden(event.target.checked)}
            />
            <span className="label-text">Hidden from players</span>
          </label>
        </div>
        <label className="form-control mt-3">
          <span className="label-text">Notes</span>
          <textarea
            aria-label="NPC notes"
            className="textarea textarea-bordered"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {combatant ? 'Save NPC' : 'Add NPC'}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

function EffectRow({
  effect,
  round,
  canManage,
  onEdit,
  onMaintain,
  onAcknowledge,
  onRemove,
}: {
  effect: Effect;
  round: number;
  canManage: boolean;
  onEdit(): void;
  onMaintain(): void;
  onAcknowledge(): void;
  onRemove(): void;
}) {
  const expired = isEffectExpired(effect.duration, effect.startedAtRound, round);
  const maintenance = needsMaintenance(
    effect.maintenanceCost,
    effect.lastMaintainedRound,
    effect.startedAtRound,
    round,
  );
  return (
    <article className={`card border p-3 ${expired ? 'border-warning' : 'border-base-300'}`}>
      <strong>{effect.name}</strong>
      <p className="text-sm text-base-content/70">
        {effectRemainingLabel(effect.duration, effect.startedAtRound, round)} · started round{' '}
        {effect.startedAtRound}
        {effect.maintenanceCost != null && ` · maintain ${effect.maintenanceCost} FP/min`}
      </p>
      {expired && effect.expiryAcknowledgedAtRound === null && (
        <p className="text-warning text-sm">Expired: resolve or acknowledge this effect.</p>
      )}
      {maintenance && (
        <p className="text-warning text-sm">Maintenance due ({effect.maintenanceCost} FP).</p>
      )}
      {canManage && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn btn-xs" onClick={onEdit}>
            Edit
          </button>
          {maintenance && (
            <button type="button" className="btn btn-xs" onClick={onMaintain}>
              Maintain
            </button>
          )}
          {expired && (
            <button type="button" className="btn btn-xs" onClick={onAcknowledge}>
              Acknowledge expiry
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-xs" onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </article>
  );
}

function EffectDialog({
  encounter,
  effect,
  onClose,
  onSave,
}: {
  encounter: EncounterOut;
  effect: Effect | null;
  onClose(): void;
  onSave(body: EffectCreate | EffectUpdate): void;
}) {
  const [name, setName] = useState(effect?.name ?? '');
  const [targetCombatantId, setTarget] = useState(effect?.targetCombatantId ?? '');
  const [casterCombatantId, setCaster] = useState(effect?.casterCombatantId ?? '');
  const [unit, setUnit] = useState<EffectDuration['unit']>(effect?.duration.unit ?? 'rounds');
  const [amount, setAmount] = useState(
    String(effect?.duration.unit === 'indefinite' ? 1 : (effect?.duration.amount ?? 1)),
  );
  const [maintenance, setMaintenance] = useState(
    effect?.maintenanceCost == null ? '' : String(effect.maintenanceCost),
  );
  const [linkedCondition, setCondition] = useState(effect?.linkedCondition ?? '');
  const [linkedTempEffectId, setTempEffect] = useState(effect?.linkedTempEffectId ?? '');
  const [notes, setNotes] = useState(effect?.notes ?? '');
  const casterCharacterId = encounter.combatants.find(
    (row) => row.id === casterCombatantId,
  )?.characterId;
  const targetCharacterId = encounter.combatants.find(
    (row) => row.id === targetCombatantId,
  )?.characterId;
  const db = getLocalDb();
  const spells =
    useLiveQuery<LocalCharacterSpell[]>(async () => {
      if (!casterCharacterId) return [];
      return db.characterSpells.where('characterId').equals(casterCharacterId).toArray();
    }, [casterCharacterId]) ?? [];
  const target = useLiveQuery<LocalCharacter | undefined>(async () => {
    if (!targetCharacterId) return undefined;
    return db.characters.get(targetCharacterId);
  }, [targetCharacterId]);
  const applyTemplate = (id: string) => {
    const template = EFFECT_TEMPLATES.find((entry) => entry.id === id);
    if (!template) return;
    setName(template.name);
    setUnit(template.duration.unit);
    setAmount(String(template.duration.unit === 'indefinite' ? 1 : template.duration.amount));
    setCondition(template.linkedCondition ?? '');
  };
  const applySpell = (spellId: string) => {
    const spell = spells.find((entry) => entry.id === spellId);
    if (!spell) return;
    setName(spell.name);
    setMaintenance(spell.maintenanceCost == null ? '' : String(spell.maintenanceCost));
    const parsed = spell.duration ? parseSpellDurationText(spell.duration) : null;
    if (parsed) {
      setUnit(parsed.unit);
      setAmount(String(parsed.unit === 'indefinite' ? 1 : parsed.amount));
    }
  };
  const submit = () => {
    const n = Number(amount);
    if (
      !name.trim() ||
      !targetCombatantId ||
      (unit !== 'indefinite' && (!Number.isInteger(n) || n < 1))
    )
      return;
    const duration: EffectDuration = unit === 'indefinite' ? { unit } : { unit, amount: n };
    const upkeep = maintenance.trim() === '' ? null : Number(maintenance);
    if (upkeep !== null && (!Number.isInteger(upkeep) || upkeep < 0)) return;
    const body: EffectUpdate = {
      name: name.trim(),
      duration,
      casterCombatantId: casterCombatantId || null,
      maintenanceCost: upkeep,
      linkedCondition: linkedCondition || null,
      linkedTempEffectId: linkedTempEffectId || null,
      notes: notes.trim() || null,
    };
    const createBody: EffectCreate = {
      targetCombatantId,
      name: name.trim(),
      duration,
      ...(casterCombatantId && { casterCombatantId }),
      ...(upkeep !== null && { maintenanceCost: upkeep }),
      ...(linkedCondition && { linkedCondition }),
      ...(linkedTempEffectId && { linkedTempEffectId }),
      ...(notes.trim() && { notes: notes.trim() }),
    };
    onSave(effect ? body : createBody);
  };
  return (
    <dialog open className="modal">
      <div className="modal-box max-w-xl">
        <h3 className="font-display text-2xl">{effect ? 'Edit effect' : 'Add effect'}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="form-control">
            <span className="label-text">Template</span>
            <select
              className="select select-bordered"
              defaultValue=""
              onChange={(event) => applyTemplate(event.target.value)}
            >
              <option value="">Manual</option>
              {EFFECT_TEMPLATES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text">Known spell prefill</span>
            <select
              className="select select-bordered"
              defaultValue=""
              disabled={!casterCharacterId}
              onChange={(event) => applySpell(event.target.value)}
            >
              <option value="">Select a caster first</option>
              {spells.map((spell) => (
                <option key={spell.id} value={spell.id}>
                  {spell.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text">Name</span>
            <input
              className="input input-bordered"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {!effect && (
            <label className="form-control">
              <span className="label-text">Target</span>
              <select
                className="select select-bordered"
                value={targetCombatantId}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Choose target</option>
                {encounter.combatants.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="form-control">
            <span className="label-text">Caster</span>
            <select
              className="select select-bordered"
              value={casterCombatantId}
              onChange={(event) => setCaster(event.target.value)}
            >
              <option value="">None</option>
              {encounter.combatants.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text">Duration</span>
            <select
              className="select select-bordered"
              value={unit}
              onChange={(event) => setUnit(event.target.value as EffectDuration['unit'])}
            >
              <option value="rounds">Rounds</option>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="indefinite">Until removed</option>
            </select>
          </label>
          {unit !== 'indefinite' && (
            <label className="form-control">
              <span className="label-text">Amount</span>
              <input
                className="input input-bordered"
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          )}
          <label className="form-control">
            <span className="label-text">Maintenance FP/min</span>
            <input
              className="input input-bordered"
              type="number"
              min={0}
              value={maintenance}
              onChange={(event) => setMaintenance(event.target.value)}
            />
          </label>
          <label className="form-control">
            <span className="label-text">Link condition on PC sheet</span>
            <select
              className="select select-bordered"
              value={linkedCondition}
              onChange={(event) => setCondition(event.target.value)}
            >
              <option value="">None</option>
              {COMMON_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {condition.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text">Linked temporary effect</span>
            <select
              className="select select-bordered"
              value={linkedTempEffectId}
              onChange={(event) => setTempEffect(event.target.value)}
            >
              <option value="">None</option>
              {(target?.tempEffects ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="form-control mt-3">
          <span className="label-text">Notes</span>
          <textarea
            className="textarea textarea-bordered"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {effect ? 'Save effect' : 'Add effect'}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}
