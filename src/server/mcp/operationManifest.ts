import type { OAuthScope } from '../../shared/schemas/oauth.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface IncludedOperation {
  kind: 'tool';
  method: HttpMethod;
  path: string;
  tool: string;
  /** Explicit discriminant when several exact operations share one task tool. */
  action?: string;
  scope: OAuthScope;
  destructive: boolean;
  openWorld: boolean;
  handler: 'shared-openapi-handler';
  schemaSource: 'openapi-zod-registry';
  resultMode: 'canonical-read' | 'compact-mutation-ack';
  parityTests: readonly [
    'src/server/mcp/parity.integration.test.ts#executes-success-and-rest-differential',
    'src/server/mcp/parity.integration.test.ts#enforces-declared-oauth-scope',
    ...string[],
  ];
}

export interface ExcludedOperation {
  kind: 'excluded';
  method: HttpMethod;
  path: string;
  reason: string;
}

export type OperationPolicy = IncludedOperation | ExcludedOperation;

const effectsOperations = new Set([
  'GET /api/v1/campaigns/{id}/library',
  'POST /api/v1/campaigns/{id}/library/traits',
  'PATCH /api/v1/campaigns/{id}/library/traits/{traitId}',
  'POST /api/v1/campaigns/{id}/library/skills',
  'PATCH /api/v1/campaigns/{id}/library/skills/{skillId}',
  'POST /api/v1/campaigns/{id}/library/active-effects',
  'PATCH /api/v1/campaigns/{id}/library/active-effects/{effectId}',
  'POST /api/v1/campaigns/{id}/library/enchantments',
  'PATCH /api/v1/campaigns/{id}/library/enchantments/{enchantmentId}',
  'GET /api/v1/campaigns/{id}/library/export',
  'POST /api/v1/campaigns/{id}/library/import',
  'GET /api/v1/characters/{id}',
  'POST /api/v1/characters/{id}/traits',
  'PATCH /api/v1/characters/{id}/traits/{traitId}',
]);

const tool = (
  method: HttpMethod,
  path: string,
  name: string,
  scope: OAuthScope,
  destructive = method === 'DELETE',
  openWorld = false,
): IncludedOperation => ({
  kind: 'tool',
  method,
  path,
  tool: name,
  scope,
  destructive,
  openWorld,
  handler: 'shared-openapi-handler',
  schemaSource: 'openapi-zod-registry',
  resultMode: method === 'GET' ? 'canonical-read' : 'compact-mutation-ack',
  parityTests: [
    'src/server/mcp/parity.integration.test.ts#executes-success-and-rest-differential',
    'src/server/mcp/parity.integration.test.ts#enforces-declared-oauth-scope',
    ...(effectsOperations.has(operationKey(method, path))
      ? ['src/server/mcp/parity.integration.test.ts#effects-authoring-parity']
      : []),
  ],
});
/** Related writes share a task name, with an exact schema and scope per action. */
const task = (
  method: HttpMethod,
  path: string,
  name: string,
  action: string,
  scope: OAuthScope,
  destructive = method === 'DELETE',
): IncludedOperation => ({ ...tool(method, path, name, scope, destructive), action });
const excluded = (method: HttpMethod, path: string, reason: string): ExcludedOperation => ({
  kind: 'excluded',
  method,
  path,
  reason,
});

