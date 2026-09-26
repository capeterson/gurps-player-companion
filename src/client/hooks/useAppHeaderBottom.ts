import { useLayoutEffect, useState } from 'react';

/** Live viewport bottom of the sticky app header, for content that sticks beneath it. */
export function useAppHeaderBottom(): number {
  const [headerBottom, setHeaderBottom] = useState(
    () => document.querySelector('header')?.getBoundingClientRect().bottom ?? 64,
  );

  useLayoutEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const measure = () => setHeaderBottom(header.getBoundingClientRect().bottom);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return headerBottom;
}
