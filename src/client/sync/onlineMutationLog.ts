/** Journal only online-only writes that affect cursor-backed campaign data.
 * This observes REST saves; it does not change their data path or queue them.
 */
import type { OperationCommand } from '../../shared/schemas/sync.ts';
import { ApiError } from '../lib/api.ts';
import { readUserIdFromToken, tokenStore } from '../lib/tokenStore.ts';
import { appendSyncLog, snapshotValue } from './syncLog.ts';
import { focusedSyncLogValues, syncEntityName } from './syncLogPresentation.ts';

interface OnlineMutation {
  entityId?: string;
  command: OperationCommand;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  before?: Record<string, unknown>;
  source: string;
  humanName: string;
}

export async function journalCampaignMutation<T>(
  mutation: OnlineMutation,
  send: () => Promise<T>,
): Promise<T> {
  const userId = readUserIdFromToken();
  const sessionId = tokenStore.read()?.sessionId;
  const currentSession = () =>
    readUserIdFromToken() === userId && tokenStore.read()?.sessionId === sessionId;
  const request = {
    method: mutation.method,
    path: `/api/v1${mutation.path}`,
    ...(mutation.body !== undefined ? { body: snapshotValue(mutation.body, 12_000) } : {}),
  };
  let result: T;
  try {
    result = await send();
  } catch (error) {
    if (currentSession()) {
      await appendSyncLog({
        direction: 'push',
        result: 'failed',
        entityClass: 'campaign',
        entityId: mutation.entityId,
        command: mutation.command,
        source: mutation.source,
        humanName: mutation.humanName,
        entityName: syncEntityName(mutation.before),
        request,
        reason: error instanceof Error ? error.message : 'Save failed',
        details:
          error instanceof ApiError
            ? { status: error.status, response: snapshotValue(error.body) }
            : { error: error instanceof Error ? error.message : String(error) },
      }).catch(() => {});
    }
    throw error;
  }
  // An old account's delayed response must never write into a new account's log.
  if (!currentSession()) return result;
  const response =
    result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
  const entityId =
    mutation.entityId ?? (typeof response?.id === 'string' ? response.id : undefined);
  const previousValue = mutation.source === 'Library import' ? undefined : mutation.before;
  // Imports are aggregate operations: their individual entity changes arrive via cursor.
  const newValue =
    mutation.source === 'Library import' || mutation.command === 'delete'
      ? undefined
      : response &&
          mutation.command === 'patch' &&
          mutation.body &&
          typeof mutation.body === 'object'
        ? Object.fromEntries(
            (mutation.source === 'Campaign ownership' ? ['ownerId'] : Object.keys(mutation.body))
              .filter((key) => Object.hasOwn(response, key))
              .map((key) => [key, response[key]]),
          )
        : response;
  const focused = focusedSyncLogValues({
    entityClass: 'campaign',
    command: mutation.command,
    previousValue,
    newValue,
  });
  await appendSyncLog({
    direction: 'push',
    result: 'synced',
    entityClass: 'campaign',
    entityId,
    command: mutation.command,
    source: mutation.source,
    humanName: mutation.humanName,
    entityName: syncEntityName(response) ?? syncEntityName(mutation.before),
    request,
    previousValue: snapshotValue(focused.previousValue),
    newValue: snapshotValue(focused.newValue),
    details: {
      ...(typeof response?.revision === 'number' ? { newRevision: response.revision } : {}),
      response: snapshotValue(result),
    },
  }).catch(() => {});
  return result;
}
