import { createContext, useContext } from 'react';
import type { LocalLibrarySource } from '../../db/dexie.ts';

export const SourcebooksContext = createContext<readonly LocalLibrarySource[]>([]);
export const sourcebookLabel = (book: Pick<LocalLibrarySource, 'abbreviation' | 'name'>) =>
  `${book.abbreviation}: ${book.name}`;
export function useSourcebookLabel() {
  const books = useContext(SourcebooksContext);
  return (id: string | null | undefined) =>
    id
      ? (books.find((book) => book.id === id)?.abbreviation ?? 'Unavailable sourcebook')
      : 'Legacy source';
}
