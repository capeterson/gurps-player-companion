import { getLocalDb } from '../db/dexie.ts';
import { readActiveUser } from './activeUser.ts';

/** Explicit recovery export, never part of a shareable diagnostic dump. */
export async function buildPendingImageExport() {
  const userId = readActiveUser();
  if (!userId) throw new Error('Sign in to export your pending images');
  const uploads = await getLocalDb().mediaUploads.where('userId').equals(userId).toArray();
  const images = [];
  for (const upload of uploads) {
    const bytes = new Uint8Array(await upload.blob.arrayBuffer());
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192)
      parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    images.push({
      uploadId: upload.id,
      targetType: upload.targetType,
      targetId: upload.targetId,
      mimeType: upload.blob.type,
      sha256: upload.sha256,
      base64: btoa(parts.join('')),
    });
  }
  if (readActiveUser() !== userId) throw new Error('The signed-in account changed');
  return { format: 'gpc-pending-images-v1', generatedAt: new Date().toISOString(), images };
}