/** Exact raw-API coverage. There are deliberately no prefix or wildcard entries. */
export const OPERATION_POLICY: readonly OperationPolicy[] = [
  { ...tool('GET', '/api/v1/media/capabilities', 'media', 'gpc:read'), action: 'capabilities' },
  { ...tool('POST', '/api/v1/media/uploads', 'media', 'gpc:write'), action: 'upload' },
  { ...tool('GET', '/api/v1/media/uploads/{id}', 'media', 'gpc:read'), action: 'status' },
  { ...tool('DELETE', '/api/v1/media/uploads/{id}', 'media', 'gpc:write'), action: 'cancel' },
  excluded(
    'POST',
    '/api/v1/media/uploads/bytes',
    'Binary transport; equivalent bounded JSON content operation is exposed',
  ),
  excluded(
    'GET',
    '/media/{token}/{variant}',
    'Public immutable image delivery; authorized discovery through media and parent reads',
  ),
  excluded('GET', '/api/v1/admin/media', 'Instance administration'),
  excluded('DELETE', '/api/v1/admin/media/{id}', 'Instance administration'),
  excluded('PATCH', '/api/v1/admin/media/users/{id}', 'Instance administration'),
  excluded('GET', '/.well-known/oauth-protected-resource/mcp', 'OAuth discovery infrastructure'),
  excluded('GET', '/.well-known/oauth-authorization-server', 'OAuth discovery infrastructure'),
  excluded('POST', '/oauth/token', 'OAuth token infrastructure'),
  excluded('POST', '/oauth/revoke', 'OAuth token infrastructure'),
  excluded('POST', '/oauth/register', 'OAuth client-registration infrastructure'),
  excluded('GET', '/oauth/authorize', 'OAuth consent infrastructure'),
  excluded('POST', '/mcp', 'MCP transport infrastructure'),
  excluded('GET', '/api/v1/healthz', 'service infrastructure'),
  excluded('GET', '/api/v1/readyz', 'service infrastructure'),
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
  tool('GET', '/api/v1/auth/me', 'get_current_user', 'gpc:read'),
  excluded('GET', '/api/v1/auth/preferences', 'browser display-preference infrastructure'),
  excluded('PATCH', '/api/v1/auth/preferences', 'browser display-preference infrastructure'),
  excluded('GET', '/api/v1/auth/experimental-features', 'interactive account feature opt-ins'),
  excluded('PATCH', '/api/v1/auth/experimental-features', 'interactive account feature opt-ins'),
  excluded(
    'GET',
    '/api/v1/auth/notification-preferences',
    'interactive notification-preference infrastructure',
  ),
  excluded(
    'PATCH',
    '/api/v1/auth/notification-preferences',
    'interactive notification-preference infrastructure',
  ),
  excluded('POST', '/api/v1/auth/forgot-password', 'account recovery infrastructure'),
  excluded('POST', '/api/v1/auth/reset-password', 'account recovery infrastructure'),
  excluded('GET', '/api/v1/auth/api-keys', 'credential infrastructure'),
  excluded('POST', '/api/v1/auth/api-keys', 'credential infrastructure'),
  excluded('DELETE', '/api/v1/auth/api-keys/{id}', 'credential infrastructure'),
  excluded('GET', '/api/v1/oauth/authorization', 'OAuth consent infrastructure'),
  excluded('POST', '/api/v1/oauth/authorization', 'OAuth consent infrastructure'),
  excluded('GET', '/api/v1/oauth/grants', 'OAuth consent infrastructure'),
  excluded('DELETE', '/api/v1/oauth/grants/{id}', 'OAuth consent infrastructure'),
  tool('GET', '/api/v1/campaigns', 'list_campaigns', 'gpc:read'),
  task('POST', '/api/v1/campaigns', 'campaign', 'create', 'gpc:write'),
  task('DELETE', '/api/v1/campaigns/{id}', 'campaign', 'delete', 'gpc:manage'),
  tool('GET', '/api/v1/campaigns/{id}', 'get_campaign', 'gpc:read'),
  task('PATCH', '/api/v1/campaigns/{id}', 'campaign', 'update', 'gpc:write'),
  task('POST', '/api/v1/campaigns/{id}/members', 'campaign_member', 'add', 'gpc:manage', true),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/members/{userId}',
    'campaign_member',
    'remove',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/members/{userId}',
    'campaign_member',
    'update',
    'gpc:manage',
    true,
  ),
  tool('POST', '/api/v1/campaigns/{id}/transfer', 'transfer_campaign', 'gpc:manage', true),
  tool('GET', '/api/v1/campaigns/{id}/invitations', 'list_campaign_invitations', 'gpc:read'),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/invitations',
    'invite_campaign_member',
    'gpc:manage',
    true,
    true,
  ),
  tool(
    'DELETE',
    '/api/v1/campaigns/{id}/invitations/{invitationId}',
    'cancel_campaign_invitation',
    'gpc:manage',
  ),
  tool('GET', '/api/v1/invitations', 'list_invitations', 'gpc:read'),
  {
    ...task(
      'POST',
      '/api/v1/invitations/{invitationId}/accept',
      'invitation',
      'accept',
      'gpc:manage',
    ),
    openWorld: true,
  },
  task('POST', '/api/v1/invitations/{invitationId}/reject', 'invitation', 'reject', 'gpc:manage'),
  tool('GET', '/api/v1/notifications', 'list_notifications', 'gpc:read'),
  task('POST', '/api/v1/notifications/{id}/read', 'notification', 'mark_read', 'gpc:write'),
  task('POST', '/api/v1/notifications/read-all', 'notification', 'mark_all_read', 'gpc:write'),
  task('DELETE', '/api/v1/notifications/{id}', 'notification', 'delete', 'gpc:manage'),
  excluded('GET', '/api/v1/admin/users', 'instance administration'),
  excluded('GET', '/api/v1/admin/users/{userId}', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/suspend', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/unsuspend', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/purge', 'instance administration'),
  excluded('POST', '/api/v1/admin/users/{userId}/cancel-purge', 'instance administration'),
  excluded('GET', '/api/v1/admin/campaigns', 'instance administration'),
  excluded('GET', '/api/v1/admin/campaigns/{campaignId}', 'instance administration'),
  task('POST', '/api/v1/campaigns/{id}/library/sources', 'library_source', 'create', 'gpc:write'),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/sources/{sourceId}',
    'library_source',
    'update',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/sources/{sourceId}',
    'library_source',
    'delete',
    'gpc:manage',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/library/modifiers',
    'library_modifier',
    'create',
    'gpc:write',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/modifiers/{modifierId}',
    'library_modifier',
    'update',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/modifiers/{modifierId}',
    'library_modifier',
    'delete',
    'gpc:manage',
  ),
  tool('GET', '/api/v1/campaigns/{id}/library', 'get_campaign_library', 'gpc:read'),
  tool(
    'GET',
    '/api/v1/campaigns/{id}/library/skills/{skillId}',
    'get_campaign_library_skill',
    'gpc:read',
  ),
  task('POST', '/api/v1/campaigns/{id}/library/traits', 'library_trait', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/traits/{traitId}',
    'library_trait',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/traits/{traitId}',
    'library_trait',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/campaigns/{id}/library/skills', 'library_skill', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/skills/{skillId}',
    'library_skill',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/skills/{skillId}',
    'library_skill',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/campaigns/{id}/library/spells', 'library_spell', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/spells/{spellId}',
    'library_spell',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/spells/{spellId}',
    'library_spell',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/campaigns/{id}/library/items', 'library_item', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/items/{itemId}',
    'library_item',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/items/{itemId}',
    'library_item',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/campaigns/{id}/library/races', 'library_race', 'create', 'gpc:write'),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/races/{raceId}',
    'library_race',
    'update',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/races/{raceId}',
    'library_race',
    'delete',
    'gpc:manage',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/library/active-effects',
    'library_active_effect',
    'create',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/active-effects/{effectId}',
    'library_active_effect',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/active-effects/{effectId}',
    'library_active_effect',
    'update',
    'gpc:write',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/library/enchantments',
    'library_enchantment',
    'create',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/enchantments/{enchantmentId}',
    'library_enchantment',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/enchantments/{enchantmentId}',
    'library_enchantment',
    'update',
    'gpc:write',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/library/languages',
    'library_language',
    'create',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/languages/{languageId}',
    'library_language',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/languages/{languageId}',
    'library_language',
    'update',
    'gpc:write',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/library/techniques',
    'library_technique',
    'create',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/techniques/{techniqueId}',
    'library_technique',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/techniques/{techniqueId}',
    'library_technique',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/campaigns/{id}/library/styles', 'library_style', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/library/styles/{styleId}',
    'library_style',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/library/styles/{styleId}',
    'library_style',
    'update',
    'gpc:write',
  ),
  tool('GET', '/api/v1/campaigns/{id}/library/export', 'export_campaign_library', 'gpc:read'),
  tool(
    'POST',
    '/api/v1/campaigns/{id}/library/import',
    'import_campaign_library',
    'gpc:manage',
    true,
  ),
  tool('GET', '/api/v1/campaigns/{id}/log', 'list_adventure_log', 'gpc:read'),
  task('POST', '/api/v1/campaigns/{id}/log', 'adventure_log_entry', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/log/{entryId}',
    'adventure_log_entry',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/log/{entryId}',
    'adventure_log_entry',
    'update',
    'gpc:write',
  ),
  tool('GET', '/api/v1/campaigns/{id}/encounters', 'list_encounters', 'gpc:read'),
  task('POST', '/api/v1/campaigns/{id}/encounters', 'encounter', 'create', 'gpc:write'),
  tool('GET', '/api/v1/campaigns/{id}/encounters/{encounterId}', 'get_encounter', 'gpc:read'),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/encounters/{encounterId}',
    'encounter',
    'update',
    'gpc:write',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/advance',
    'encounter',
    'advance_turn',
    'gpc:write',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/combatants',
    'encounter_combatant',
    'create',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/combatants/{combatantId}',
    'encounter_combatant',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/combatants/{combatantId}',
    'encounter_combatant',
    'update',
    'gpc:write',
  ),
  task(
    'POST',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/effects',
    'encounter_effect',
    'create',
    'gpc:write',
  ),
  task(
    'DELETE',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/effects/{effectId}',
    'encounter_effect',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/campaigns/{id}/encounters/{encounterId}/effects/{effectId}',
    'encounter_effect',
    'update',
    'gpc:write',
  ),
  tool('GET', '/api/v1/characters', 'list_characters', 'gpc:read'),
  task('POST', '/api/v1/characters', 'character', 'create', 'gpc:write'),
  task('DELETE', '/api/v1/characters/{id}', 'character', 'delete', 'gpc:manage'),
  tool('GET', '/api/v1/characters/{id}', 'get_character', 'gpc:read'),
  tool(
    'GET',
    '/api/v1/characters/{id}/inventory/{itemId}',
    'get_character_inventory_item',
    'gpc:read',
  ),
  task('PATCH', '/api/v1/characters/{id}', 'character', 'update', 'gpc:write'),
  tool(
    'POST',
    '/api/v1/characters/{id}/warnings/dismiss',
    'dismiss_character_warning',
    'gpc:write',
  ),
  task('POST', '/api/v1/characters/{id}/traits', 'character_trait', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/characters/{id}/traits/{traitId}',
    'character_trait',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/characters/{id}/traits/{traitId}',
    'character_trait',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/characters/{id}/skills', 'character_skill', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/characters/{id}/skills/{skillId}',
    'character_skill',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/characters/{id}/skills/{skillId}',
    'character_skill',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/characters/{id}/spells', 'character_spell', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/characters/{id}/spells/{spellId}',
    'character_spell',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/characters/{id}/spells/{spellId}',
    'character_spell',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/characters/{id}/languages', 'character_language', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/characters/{id}/languages/{languageId}',
    'character_language',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/characters/{id}/languages/{languageId}',
    'character_language',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/characters/{id}/techniques', 'character_technique', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/characters/{id}/techniques/{techniqueId}',
    'character_technique',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/characters/{id}/techniques/{techniqueId}',
    'character_technique',
    'update',
    'gpc:write',
  ),
  task('POST', '/api/v1/characters/{id}/inventory', 'character_inventory', 'create', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/characters/{id}/inventory/{itemId}',
    'character_inventory',
    'delete',
    'gpc:manage',
  ),
  task(
    'PATCH',
    '/api/v1/characters/{id}/inventory/{itemId}',
    'character_inventory',
    'update',
    'gpc:write',
  ),
  tool('PATCH', '/api/v1/characters/{id}/combat', 'update_character_combat', 'gpc:write'),
  task(
    'DELETE',
    '/api/v1/characters/{id}/conditions/{group}',
    'character_condition_group',
    'deactivate',
    'gpc:write',
  ),
  task(
    'POST',
    '/api/v1/characters/{id}/conditions/{group}',
    'character_condition_group',
    'activate',
    'gpc:write',
  ),
  tool('GET', '/api/v1/characters/{id}/history', 'get_character_history', 'gpc:read'),
  tool('GET', '/api/v1/campaigns/{id}/history', 'get_campaign_history', 'gpc:read'),
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

/** Tool-backed operations; explicit actions may share one discovered tool. */
export const TOOLS = OPERATION_POLICY.filter(
  (entry): entry is IncludedOperation => entry.kind === 'tool',
);

// Compiled once: the idempotency middleware matches every mutation request.
const OPERATION_MATCHERS = OPERATION_POLICY.map((entry) => ({
  entry,
  pattern: new RegExp(`^${entry.path.replace(/\{[^}]+\}/g, '[^/]+')}$`),
}));

export function matchOperation(method: string, pathname: string): OperationPolicy | undefined {
  const upper = method.toUpperCase();
  for (const { entry, pattern } of OPERATION_MATCHERS) {
    if (entry.method === upper && pattern.test(pathname)) return entry;
  }
  return undefined;
}
