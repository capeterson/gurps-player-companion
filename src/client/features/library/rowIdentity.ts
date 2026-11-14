/** Keys are assigned once, within the owning array; existing keys are never rewritten. */
export function unusedRowKey(name: string, existing: readonly string[], maxLength: number): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entry';
  const used = new Set(existing.map((key) => key.trim().replace(/\s+/g, ' ').toLowerCase()));
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`;
    const candidate = `${slug.slice(0, maxLength - suffix.length).replace(/-+$/g, '') || 'entry'}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}
