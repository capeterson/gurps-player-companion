import type { ActiveEffectDefinition, ActiveEffectInstance } from '../schemas/activeEffects.ts';
import { type ResolvedEffect, resolveEffects } from './traitEffects.ts';

export function instantiateEffect(
  definition: ActiveEffectDefinition,
  id: string,
  now: string,
): ActiveEffectInstance {
  const duration = definition.duration;
  return {
    name: definition.name,
    tags: definition.tags,
    effects: definition.effects,
    capabilities: definition.capabilities,
    stacking: definition.stacking,
    duration: definition.duration,
    id,
    definitionId: null,
    sourceCampaignId: null,
    sourceRevision: null,
    description: definition.description ?? null,
    source: definition.source ?? null,
    state: 'active',
    appliedAt: now,
    remainingRounds: duration.kind === 'rounds' ? duration.amount : null,
    expiresAt:
      duration.kind === 'minutes' || duration.kind === 'hours'
        ? new Date(
            Date.parse(now) + duration.amount * (duration.kind === 'hours' ? 3600000 : 60000),
          ).toISOString()
        : null,
    sourceInventoryId: null,
    notes: null,
  };
}
export function effectExpired(effect: ActiveEffectInstance, now: number): boolean {
  return (
    effect.state === 'expired' ||
    (effect.expiresAt !== null && Date.parse(effect.expiresAt) <= now) ||
    effect.remainingRounds === 0
  );
}
/** Highest is selected per exact mechanical destination; replace selects the newest instance.
 * Mixed policies for a key are conservatively resolved using replace > highest > additive. */
export function resolveActiveEffects(
  instances: readonly ActiveEffectInstance[],
  groups: ReadonlySet<string>,
  now: number,
) {
  const eligible = instances.filter((e) => e.state === 'active' && !effectExpired(e, now));
  const byKey = new Map<string, ActiveEffectInstance[]>();
  for (const e of eligible) byKey.set(e.stacking.key, [...(byKey.get(e.stacking.key) ?? []), e]);
  const effects: ResolvedEffect[] = [];
  const capabilities: Array<{
    sourceId: string;
    sourceName: string;
    capability: ActiveEffectInstance['capabilities'][number];
  }> = [];
  for (const entries of byKey.values()) {
    const ordered = [...entries].sort(
      (a, b) => b.appliedAt.localeCompare(a.appliedAt) || a.id.localeCompare(b.id),
    );
    const selected = entries.some((e) => e.stacking.kind === 'replace')
      ? ordered.slice(0, 1)
      : ordered;
    const highest = entries.some((e) => e.stacking.kind === 'highest');
    const mechanical = selected.flatMap((e) =>
      resolveEffects(
        [{ id: e.id, name: e.name, level: 1, libraryEffects: e.effects }],
        [],
        groups,
      ).map((r) => ({ ...r, sourceKind: 'active_effect' as const })),
    );
    const destinations = new Map<string, ResolvedEffect>();
    for (const e of mechanical) {
      if (!highest || !e.active) {
        effects.push(e);
        continue;
      }
      const key = JSON.stringify([
        e.target,
        e.skillName,
        e.skillSpecialty,
        e.hitLocation,
        e.weaponSelector,
      ]);
      const old = destinations.get(key);
      if (!old || e.value > old.value) destinations.set(key, e);
    }
    effects.push(...destinations.values());
    const seen = new Set<string>();
    for (const e of selected)
      for (const capability of e.capabilities) {
        if (capability.conditionGroup && !groups.has(capability.conditionGroup)) continue;
        const key = JSON.stringify([capability.kind, capability.key, capability.parameters]);
        if (highest && seen.has(key)) continue;
        seen.add(key);
        capabilities.push({ sourceId: e.id, sourceName: e.name, capability });
      }
  }
  return { effects, capabilities };
}
