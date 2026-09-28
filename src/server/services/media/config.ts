import { z } from 'zod';

const schema = z.object({
  ENVIRONMENT: z.enum(['development', 'test', 'production']).optional(),
  NODE_ENV: z.string().optional(),
  MEDIA_STORAGE: z.enum(['auto', 's3', 'local']).default('auto'),
  MEDIA_LOCAL_DIR: z.string().min(1).default('.local/media'),
  MEDIA_S3_ENDPOINT: z.string().url().optional(),
  MEDIA_S3_REGION: z.string().default('garage'),
  MEDIA_S3_BUCKET: z.string().min(1).optional(),
  MEDIA_S3_ACCESS_KEY: z.string().min(1).optional(),
  MEDIA_S3_SECRET_KEY: z.string().min(1).optional(),
  MEDIA_S3_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  MEDIA_UPLOADS_ENABLED: z.enum(['true', 'false']).default('true'),
  MEDIA_USER_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  MEDIA_TOTAL_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024 * 1024),
  MEDIA_UPLOADS_PER_HOUR: z.coerce.number().int().positive().default(10),
  MEDIA_UPLOADS_PER_DAY: z.coerce.number().int().positive().default(50),
  MEDIA_UPLOADS_PER_IP_HOUR: z.coerce.number().int().positive().default(100),
  MEDIA_UPLOADS_PER_HOUR_TOTAL: z.coerce.number().int().positive().default(1000),
  MEDIA_READS_PER_IP_HOUR: z.coerce.number().int().positive().default(10000),
  MEDIA_READ_BYTES_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024 * 1024),
  MEDIA_PROCESSING_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
});

export function mediaConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = schema.parse(
    Object.fromEntries(Object.entries(env).filter(([, value]) => value !== '')),
  );
  const localAllowed =
    (c.ENVIRONMENT === 'development' || c.ENVIRONMENT === 'test') && c.NODE_ENV !== 'production';
  if (c.MEDIA_STORAGE === 'local' && !localAllowed)
    throw new Error(
      'Local media storage requires ENVIRONMENT=development or test and is forbidden in production',
    );
  // Even partial S3 credentials indicate intent to use S3: never silently move
  // images to disk when an operator has misconfigured their bucket.
  const hasS3 = Boolean(
    c.MEDIA_S3_ENDPOINT || c.MEDIA_S3_BUCKET || c.MEDIA_S3_ACCESS_KEY || c.MEDIA_S3_SECRET_KEY,
  );
  const backend =
    c.MEDIA_STORAGE === 'local' || (c.MEDIA_STORAGE === 'auto' && localAllowed && !hasS3)
      ? 'local'
      : 's3';
  const configured =
    backend === 'local' ||
    Boolean(c.MEDIA_S3_BUCKET && c.MEDIA_S3_ACCESS_KEY && c.MEDIA_S3_SECRET_KEY);
  return { ...c, backend, configured, enabled: configured && c.MEDIA_UPLOADS_ENABLED === 'true' };
}
