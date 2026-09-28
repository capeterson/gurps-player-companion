import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mediaConfig } from './config.ts';
import { localMediaStorage } from './localStorage.ts';

export interface MediaStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  head(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
}
let cached: MediaStorage | undefined;
export function mediaStorage(): MediaStorage {
  const c = mediaConfig();
  if (cached) return cached;
  if (c.backend === 'local') {
    cached = localMediaStorage(c.MEDIA_LOCAL_DIR);
    return cached;
  }
  if (!c.configured) throw new Error('Media object storage is not configured');
  const client = new S3Client({
    ...(c.MEDIA_S3_ENDPOINT ? { endpoint: c.MEDIA_S3_ENDPOINT } : {}),
    region: c.MEDIA_S3_REGION,
    forcePathStyle: c.MEDIA_S3_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: c.MEDIA_S3_ACCESS_KEY ?? '',
      secretAccessKey: c.MEDIA_S3_SECRET_KEY ?? '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });
  const send = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
    operation(AbortSignal.timeout(30_000));
  const Bucket = c.MEDIA_S3_BUCKET;
  cached = {
    async put(Key, Body) {
      await send((signal) =>
        client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType: 'image/webp' }), {
          abortSignal: signal,
        }),
      );
    },
    async get(Key) {
      const r = await send((signal) =>
        client.send(new GetObjectCommand({ Bucket, Key }), { abortSignal: signal }),
      );
      if (!r.Body) throw new Error('Image object is missing');
      return r.Body.transformToByteArray();
    },
    async head(Key) {
      return (
        (
          await send((signal) =>
            client.send(new HeadObjectCommand({ Bucket, Key }), { abortSignal: signal }),
          )
        ).ContentLength ?? 0
      );
    },
    async remove(Key) {
      await send((signal) =>
        client.send(new DeleteObjectCommand({ Bucket, Key }), { abortSignal: signal }),
      );
    },
    async list(Prefix, ContinuationToken) {
      const r = await send((signal) =>
        client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }), {
          abortSignal: signal,
        }),
      );
      return {
        keys: (r.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])),
        ...(r.NextContinuationToken ? { cursor: r.NextContinuationToken } : {}),
      };
    },
  };
  return cached;
}
/** Test seam; production always uses the configured S3 adapter. */
export function setMediaStorageForTests(storage?: MediaStorage): void {
  cached = storage;
}
