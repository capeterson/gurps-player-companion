import { describe, expect, it } from 'vitest';
import { unusedRowKey } from './rowIdentity.ts';

describe('unusedRowKey', () => {
  it('normalizes names and chooses an unused suffix without changing existing keys', () => {
    expect(unusedRowKey('Épée / Swing copy', ['epee-swing-copy', 'epee-swing-copy-2'], 40)).toBe(
      'epee-swing-copy-3',
    );
    expect(unusedRowKey('!!!', ['ENTRY'], 40)).toBe('entry-2');
  });
  it('reserves space for numeric suffixes within a domain limit', () => {
    const name = 'A'.repeat(80);
    const first = unusedRowKey(name, [], 40);
    const second = unusedRowKey(name, [first], 40);
    expect(first).toHaveLength(40);
    expect(second).toHaveLength(40);
    expect(second.endsWith('-2')).toBe(true);
  });
});
