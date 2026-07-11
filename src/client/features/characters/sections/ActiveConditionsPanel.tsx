/**
 * Lists every trait/skill condition group present on the character, with
 * an ON/OFF toggle per group.  When toggled, the panel POSTs/DELETEs the
 * /characters/{id}/conditions/{group} endpoint which bumps the character
 * revision; the sync orchestrator pulls the new row + the sheet re-derives.
 *
 * The panel hides entirely when the character has no conditional effects
 * (which is the default for characters with no trait library bindings).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { CharacterDetail } from '../../../../shared/schemas/character.ts';
import { distinctConditionGroups } from '../../../../shared/domain/traitEffects.ts';
import { StatCard } from '../../../components/ui/StatCard.tsx';
import { api } from '../../../lib/api.ts';

interface Props {
  character: CharacterDetail;
  canWrite: boolean;
}

export function ActiveConditionsPanel({ character, canWrite }: Props) {
  const queryClient = useQueryClient();

  const groups = useMemo(
    () => distinctConditionGroups(character.effects),
    [character.effects],
  );

  const toggle = useMutation({
    mutationFn: async ({ group, on }: { group: string; on: boolean }) => {
      const method = on ? 'POST' : 'DELETE';
      return api<{ activeConditionGroups: string[]; character: CharacterDetail }>(
        `/characters/${character.id}/conditions/${group}`,
        { method },
      );
    },
    onSuccess: () => {
      // The orchestrator pulls the updated character row on its own; nudge
      // dependent queries (campaign list, library cache) so any cross-screen
      // derivations re-compute promptly.
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });

  if (groups.length === 0) return null;

  return (
    <StatCard title="Active Conditions">
      <div className="space-y-2">
        {groups.map((g) => (
          <label
            key={g.group}
            className={`flex items-center justify-between gap-3 rounded-field border px-3 py-2 ${
              g.active ? 'border-warning/60 bg-warning/5' : 'border-base-300'
            }`}
          >
            <span className="text-[13px] leading-snug">{g.label}</span>
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={g.active}
              disabled={!canWrite || toggle.isPending}
              onChange={(e) =>
                toggle.mutate({ group: g.group, on: e.currentTarget.checked })
              }
            />
          </label>
        ))}
        {toggle.isError && (
          <p className="text-xs text-error">Couldn't update — try again in a moment.</p>
        )}
      </div>
    </StatCard>
  );
}
