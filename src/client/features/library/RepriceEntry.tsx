import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { pricingSourceChanged } from '../../../shared/domain/libraryPricing.ts';
import { computeLeveledTraitCost } from '../../../shared/domain/modifierMath.ts';
import type { PricingResolution } from '../../../shared/schemas/calculation.ts';
import type { TraitModifier } from '../../../shared/schemas/trait.ts';
import { getLocalDb } from '../../db/dexie.ts';
import { useFieldFlash } from '../../hooks/useFieldFlash.ts';
import { useToasts } from '../../lib/toast.tsx';
import { flashBus } from '../../sync/flashBus.ts';
import { enqueueEntityPatch } from '../../sync/outbox.ts';
import { PricingResolver } from './PricingResolver.tsx';
import { useLocalLibrary } from './useLocalLibrary.ts';

export function RepriceEntry({
  section,
  entry,
}: {
  section: 'traits' | 'items';
  entry: {
    id: string;
    characterId: string;
    name: string;
    pricingResolution?: PricingResolution | null | undefined;
    libraryTraitId?: string | null | undefined;
    libraryItemId?: string | null | undefined;
    modifiers?: TraitModifier[];
    variantName?: string | null;
  };
}) {
  const campaignId = useLiveQuery(
    async () => (await getLocalDb().characters.get(entry.characterId))?.campaignId ?? null,
    [entry.characterId],
  );
  const library = useLocalLibrary(campaignId ?? null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toasts = useToasts();
  const entityClass = section === 'traits' ? 'character_trait' : 'character_inventory';
  const flash = useFieldFlash(`${entityClass}:${entry.id}:entry`);
  const sourceId = section === 'traits' ? entry.libraryTraitId : entry.libraryItemId;
  const source = library?.[section].find((row) => row.id === sourceId);
  if (!entry.pricingResolution && !sourceId) return null;
  const changed =
    library &&
    ((entry.pricingResolution && pricingSourceChanged(library, entry.pricingResolution)) ||
      entry.modifiers?.some(
        (m) => m.pricingResolution && pricingSourceChanged(library, m.pricingResolution),
      ));
  return (
    <div
      className="field-rollback-flash space-y-2"
      data-flashing={flash['data-flashing']}
      data-flash-parity={flash['data-flash-parity']}
    >
      <p className="text-sm">
        {!source
          ? 'Retained pricing snapshot'
          : changed
            ? 'Pricing source changed — saved values retained'
            : 'Saved pricing values'}
      </p>
      {source && (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Re-resolve pricing
        </button>
      )}
      {error && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {open && source && campaignId && (
        <PricingResolver
          campaignId={campaignId}
          section={section}
          entry={source}
          initial={entry.pricingResolution}
          initialModifiers={entry.modifiers ?? []}
          variant={
            'variants' in source
              ? source.variants.find((v) => v.name === entry.variantName)
              : undefined
          }
          onCancel={() => setOpen(false)}
          onResolve={async (resolution, selected) => {
            try {
              const modifiers = [
                ...(entry.modifiers ?? []).filter((m) => !m.pricingResolution),
                ...selected,
              ];
              const variant =
                'variants' in source
                  ? source.variants.find((v) => v.name === entry.variantName)
                  : undefined;
              const values =
                section === 'traits'
                  ? {
                      points: computeLeveledTraitCost({
                        basePoints: resolution.outputs.points ?? 0,
                        modifiers,
                        ...(variant ? { variant } : {}),
                      }).total,
                      modifiers,
                      ...(typeof resolution.inputs.level === 'number'
                        ? { level: resolution.inputs.level }
                        : {}),
                    }
                  : { cost: resolution.outputs.cost, weightLbs: resolution.outputs.weightLbs };
              await enqueueEntityPatch({
                entityClass,
                entityId: entry.id,
                characterId: entry.characterId,
                attemptedValue: { ...values, pricingResolution: resolution },
                humanName: `${entry.name} pricing`,
              });
              setError(null);
              setOpen(false);
            } catch (e) {
              const message = (e as Error).message;
              setError(message);
              flashBus.emit({ key: `${entityClass}:${entry.id}:entry`, reason: message });
              toasts.push(`Couldn't save ${entry.name} pricing — ${message}`, { kind: 'error' });
            }
          }}
        />
      )}
    </div>
  );
}
