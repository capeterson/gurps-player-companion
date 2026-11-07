import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEntityDocumentTitle } from './useEntityDocumentTitle.ts';

const DEFAULT = 'Sunbolt · A GURPS 4th edition companion';

describe('useEntityDocumentTitle', () => {
  afterEach(() => {
    document.title = '';
  });

  it('shows the entity name and restores the default title', () => {
    document.title = DEFAULT;
    const { rerender, unmount } = renderHook(({ name }) => useEntityDocumentTitle(name), {
      initialProps: { name: undefined as string | undefined },
    });
    expect(document.title).toBe(DEFAULT);
    rerender({ name: 'Aldric' });
    expect(document.title).toBe('Aldric · Sunbolt');
    rerender({ name: 'Lantern Coast' });
    expect(document.title).toBe('Lantern Coast · Sunbolt');
    rerender({ name: undefined });
    expect(document.title).toBe(DEFAULT);
    unmount();
    expect(document.title).toBe(DEFAULT);
  });
});
