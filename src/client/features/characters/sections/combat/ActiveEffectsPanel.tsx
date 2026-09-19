import { useEffect, useState } from 'react';
import { effectExpired, instantiateEffect } from '../../../../../shared/domain/activeEffects.ts';
import type {
  ActiveEffectDefinitionOut,
  ActiveEffectInstance,
} from '../../../../../shared/schemas/activeEffects.ts';
import type { CharacterDetail } from '../../../../../shared/schemas/character.ts';
import { FoldSection } from '../../../../components/ui/FoldSection.tsx';
import { LibraryAutocomplete } from '../../../../components/ui/LibraryAutocomplete.tsx';
import { useDraftField } from '../../../../hooks/useDraftField.ts';
import { useFlashState } from '../../../../hooks/useFlashState.ts';
import { useToasts } from '../../../../lib/toast.tsx';
import { newClientId } from '../../../../sync/outbox.ts';
import { ActiveEffectForm } from '../../../library/ActiveEffectForm.tsx';
import { effectPreview } from '../../../library/EffectsEditor.tsx';
import { ActiveConditionsPanel } from '../ActiveConditionsPanel.tsx';
import { mutateActiveEffects } from '../activeEffectMutations.ts';
import { useLibraryFetcher } from '../useLibraryFetcher.ts';

