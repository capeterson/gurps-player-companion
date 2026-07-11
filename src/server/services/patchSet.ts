/**
 * Shared "PATCH body -> Drizzle `.set()` object" builder.
 *
 * Every mutating PATCH handler in this codebase used to hand-roll the
 * same loop: start from `{ updatedAt: new Date() }`, then copy every
 * key of the validated body whose value isn't `undefined` (Zod partial
 * schemas represent "field omitted" as `undefined`, never as an absent
 * key). A few routes also stringify specific keys before the copy
 * because the underlying Postgres column is a Drizzle `numeric`/decimal
 * type, which the driver expects as a string rather than a `number`.
 * `buildPatchSet` is that loop, extracted once.
 */

export function buildPatchSet(
  body: Record<string, unknown>,
  opts?: { readonly stringifyKeys?: readonly string[] },
): Record<string, unknown> {
  const stringifyKeys = opts?.stringifyKeys;
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    updates[k] = stringifyKeys?.includes(k) ? String(v) : v;
  }
  return updates;
}
