import type { OAuthScope } from '../../shared/schemas/oauth.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface IncludedOperation {
  kind: 'tool';
  method: HttpMethod;
  path: string;
  tool: string;
  scope: OAuthScope;
  destructive: boolean;
  handler: 'shared-openapi-handler';
  schemaSource: 'openapi-zod-registry';
  parityTests: readonly [
    'src/server/mcp/parity.integration.test.ts#executes-success-and-rest-differential',
    'src/server/mcp/parity.integration.test.ts#enforces-declared-oauth-scope',
  ];
}

export interface ExcludedOperation {
  kind: 'excluded';
  method: HttpMethod;
  path: string;
  reason: string;
}

export type OperationPolicy = IncludedOperation | ExcludedOperation;

const tool = (
  method: HttpMethod,
  path: string,
  name: string,
  scope: OAuthScope,
  destructive = method === 'DELETE',
): IncludedOperation => ({
  kind: 'tool',
  method,
  path,
  tool: name,
  scope,
  destructive,
  handler: 'shared-openapi-handler',
  schemaSource: 'openapi-zod-registry',
  parityTests: [
    'src/server/mcp/parity.integration.test.ts#executes-success-and-rest-differential',
    'src/server/mcp/parity.integration.test.ts#enforces-declared-oauth-scope',
  ],
});
const excluded = (method: HttpMethod, path: string, reason: string): ExcludedOperation => ({
  kind: 'excluded',
  method,
  path,
  reason,
});

