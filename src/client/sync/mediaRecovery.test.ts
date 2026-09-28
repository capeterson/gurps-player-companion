import { Buffer, Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalMediaUpload } from '../db/dexie.ts';
import { getLocalDb, resetLocalDb } from '../db/dexie.ts';

const activeUser = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./activeUser.ts', () => ({ readActiveUser: activeUser.read }));

import { buildPendingImageExport } from './mediaRecovery.ts';

const USER_ID = '0193b3c0-f1f0-7000-8000-00000000a001';
const OTHER_USER_ID = '0193b3c0-f1f0-7000-8000-00000000a002';
const CHARACTER_ID = '0193b3c0-f1f0-7000-8000-00000000a003';

function pendingUpload(id: string, userId: string, bytes: Uint8Array): LocalMediaUpload {
  const blob = new NodeBlob([Buffer.from(bytes)], { type: 'image/jpeg' });
  return {
    id,
    userId,
    targetType: 'character',
    targetId: CHARACTER_ID,
    blob,
    byteLength: blob.size,
    sha256: 'a'.repeat(64),
    state: 'queued',
    attempts: 0,
    createdAt: '2026-09-27T00:00:00.000Z',
  };
}

afterEach(async () => {
  activeUser.read.mockReset();
  await resetLocalDb();
});

describe('buildPendingImageExport', () => {
  it('exports only the active account image and preserves its exact binary bytes', async () => {
    const bytes = Uint8Array.from({ length: 9_013 }, (_, index) => (index * 37) % 256);
    const own = pendingUpload('0193b3c0-f1f0-7000-8000-00000000a004', USER_ID, bytes);
    const other = pendingUpload(
      '0193b3c0-f1f0-7000-8000-00000000a005',
      OTHER_USER_ID,
      Uint8Array.from([1, 2, 3]),
    );
    await getLocalDb().mediaUploads.bulkAdd([own, other]);
    activeUser.read.mockReturnValue(USER_ID);

    const result = await buildPendingImageExport();

    expect(result.format).toBe('gpc-pending-images-v1');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      uploadId: own.id,
      targetType: 'character',
      targetId: CHARACTER_ID,
      mimeType: 'image/jpeg',
      sha256: own.sha256,
    });
    const exportedImage = result.images[0];
    if (!exportedImage) throw new Error('Expected the active account image in the export');
    const exported = Uint8Array.from(atob(exportedImage.base64), (char) => char.charCodeAt(0));
    expect(exported).toEqual(bytes);
  });

  it('refuses to return export data if the active account changes while reading it', async () => {
    await getLocalDb().mediaUploads.add(
      pendingUpload(
        '0193b3c0-f1f0-7000-8000-00000000a006',
        USER_ID,
        Uint8Array.from([0, 127, 128, 255]),
      ),
    );
    activeUser.read.mockReturnValueOnce(USER_ID).mockReturnValueOnce(OTHER_USER_ID);

    await expect(buildPendingImageExport()).rejects.toThrow('The signed-in account changed');
  });

  it('requires a signed-in account before exporting pending image bytes', async () => {
    activeUser.read.mockReturnValue(null);

    await expect(buildPendingImageExport()).rejects.toThrow(
      'Sign in to export your pending images',
    );
  });
});
