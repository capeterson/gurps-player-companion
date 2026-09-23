import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon, type AppIconName } from '../../components/ui/AppIcon.tsx';

export const SHEET_TABS = [
  'Combat',
  'Overview',
  'Traits',
  'Skills',
  'Magic',
  'Inventory',
  'History',
] as const;
export type SheetTab = (typeof SHEET_TABS)[number];
export const SHEET_ICONS: Record<SheetTab, AppIconName> = {
  Combat: 'combat',
  Overview: 'identity',
  Traits: 'traits',
  Skills: 'skills',
  Magic: 'magic',
  Inventory: 'inventory',
  History: 'history',
};

interface SheetNavigationProps {
  tabs: readonly SheetTab[];
  active: SheetTab;
  counts: Partial<Record<SheetTab, number>>;
  onSelect: (tab: SheetTab) => void;
}

/** A single navigation surface: dock on desktop, two-ring flower on phones. */
export function SheetNavigation({ tabs, active, counts, onSelect }: SheetNavigationProps) {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [open, setOpen] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setDesktop(media.matches);
      setOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!navigation.current?.contains(event.target as Node)) setOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const select = (tab: SheetTab) => {
    setOpen(false);
    onSelect(tab);
  };

  if (desktop) {
    return createPortal(
      <nav className="dock sheet-dock" aria-label="Character sections">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            aria-label={tab}
            aria-current={active === tab ? 'page' : undefined}
            className={active === tab ? 'dock-active' : ''}
            onClick={() => select(tab)}
          >
            <AppIcon name={SHEET_ICONS[tab]} />
            <span className="dock-label">
              {tab}
              {counts[tab] !== undefined && <span className="sheet-nav-count">{counts[tab]}</span>}
            </span>
          </button>
        ))}
      </nav>,
      document.body,
    );
  }

  return createPortal(
    <>
      {open && (
        <button
          type="button"
          tabIndex={-1}
          className="sheet-flower-backdrop"
          aria-label="Dismiss character navigation"
          onClick={() => {
            setOpen(false);
            toggle.current?.focus();
          }}
        />
      )}
      <nav
        ref={navigation}
        className="fab fab-flower sheet-flower"
        aria-label="Character sections"
        data-open={open}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <button
          ref={toggle}
          type="button"
          className="btn btn-circle sheet-nav-toggle"
          aria-label={open ? 'Close character navigation' : 'Open character navigation'}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <AppIcon name={open ? 'close' : SHEET_ICONS[active]} size={24} />
          {!open && (
            <span className="sheet-nav-cue" aria-hidden="true">
              +
            </span>
          )}
        </button>
        <div id={id} className="sheet-petals" hidden={!open}>
          {tabs.map((tab, index) => {
            // Balance the seven destinations across two compact arcs. The
            // former fixed eight-item geometry left an obvious hole with seven
            // destinations; distributing each ring by its actual item count
            // keeps the dial visually continuous at 320px too.
            const innerCount = Math.min(3, tabs.length);
            const inner = index < innerCount;
            const ringIndex = inner ? index : index - innerCount;
            const ringCount = inner ? innerCount : tabs.length - innerCount;
            const startAngle = inner ? 170 : 178;
            const endAngle = inner ? 90 : 88;
            const angle =
              ringCount <= 1
                ? (startAngle + endAngle) / 2
                : startAngle - (ringIndex * (startAngle - endAngle)) / (ringCount - 1);
            const radius = inner ? 122 : 198;
            const style = {
              '--petal-x': `${Math.cos((angle * Math.PI) / 180) * radius}px`,
              '--petal-y': `${-Math.sin((angle * Math.PI) / 180) * radius}px`,
            } as CSSProperties;
            return (
              <div key={tab} className="sheet-petal" style={style}>
                <button
                  type="button"
                  className="btn btn-circle"
                  aria-label={tab}
                  aria-current={active === tab ? 'page' : undefined}
                  onClick={() => select(tab)}
                >
                  <AppIcon name={SHEET_ICONS[tab]} size={22} />
                  {counts[tab] !== undefined && (
                    <span className="sheet-petal-count">{counts[tab]}</span>
                  )}
                  <span className="sheet-petal-label">{tab}</span>
                </button>
              </div>
            );
          })}
        </div>
      </nav>
    </>,
    document.body,
  );
}
