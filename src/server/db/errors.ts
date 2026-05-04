/**
 * Helpers for translating Postgres driver errors into HTTP-meaningful
 * shapes.  Drizzle re-throws the underlying `pg` error, which carries
 * the SQLSTATE on `.code`.
 *
 * Reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

interface PgErrorShape {
  code?: string;
  constraint?: string;
}

function pgError(err: unknown): PgErrorShape | null {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') {
    return err as PgErrorShape;
  }
  return null;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = pgError(err);
  if (!pg || pg.code !== PG_UNIQUE_VIOLATION) return false;
  if (constraint && pg.constraint !== constraint) return false;
  return true;
}
