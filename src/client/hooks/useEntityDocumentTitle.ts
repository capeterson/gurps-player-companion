import { useEffect } from 'react';

/** Show the open character or campaign name in the window title; other pages keep the default. */
export function useEntityDocumentTitle(name: string | undefined): void {
  useEffect(() => {
    if (!name) return;
    const defaultTitle = document.title;
    document.title = `${name} · Sunbolt`;
    return () => {
      document.title = defaultTitle;
    };
  }, [name]);
}
