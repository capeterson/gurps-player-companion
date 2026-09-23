import { type ReactNode, createContext, useContext } from 'react';

interface CharacterHeaderChrome {
  menu: ReactNode;
  actions: ReactNode;
}

export const CharacterHeaderChromeContext = createContext<CharacterHeaderChrome | null>(null);

export function useCharacterHeaderChrome(): CharacterHeaderChrome | null {
  return useContext(CharacterHeaderChromeContext);
}
