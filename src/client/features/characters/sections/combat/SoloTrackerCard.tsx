import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { EFFECT_TEMPLATES } from '../../../../../shared/constants/effectTemplates.ts';
import {
  effectRemainingLabel,
  isEffectExpired,
  needsMaintenance,
} from '../../../../../shared/domain/encounterEffects.ts';
import { advanceTurn, previousTurn } from '../../../../../shared/domain/encounterTurns.ts';
import type { EffectDuration } from '../../../../../shared/schemas/encounter.ts';
import { type LocalSoloEncounter, getLocalDb } from '../../../../db/dexie.ts';

export function SoloTrackerCard({
  characterId,
  canWrite,
}: { characterId: string; canWrite: boolean }) {
  const db = getLocalDb();
  const tracker = useLiveQuery(() => db.soloEncounters.get(characterId), [characterId]);
  const [combatantName, setCombatantName] = useState('');
  const [effectName, setEffectName] = useState('');
  const [effectUnit, setEffectUnit] = useState<EffectDuration['unit']>('rounds');
  const [effectAmount, setEffectAmount] = useState('1');
  const [maintenance, setMaintenance] = useState('');

  async function update(change: (row: LocalSoloEncounter) => LocalSoloEncounter) {
    // Read inside the transaction so rapid local controls do not overwrite each other.
    await db.transaction('rw', db.soloEncounters, async () => {
      const row = await db.soloEncounters.get(characterId);
      if (row) await db.soloEncounters.put(change(row));
    });
  }

  function start() {
    void db.soloEncounters.put({
      characterId,
      round: 1,
      activeCombatantId: null,
      combatants: [],
      effects: [],
      updatedAt: new Date().toISOString(),
    });
  }

  const stamp = (row: LocalSoloEncounter) => ({ ...row, updatedAt: new Date().toISOString() });
  function turn(direction: 'next' | 'previous') {
    void update((row) =>
      stamp({
        ...row,
        ...(direction === 'next' ? advanceTurn : previousTurn)(row, row.combatants),
      }),
    );
  }
  function addCombatant() {
    if (!combatantName.trim()) return;
    void update((row) =>
      stamp({
        ...row,
        combatants: [
          ...row.combatants,
          {
            id: crypto.randomUUID(),
            name: combatantName.trim(),
            orderKey: (row.combatants.length + 1) * 10,
            active: true,
          },
        ],
      }),
    );
    setCombatantName('');
  }
  function applyTemplate(templateId: string) {
    const template = EFFECT_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) return;
    setEffectName(template.name);
    setEffectUnit(template.duration.unit);
    setEffectAmount(String(template.duration.unit === 'indefinite' ? 1 : template.duration.amount));
  }
  function addEffect() {
    const amount = Number(effectAmount);
    if (
      !effectName.trim() ||
      (effectUnit !== 'indefinite' && (!Number.isInteger(amount) || amount < 1))
    )
      return;
    const maintenanceCost = maintenance.trim() === '' ? undefined : Number(maintenance);
    if (
      maintenanceCost !== undefined &&
      (!Number.isInteger(maintenanceCost) || maintenanceCost < 0)
    )
      return;
    const duration: EffectDuration =
      effectUnit === 'indefinite' ? { unit: effectUnit } : { unit: effectUnit, amount };
    void update((row) =>
      stamp({
        ...row,
        effects: [
          ...row.effects,
          {
            id: crypto.randomUUID(),
            name: effectName.trim(),
            duration,
            startedAtRound: row.round,
            ...(maintenanceCost === undefined ? {} : { maintenanceCost }),
          },
        ],
      }),
    );
    setEffectName('');
    setEffectUnit('rounds');
    setEffectAmount('1');
    setMaintenance('');
  }

  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label-eyebrow">Solo tracker</p>
          <p className="text-sm text-base-content/60">This device only. Cleared on logout.</p>
        </div>
        {tracker && <span className="badge">Round {tracker.round}</span>}
      </div>
      {!tracker ? (
        canWrite && (
          <button type="button" className="btn btn-sm" onClick={start}>
            Start tracker
          </button>
        )
      ) : (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => turn('previous')}
              disabled={!canWrite}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => turn('next')}
              disabled={!canWrite}
            >
              Next turn
            </button>
          </div>
          <div className="flex gap-2">
            <input
              aria-label="Solo combatant name"
              className="input input-bordered input-sm min-w-0"
              value={combatantName}
              onChange={(event) => setCombatantName(event.target.value)}
              placeholder="Combatant name"
              disabled={!canWrite}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={addCombatant}
              disabled={!canWrite}
            >
              Add
            </button>
          </div>
          <ul className="space-y-1 text-sm">
            {tracker.combatants.map((combatant) => (
              <li
                key={combatant.id}
                className={
                  combatant.id === tracker.activeCombatantId ? 'font-semibold text-primary' : ''
                }
              >
                {combatant.name}
                {combatant.id === tracker.activeCombatantId ? ' · acting' : ''}
              </li>
            ))}
          </ul>
          <section className="space-y-2 border-t border-base-300 pt-3">
            <h3 className="font-semibold">Effects</h3>
            {tracker.effects.length === 0 && (
              <p className="text-sm text-base-content/60">No active effects.</p>
            )}
            {tracker.effects.map((effect) => {
              const expired = isEffectExpired(
                effect.duration,
                effect.startedAtRound,
                tracker.round,
              );
              const maintenanceDue = needsMaintenance(
                effect.maintenanceCost,
                effect.lastMaintainedRound,
                effect.startedAtRound,
                tracker.round,
              );
              return (
                <article
                  key={effect.id}
                  className={`rounded border p-2 ${expired ? 'border-warning' : 'border-base-300'}`}
                >
                  <strong>{effect.name}</strong>
                  <p className="text-sm text-base-content/70">
                    {effectRemainingLabel(effect.duration, effect.startedAtRound, tracker.round)} ·
                    started round {effect.startedAtRound}
                    {effect.maintenanceCost != null &&
                      ` · maintain ${effect.maintenanceCost} FP/min`}
                  </p>
                  {expired && effect.expiryAcknowledgedAtRound === undefined && (
                    <p className="text-warning text-sm">
                      Expired: resolve or acknowledge this effect.
                    </p>
                  )}
                  {maintenanceDue && (
                    <p className="text-warning text-sm">
                      Maintenance due ({effect.maintenanceCost} FP).
                    </p>
                  )}
                  {canWrite && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {maintenanceDue && (
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() =>
                            void update((row) =>
                              stamp({
                                ...row,
                                effects: row.effects.map((entry) =>
                                  entry.id === effect.id
                                    ? { ...entry, lastMaintainedRound: row.round }
                                    : entry,
                                ),
                              }),
                            )
                          }
                        >
                          Maintain
                        </button>
                      )}
                      {expired && (
                        <button
                          type="button"
                          className="btn btn-xs"
                          onClick={() =>
                            void update((row) =>
                              stamp({
                                ...row,
                                effects: row.effects.map((entry) =>
                                  entry.id === effect.id
                                    ? { ...entry, expiryAcknowledgedAtRound: row.round }
                                    : entry,
                                ),
                              }),
                            )
                          }
                        >
                          Acknowledge expiry
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() =>
                          void update((row) =>
                            stamp({
                              ...row,
                              effects: row.effects.filter((entry) => entry.id !== effect.id),
                            }),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {canWrite && (
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label-text">Template</span>
                  <select
                    aria-label="Effect template"
                    className="select select-bordered select-sm"
                    defaultValue=""
                    onChange={(event) => applyTemplate(event.target.value)}
                  >
                    <option value="">Manual</option>
                    {EFFECT_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">Effect name</span>
                  <input
                    aria-label="Effect name"
                    className="input input-bordered input-sm"
                    value={effectName}
                    onChange={(event) => setEffectName(event.target.value)}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Duration</span>
                  <select
                    aria-label="Effect duration"
                    className="select select-bordered select-sm"
                    value={effectUnit}
                    onChange={(event) =>
                      setEffectUnit(event.target.value as EffectDuration['unit'])
                    }
                  >
                    <option value="rounds">Rounds</option>
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="indefinite">Until removed</option>
                  </select>
                </label>
                {effectUnit !== 'indefinite' && (
                  <label className="form-control">
                    <span className="label-text">Duration amount</span>
                    <input
                      aria-label="Duration amount"
                      className="input input-bordered input-sm"
                      type="number"
                      min={1}
                      value={effectAmount}
                      onChange={(event) => setEffectAmount(event.target.value)}
                    />
                  </label>
                )}
                <label className="form-control">
                  <span className="label-text">Maintenance FP/min</span>
                  <input
                    aria-label="Maintenance FP/min"
                    className="input input-bordered input-sm"
                    type="number"
                    min={0}
                    value={maintenance}
                    onChange={(event) => setMaintenance(event.target.value)}
                  />
                </label>
                <div className="flex items-end">
                  <button type="button" className="btn btn-primary btn-sm" onClick={addEffect}>
                    Add effect
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
