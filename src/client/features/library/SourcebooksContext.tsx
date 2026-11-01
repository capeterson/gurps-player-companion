import { createContext } from 'react';
import type { LocalLibrarySource } from '../../db/dexie.ts';

export const SourcebooksContext = createContext<readonly LocalLibrarySource[]>([]);
export const sourcebookLabel = (book: Pick<LocalLibrarySource, 'abbreviation' | 'name'>) =>
  `${book.abbreviation}: ${book.name}`;
