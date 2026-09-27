/** Escape Postgres LIKE metacharacters so user-entered filters stay literal. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
