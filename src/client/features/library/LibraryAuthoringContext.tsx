import { createContext } from 'react';
import type { LocalLibrary } from './useLocalLibrary.ts';
export const LibraryAuthoringContext = createContext<{
  campaignId: string;
  library: LocalLibrary;
} | null>(null);
