import { syncLogPayload, syncLogPayloadMetadata } from '../../shared/schemas/syncLog.ts';
import type { SyncLogBody, SyncLogEntry } from '../db/dexie.ts';
import { getLocalDb } from '../db/dexie.ts';

export const SYNC_LOG_COMPRESSION_MIN_BYTES = 1_024;
// Compression supplements the existing snapshot caps; it never lifts them.
export const SYNC_LOG_PAYLOAD_MAX_BYTES = 64 * 1_024;

function byteStream(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > SYNC_LOG_PAYLOAD_MAX_BYTES) {
        await reader.cancel();
        throw new Error('Recorded sync details exceed the size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Called before an IndexedDB transaction, with bounded journal snapshots. */
export async function packSyncLogEntry(
  entry: SyncLogEntry,
): Promise<{ entry: SyncLogEntry; body?: SyncLogBody }> {
  if (
    entry.redacted ||
    typeof CompressionStream !== 'function' ||
    typeof DecompressionStream !== 'function'
  )
    return { entry };
  try {
    const payload = syncLogPayload.parse({
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      details: entry.details,
      request: entry.request,
    });
    const original = new TextEncoder().encode(JSON.stringify(payload));
    if (
      original.byteLength < SYNC_LOG_COMPRESSION_MIN_BYTES ||
      original.byteLength > SYNC_LOG_PAYLOAD_MAX_BYTES
    )
      return { entry };
    const bytes = await readBytes(byteStream(original).pipeThrough(new CompressionStream('gzip')));
    // Account for the extra record/reference overhead; tiny savings aren't useful.
    if (bytes.byteLength + 128 >= original.byteLength) return { entry };
    const details =
      entry.details !== null && typeof entry.details === 'object'
        ? (entry.details as Record<string, unknown>)
        : {};
    const metadata = syncLogPayloadMetadata.parse({
      hasValueSnapshot: entry.previousValue !== undefined || entry.newValue !== undefined,
      newRevision: details.newRevision,
      revision: details.revision,
      appliedFields: details.appliedFields,
      ...(entry.request !== undefined ? { hasRequest: true } : {}),
      ...(typeof entry.previousValue === 'number' ? { previousNumber: entry.previousValue } : {}),
      ...(typeof entry.newValue === 'number' ? { newNumber: entry.newValue } : {}),
    });
    const referenceBytes = new TextEncoder().encode(
      JSON.stringify({ payloadStored: true, payloadMetadata: metadata }),
    ).byteLength;
    if (bytes.byteLength + referenceBytes + 128 >= original.byteLength) return { entry };
    return {
      entry: {
        ...entry,
        previousValue: undefined,
        newValue: undefined,
        details: undefined,
        request: undefined,
        payloadStored: true,
        payloadMetadata: metadata,
      },
      body: { id: entry.id, encoding: 'gzip', bytes },
    };
  } catch {
    // Unsupported streams/compression errors must not interrupt sync or lose diagnostics.
    return { entry };
  }
}

/** Load only on disclosure/export, after the caller has applied the share gate. */
export async function loadSyncLogEntry(entry: SyncLogEntry): Promise<SyncLogEntry> {
  if (!entry.payloadStored || entry.redacted) return entry;
  const db = getLocalDb();
  const [current, body] = await db.transaction('r', db.syncLog, db.syncLogBodies, async () =>
    Promise.all([db.syncLog.get(entry.id), db.syncLogBodies.get(entry.id)]),
  );
  // A concurrent access sweep/prune may have removed the body since rendering.
  if (!current) throw new Error('Recorded sync details are no longer available');
  if (!current.payloadStored || current.redacted) return current;
  if (!body || body.encoding !== 'gzip')
    throw new Error('Recorded sync details are no longer available');
  if (typeof DecompressionStream !== 'function')
    throw new Error('This browser cannot open compressed sync details');
  const bytes = await readBytes(
    byteStream(body.bytes).pipeThrough(new DecompressionStream('gzip')),
  );
  const payload = syncLogPayload.parse(JSON.parse(new TextDecoder().decode(bytes)));
  const latest = await db.syncLog.get(entry.id);
  if (!latest) throw new Error('Recorded sync details are no longer available');
  if (!latest.payloadStored || latest.redacted) return latest;
  const { payloadStored: _stored, payloadMetadata: _metadata, ...metadata } = latest;
  return { ...metadata, ...payload };
}
