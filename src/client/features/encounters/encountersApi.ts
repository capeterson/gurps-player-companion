import type {
  AdvanceRequest,
  CombatantCreate,
  CombatantUpdate,
  EffectCreate,
  EffectUpdate,
  EncounterCreate,
  EncounterOut,
  EncounterUpdate,
} from '../../../shared/schemas/encounter.ts';
import { api } from '../../lib/api.ts';

const root = (campaignId: string, encounterId?: string) =>
  `/campaigns/${campaignId}/encounters${encounterId ? `/${encounterId}` : ''}`;

export const encounterKeys = {
  all: ['encounters'] as const,
  list: (campaignId: string) => ['encounters', campaignId] as const,
  detail: (campaignId: string, encounterId: string) =>
    ['encounters', campaignId, encounterId] as const,
};

export const encountersApi = {
  list: (campaignId: string) => api<EncounterOut[]>(root(campaignId)),
  get: (campaignId: string, encounterId: string) =>
    api<EncounterOut>(root(campaignId, encounterId)),
  create: (campaignId: string, body: EncounterCreate) =>
    api<EncounterOut>(root(campaignId), { method: 'POST', body }),
  update: (campaignId: string, encounterId: string, body: EncounterUpdate) =>
    api<EncounterOut>(root(campaignId, encounterId), { method: 'PATCH', body }),
  advance: (campaignId: string, encounterId: string, body: AdvanceRequest) =>
    api<EncounterOut>(`${root(campaignId, encounterId)}/advance`, { method: 'POST', body }),
  createCombatant: (campaignId: string, encounterId: string, body: CombatantCreate) =>
    api(`${root(campaignId, encounterId)}/combatants`, { method: 'POST', body }),
  updateCombatant: (
    campaignId: string,
    encounterId: string,
    combatantId: string,
    body: CombatantUpdate,
  ) => api(`${root(campaignId, encounterId)}/combatants/${combatantId}`, { method: 'PATCH', body }),
  deleteCombatant: (campaignId: string, encounterId: string, combatantId: string) =>
    api<void>(`${root(campaignId, encounterId)}/combatants/${combatantId}`, { method: 'DELETE' }),
  createEffect: (campaignId: string, encounterId: string, body: EffectCreate) =>
    api(`${root(campaignId, encounterId)}/effects`, { method: 'POST', body }),
  updateEffect: (campaignId: string, encounterId: string, effectId: string, body: EffectUpdate) =>
    api(`${root(campaignId, encounterId)}/effects/${effectId}`, { method: 'PATCH', body }),
  deleteEffect: (campaignId: string, encounterId: string, effectId: string) =>
    api<void>(`${root(campaignId, encounterId)}/effects/${effectId}`, { method: 'DELETE' }),
};
