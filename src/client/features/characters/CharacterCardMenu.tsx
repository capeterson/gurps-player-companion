import { useEffect, useRef } from 'react';
import { AppIcon } from '../../components/ui/AppIcon.tsx';
import { useAppHeaderBottom } from '../../hooks/useAppHeaderBottom.ts';
import { useViewportBoundedOverlay } from '../../hooks/useViewportBoundedOverlay.ts';
import { useDeleteCharacter } from './useDeleteCharacter.tsx';

/** Actions menu on a character card. Only the character's owner is offered Delete. */
export function CharacterCardMenu({ character }: { character: { id: string; name: string } }) {
  const del = useDeleteCharacter(character);
  const headerBottom = useAppHeaderBottom();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useViewportBoundedOverlay<HTMLUListElement>(true, undefined, {
    constrainHeight: true,
    minimumTop: headerBottom,
  });

  // A <details> menu stays open until told otherwise: close on outside press or Escape.
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuRef.current) menuRef.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);

  return (
    <>
      <details ref={menuRef} className="dropdown dropdown-end relative shrink-0">
        <summary
          className="btn btn-ghost btn-square btn-sm min-h-11 min-w-11"
          aria-label={`Actions for ${character.name}`}
        >
          <AppIcon name="more" size={18} />
        </summary>
        <ul
          ref={panelRef}
          style={{
            maxHeight:
              'min(calc(100dvh - 1rem), var(--viewport-overlay-available-height, calc(100dvh - 5rem)))',
          }}
          className="menu dropdown-content z-30 mt-1 w-40 max-w-[min(calc(100dvw-1rem),var(--viewport-overlay-available-width,calc(100dvw-1rem)))] flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-arcane-lg"
        >
          <li>
            <button
              type="button"
              className="text-error"
              onClick={() => {
                if (menuRef.current) menuRef.current.open = false;
                del.request();
              }}
            >
              <AppIcon name="trash" size={16} />
              Delete…
            </button>
          </li>
        </ul>
      </details>
      {del.dialog}
    </>
  );
}
