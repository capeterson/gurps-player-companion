import { z } from 'zod';

/** UUID (any version — server enforces v7 via DB default). */
export const uuid = z.string().uuid();
export type Uuid = z.infer<typeof uuid>;

/** ISO 8601 timestamp string with timezone. */
export const isoTimestamp = z.string().datetime({ offset: true });

/** ISO 8601 date string (no time). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Decimal stored as a JS number with up to 2 decimal places. */
export const decimal2 = z.number().finite();

export const revision = z.number().int().nonnegative();

export type ListQuery = z.infer<typeof listQuery>;
export const listQuery = z
  .object({
    search: z.string().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .partial();
