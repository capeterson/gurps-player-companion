/**
 * Sync wire-protocol version shared by the PWA and the server.
 *
 * An installed PWA can stay offline across several deploys and come back
 * with outbox operations (and a Dexie layout) written by an older build.
 * Every client request carries `SYNC_PROTOCOL_HEADER`; `/sync/*` refuses a
 * client older than `MIN_SUPPORTED_SYNC_PROTOCOL` with HTTP 426 *before*
 * reading any operation, so nothing is applied, rejected or rolled back. The
 * client keeps its queued operations and reloads onto the current build,
 * whose Dexie upgrade path migrates them before they are sent again.
 *
 * Bump `SYNC_PROTOCOL_VERSION` whenever the operation envelope, a sync-backed
 * field's value shape, or the cursor row shape changes. Raise
 * `MIN_SUPPORTED_SYNC_PROTOCOL` to the new version when the server can no
 * longer interpret the previous shape correctly (and ship the matching Dexie
 * migration for queued operations in the same change).
 */

export const SYNC_PROTOCOL_HEADER = 'x-gpc-sync-protocol';

/** The protocol this build speaks. */
export const SYNC_PROTOCOL_VERSION = 2;

/** The oldest client protocol the server still accepts on `/sync/*`. */
export const MIN_SUPPORTED_SYNC_PROTOCOL = 2;

/** Error code of the HTTP 426 body returned to an outdated client. */
export const CLIENT_OUTDATED_ERROR = 'client_outdated';

/**
 * Parse the request header. Clients that predate the header spoke protocol 1,
 * so a missing header means 1; a malformed one is treated as unsupported.
 */
export function parseSyncProtocol(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return 1;
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 0;
}