/** Exact raw-API coverage. There are deliberately no prefix or wildcard entries. */
export const OPERATION_POLICY: readonly OperationPolicy[] = [
  excluded('GET', '/.well-known/oauth-protected-resource/mcp', 'OAuth discovery infrastructure'),
  excluded('GET', '/.well-known/oauth-authorization-server', 'OAuth discovery infrastructure'),
  excluded('POST', '/oauth/token', 'OAuth token infrastructure'),
  excluded('POST', '/oauth/revoke', 'OAuth token infrastructure'),
  excluded('GET', '/oauth/authorize', 'OAuth consent infrastructure'),
  excluded('POST', '/mcp', 'MCP transport infrastructure'),
  excluded('GET', '/api/v1/healthz', 'service infrastructure'),
  excluded('POST', '/api/v1/auth/register', 'account and credential infrastructure'),
  excluded('POST', '/api/v1/auth/login', 'account and credential infrastructure'),
  excluded('GET', '/api/v1/auth/passkeys', 'credential infrastructure'),
  excluded('POST', '/api/v1/auth/passkeys/register/options', 'credential infrastructure'),
  excluded('POST', '/api/v1/auth/passkeys/register', 'credential infrastructure'),
  excluded('DELETE', '/api/v1/auth/passkeys/{id}', 'credential infrastructure'),
  excluded('POST', '/api/v1/auth/passkeys/login/options', 'credential infrastructure'),
  excluded('POST', '/api/v1/auth/passkeys/login', 'credential infrastructure'),
  excluded('POST', '/api/v1/auth/refresh', 'app-session infrastructure'),
  excluded('POST', '/api/v1/auth/logout', 'app-session infrastructure'),
  excluded('POST', '/api/v1/auth/password', 'credential infrastructure'),
  tool('GET', '/api/v1/auth/me', 'gpc_get_current_user', 'gpc:read'),
  excluded('POST', '/api/v1/auth/forgot-password', 'account recovery infrastructure'),
  excluded('POST', '/api/v1/auth/reset-password', 'account recovery infrastructure'),
  excluded('GET', '/api/v1/auth/api-keys', 'credential infrastructure'),
  excluded('POST', '/api/v1/auth/api-keys', 'credential infrastructure'),
  excluded('DELETE', '/api/v1/auth/api-keys/{id}', 'credential infrastructure'),
  excluded('GET', '/api/v1/oauth/authorization', 'OAuth consent infrastructure'),
  excluded('POST', '/api/v1/oauth/authorization', 'OAuth consent infrastructure'),
  excluded('GET', '/api/v1/oauth/grants', 'OAuth consent infrastructure'),
  excluded('DELETE', '/api/v1/oauth/grants/{id}', 'OAuth consent infrastructure'),
  tool('GET', '/api/v1/campaigns', 'gpc_list_campaigns', 'gpc:read'),
  tool('POST', '/api/v1/campaigns', 'gpc_create_campaign', 'gpc:write'),
  tool('DELETE', '/api/v1/campaigns/{id}', 'gpc_delete_campaign', 'gpc:manage'),
  tool('GET', '/api/v1/campaigns/{id}', 'gpc_get_campaign', 'gpc:read'),
  tool('PATCH', '/api/v1/campaigns/{id}', 'gpc_update_campaign', 'gpc:write'),
  tool('POST', '/api/v1/campaigns/{id}/members', 'gpc_add_campaign_member', 'gpc:manage', true),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/members/{userId}',
    'gpc_remove_campaign_member',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/members/{userId}',
    'gpc_update_campaign_member',
    'gpc:manage',
    true,
  ),
  tool('POST', '/api/v1/campaigns/{id}/transfer', 'gpc_transfer_campaign', 'gpc:manage', true),
  tool('GET', '/api/v1/campaigns/{id}/invitations', 'gpc_list_campaign_invitations', 'gpc:read'),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/invitations',
    'gpc_invite_campaign_member',
    'gpc:manage',
    true,
  ),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/invitations/{invitationId}',
    'gpc_cancel_campaign_invitation',
    'gpc:manage',
  ),
  tool('GET', '/api/v1/invitations', 'gpc_list_invitations', 'gpc:read'),
  tool('POST', '/api/v1/invitations/{invitationId}/accept', 'gpc_accept_invitation', 'gpc:manage'),
  tool('POST', '/api/v1/invitations/{invitationId}/reject', 'gpc_reject_invitation', 'gpc:manage'),
  tool('GET', '/api/v1/notifications', 'gpc_list_notifications', 'gpc:read'),
  tool('POST', '/api/v1/notifications/{id}/read', 'gpc_mark_notification_read', 'gpc:write'),
  tool('POST', '/api/v1/notifications/read-all', 'gpc_mark_all_notifications_read', 'gpc:write'),
  tool('DELETE', '/api/v1/notifications/{id}', 'gpc_delete_notification', 'gpc:manage'),
  excluded('GET', '/api/v1/admin/users', 'instance administration'),
  excluded('GET', '/api/v1/admin/users/{userId}', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/suspend', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/unsuspend', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/purge', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/cancel-purge', 'instance administration'),
  excluded('GET', '/api/v1/admin/campaigns', 'instance administration'),
  excluded('GET', '/api/v1/admin/campaigns/{campaignId}', 'instance administration'),
  tool('GET', '/api/v1/campaigns/{id}/library', 'gpc_get_campaign_library', 'gpc:read'),
  tool('POST', '/api/v1/campaigns/{id}/library/traits', 'gpc_create_library_trait', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/library/traits/{traitId}',
    'gpc_delete_library_trait',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/library/traits/{traitId}',
    'gpc_update_library_trait',
    'gpc:write',
  ),
  tool('POST', '/api/v1/campaigns/{id}/library/skills', 'gpc_create_library_skill', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/library/skills/{skillId}',
    'gpc_delete_library_skill',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/library/skills/{skillId}',
    'gpc_update_library_skill',
    'gpc:write',
  ),
  tool('POST', '/api/v1/campaigns/{id}/library/spells', 'gpc_create_library_spell', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/library/spells/{spellId}',
    'gpc_delete_library_spell',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/library/spells/{spellId}',
    'gpc_update_library_spell',
    'gpc:write',
  ),
  tool('POST', '/api/v1/campaigns/{id}/library/items', 'gpc_create_library_item', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/library/items/{itemId}',
    'gpc_delete_library_item',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/library/items/{itemId}',
    'gpc_update_library_item',
    'gpc:write',
  ),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/library/languages',
    'gpc_create_library_language',
    'gpc:write',
  ),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/library/languages/{languageId}',
    'gpc_delete_library_language',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/library/languages/{languageId}',
    'gpc_update_library_language',
    'gpc:write',
  ),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/library/techniques',
    'gpc_create_library_technique',
    'gpc:write',
  ),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/library/techniques/{techniqueId}',
    'gpc_delete_library_technique',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/library/techniques/{techniqueId}',
    'gpc_update_library_technique',
    'gpc:write',
  ),
  tool('POST', '/api/v1/campaigns/{id}/library/styles', 'gpc_create_library_style', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/library/styles/{styleId}',
    'gpc_delete_library_style',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/library/styles/{styleId}',
    'gpc_update_library_style',
    'gpc:write',
  ),
  tool('GET', '/api/v1/campaigns/{id}/library/export', 'gpc_export_campaign_library', 'gpc:read'),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/library/import',
    'gpc_import_campaign_library',
    'gpc:manage',
    true,
  ),
  tool('GET', '/api/v1/campaigns/{id}/log', 'gpc_list_adventure_log', 'gpc:read'),
  tool('POST', '/api/v1/campaigns/{id}/log', 'gpc_create_adventure_log_entry', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/log/{entryId}',
    'gpc_delete_adventure_log_entry',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/log/{entryId}',
    'gpc_update_adventure_log_entry',
    'gpc:write',
  ),
  tool('GET', '/api/v1/campaigns/{id}/encounters', 'gpc_list_encounters', 'gpc:read'),
  tool('POST', '/api/v1/campaigns/{id}/encounters', 'gpc_create_encounter', 'gpc:write'),
  tool('GET', '/api/v1/campaigns/{id}/encounters/{encounterId}', 'gpc_get_encounter', 'gpc:read'),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/encounters/{encounterId}',
    'gpc_update_encounter',
    'gpc:write',
  ),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/advance',
    'gpc_advance_encounter_turn',
    'gpc:write',
  ),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/combatants',
    'gpc_create_encounter_combatant',
    'gpc:write',
  ),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/combatants/{combatantId}',
    'gpc_delete_encounter_combatant',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/combatants/{combatantId}',
    'gpc_update_encounter_combatant',
    'gpc:write',
  ),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/effects',
    'gpc_create_encounter_effect',
    'gpc:write',
  ),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/effects/{effectId}',
    'gpc_delete_encounter_effect',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/effects/{effectId}',
    'gpc_update_encounter_effect',
    'gpc:write',
  ),
  tool('GET', '/api/v1/characters', 'gpc_list_characters', 'gpc:read'),
  tool('POST', '/api/v1/characters', 'gpc_create_character', 'gpc:write'),
  tool('DELETE', '/api/v1/characters/{id}', 'gpc_delete_character', 'gpc:manage'),
  tool('GET', '/api/v1/characters/{id}', 'gpc_get_character', 'gpc:read'),
  tool('PATCH', '/api/v1/characters/{id}', 'gpc_update_character', 'gpc:write'),
  tool(
    'POST',
    '/api/v1/characters/{id}/warnings/dismiss',
    'gpc_dismiss_character_warning',
    'gpc:write',
  ),
  tool('POST', '/api/v1/characters/{id}/traits', 'gpc_create_character_trait', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/characters/{id}/traits/{traitId}',
    'gpc_delete_character_trait',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/characters/{id}/traits/{traitId}',
    'gpc_update_character_trait',
    'gpc:write',
  ),
  tool('POST', '/api/v1/characters/{id}/skills', 'gpc_create_character_skill', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/characters/{id}/skills/{skillId}',
    'gpc_delete_character_skill',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/characters/{id}/skills/{skillId}',
    'gpc_update_character_skill',
    'gpc:write',
  ),
  tool('POST', '/api/v1/characters/{id}/spells', 'gpc_create_character_spell', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/characters/{id}/spells/{spellId}',
    'gpc_delete_character_spell',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/characters/{id}/spells/{spellId}',
    'gpc_update_character_spell',
    'gpc:write',
  ),
  tool('POST', '/api/v1/characters/{id}/languages', 'gpc_create_character_language', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/characters/{id}/languages/{languageId}',
    'gpc_delete_character_language',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/characters/{id}/languages/{languageId}',
    'gpc_update_character_language',
    'gpc:write',
  ),
  tool('POST', '/api/v1/characters/{id}/techniques', 'gpc_create_character_technique', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/characters/{id}/techniques/{techniqueId}',
    'gpc_delete_character_technique',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/characters/{id}/techniques/{techniqueId}',
    'gpc_update_character_technique',
    'gpc:write',
  ),
  tool('POST', '/api/v1/characters/{id}/inventory', 'gpc_create_inventory_item', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/characters/{id}/inventory/{itemId}',
    'gpc_delete_inventory_item',
    'gpc:manage',
  ),
  tool(
    'PATCH',
    '/api/v1/characters/{id}/inventory/{itemId}',
    'gpc_update_inventory_item',
    'gpc:write',
  ),
  tool('PATCH', '/api/v1/characters/{id}/combat', 'gpc_update_character_combat', 'gpc:write'),
  tool(
    'DELETE',
    '/api/v1/characters/{id}/conditions/{group}',
    'gpc_deactivate_condition_group',
    'gpc:write',
  ),
  tool(
    'POST',
    '/api/v1/characters/{id}/conditions/{group}',
    'gpc_activate_condition_group',
    'gpc:write',
  ),
  tool('GET', '/api/v1/characters/{id}/history', 'gpc_get_character_history', 'gpc:read'),
  tool('GET', '/api/v1/campaigns/{id}/history', 'gpc_get_campaign_history', 'gpc:read'),
  excluded(
    'POST',
    '/api/v1/sync/operations',
    'replication transport; domain writes are separate tools',
  ),
  excluded('POST', '/api/v1/sync/cursor', 'replication transport; domain reads are separate tools'),
] as const;

export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export const POLICY_BY_KEY = new Map(
  OPERATION_POLICY.map((entry) => [operationKey(entry.method, entry.path), entry]),
);

export const TOOLS = OPERATION_POLICY.filter(
  (entry): entry is IncludedOperation => entry.kind === 'tool',
);

export function matchOperation(method: string, pathname: string): OperationPolicy | undefined {
  for (const entry of OPERATION_POLICY) {
    if (entry.method !== method.toUpperCase()) continue;
    const pattern = new RegExp(`^${entry.path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    if (pattern.test(pathname)) return entry;
  }
  return undefined;
}