function EffectNotes({ entry, characterId }: { entry: ActiveEffectInstance; characterId: string }) {
  const draft = useDraftField({
    serverValue: entry.notes ?? '',
    name: `${entry.name} notes`,
    parse: (raw) => raw,
    onSave: (value) =>
      mutateActiveEffects(characterId, `${entry.name} notes`, (entries) =>
        entries.map((e) => (e.id === entry.id ? { ...e, notes: value } : e)),
      ),
    flashKey: `character:${characterId}:activeEffects`,
  });
  return (
    <label>
      Notes
      <input
        className="input input-bordered field-rollback-flash w-full"
        aria-label={`${entry.name} notes`}
        {...draft.inputProps}
      />
    </label>
  );
}
export function ActiveEffectsPanel({
  character,
  canWrite,
}: { character: CharacterDetail; canWrite: boolean }) {
  const [sourceInventoryId, setSourceInventoryId] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [query, setQuery] = useState('');
  const { fetchOptions } = useLibraryFetcher<ActiveEffectDefinitionOut>(
    'activeEffects',
    character.campaignId ?? null,
  );
  const flash = useFlashState(`character:${character.id}:activeEffects`);
  const { push } = useToasts();
  async function change(
    label: string,
    update: (entries: ActiveEffectInstance[]) => ActiveEffectInstance[],
  ) {
    try {
      await mutateActiveEffects(character.id, label, update);
    } catch (e) {
      push(`Couldn't save ${label} — ${(e as Error).message}`, { kind: 'error' });
      flash.trigger();
    }
  }
  const expiredIds = (character.activeEffects ?? [])
    .filter((e) => e.state !== 'expired' && effectExpired(e, Date.now()))
    .map((e) => e.id)
    .join(',');
  useEffect(() => {
    if (!canWrite || !expiredIds) return;
    void mutateActiveEffects(character.id, 'Expire elapsed active effects', (entries) =>
      entries.map((e) => (effectExpired(e, Date.now()) ? { ...e, state: 'expired' } : e)),
    ).catch((e) => {
      push(`Couldn't save effect expiry — ${e.message}`, { kind: 'error' });
      flash.trigger();
    });
  }, [character.id, canWrite, expiredIds, push, flash.trigger]);
  return (
    <FoldSection
      title="Active Effects"
      preferenceKey={`${character.id}:active-effects`}
      className="card p-card"
    >
      <div {...flash.flashProps} className="field-rollback-flash space-y-3">
        {(character.activeEffects ?? []).map((entry) => {
          const expired = effectExpired(entry, Date.now());
          return (
            <article key={entry.id} className="rounded border border-base-300 p-3">
              <div className="flex flex-wrap justify-between">
                <h3>{entry.name}</h3>
                <span>{expired ? 'expired' : entry.state}</span>
              </div>
              <p className="text-xs text-dim">
                {entry.source ?? 'Custom effect'} ·{' '}
                {entry.definitionId
                  ? `Library version ${entry.sourceRevision ?? 'pending'}`
                  : entry.sourceRevision !== null
                    ? 'Retained library copy'
                    : 'Character only'}{' '}
                ·{' '}
                {entry.remainingRounds !== null
                  ? `${entry.remainingRounds} rounds`
                  : entry.expiresAt
                    ? `${Math.max(0, Math.ceil((Date.parse(entry.expiresAt) - Date.now()) / 60000))} minutes remaining`
                    : 'Indefinite'}
              </p>
              {entry.sourceInventoryId && (
                <p className="text-xs">
                  Source item:{' '}
                  {character.inventory.find((item) => item.id === entry.sourceInventoryId)?.name ??
                    'Removed item (retained provenance)'}
                </p>
              )}
              <p>{entry.description}</p>
              <p>
                {entry.effects.map(effectPreview).join('; ')}{' '}
                {entry.capabilities.map((c) => c.label).join(', ')}
              </p>
              {canWrite ? (
                <>
                  <EffectNotes entry={entry} characterId={character.id} />
                  <div className="flex flex-wrap gap-2 mt-2">
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() =>
                        void change(`${entry.name} state`, (entries) =>
                          entries.map((e) =>
                            e.id !== entry.id
                              ? e
                              : e.state === 'active' && !expired
                                ? { ...e, state: 'inactive' }
                                : {
                                    ...e,
                                    ...instantiateEffect(e, e.id, new Date().toISOString()),
                                    definitionId: e.definitionId,
                                    sourceRevision: e.sourceRevision,
                                    sourceCampaignId: e.sourceCampaignId,
                                    sourceInventoryId: e.sourceInventoryId,
                                    notes: e.notes,
                                  },
                          ),
                        )
                      }
                    >
                      {entry.state === 'active' && !expired ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() =>
                        void change(`Expire ${entry.name}`, (entries) =>
                          entries.map((e) => (e.id === entry.id ? { ...e, state: 'expired' } : e)),
                        )
                      }
                    >
                      Expire
                    </button>
                    {entry.definitionId && (
                      <button
                        type="button"
                        className="btn btn-xs"
                        onClick={() =>
                          void change(`Detach ${entry.name}`, (entries) =>
                            entries.map((e) =>
                              e.id === entry.id ? { ...e, definitionId: null } : e,
                            ),
                          )
                        }
                      >
                        Keep independent copy
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() =>
                        void change(`Remove ${entry.name}`, (entries) =>
                          entries.filter((e) => e.id !== entry.id),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                entry.notes && <p>{entry.notes}</p>
              )}
            </article>
          );
        })}
        {character.capabilities?.length > 0 && (
          <div>
            <h3>Capabilities, senses and resistances</h3>
            {character.capabilities.map((c, i) => (
              <p key={`${c.sourceId}:${i}`}>
                {c.capability.label} — {c.sourceName}
              </p>
            ))}
          </div>
        )}
        <ActiveConditionsPanel character={character} canWrite={canWrite} />
        {canWrite && (
          <>
            <label>
              Source item (optional)
              <select
                aria-label="Effect source item"
                className="select select-bordered w-full"
                value={sourceInventoryId ?? ''}
                onChange={(e) => setSourceInventoryId(e.target.value || null)}
              >
                <option value="">None</option>
                {character.inventory.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <LibraryAutocomplete
              value={query}
              onChange={setQuery}
              fetchOptions={fetchOptions}
              getOptionKey={(e) => e.id}
              renderOption={(e) => e.name}
              onPick={(e) => {
                const instance = {
                  ...instantiateEffect(e, newClientId(), new Date().toISOString()),
                  definitionId: e.id,
                  sourceCampaignId: e.campaignId,
                  sourceRevision: e.revision,
                  sourceInventoryId,
                };
                void change(`Apply ${e.name}`, (entries) => [...entries, instance]);
                setQuery('');
              }}
              placeholder="Apply campaign effect…"
            />
            <button type="button" className="btn btn-sm" onClick={() => setCustom(true)}>
              Custom effect
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                void change('Advance active effects one round', (entries) =>
                  entries.map((e) =>
                    e.state === 'active' && e.remainingRounds !== null
                      ? {
                          ...e,
                          remainingRounds: Math.max(0, e.remainingRounds - 1),
                          state: e.remainingRounds <= 1 ? 'expired' : 'active',
                        }
                      : e,
                  ),
                )
              }
            >
              Advance effects one round
            </button>
            {custom && (
              <ActiveEffectForm
                onCancel={() => setCustom(false)}
                onSave={async (definition) => {
                  await mutateActiveEffects(character.id, `Apply ${definition.name}`, (entries) => [
                    ...entries,
                    {
                      ...instantiateEffect(definition, newClientId(), new Date().toISOString()),
                      sourceInventoryId,
                    },
                  ]);
                  setCustom(false);
                }}
              />
            )}
          </>
        )}
      </div>
    </FoldSection>
  );
}
