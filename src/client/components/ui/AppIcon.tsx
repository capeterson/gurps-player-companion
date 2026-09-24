import {
  Backpack,
  Bell,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Compass,
  Dice6,
  Feather,
  Fingerprint,
  GripVertical,
  History,
  Map as MapIcon,
  Menu,
  Moon,
  Pencil,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  Swords,
  Target,
  UserRound,
  X,
} from 'lucide-react';

const ICONS = {
  combat: Swords,
  identity: UserRound,
  traits: Fingerprint,
  skills: Target,
  magic: BookOpen,
  inventory: Backpack,
  notes: Feather,
  history: History,
  campaign: MapIcon,
  navigation: Compass,
  menu: Menu,
  dice: Dice6,
  defense: Shield,
  activeDefense: ShieldCheck,
  bell: Bell,
  sun: Sun,
  moon: Moon,
  edit: Pencil,
  settings: Settings,
  modifier: Sparkles,
  gripVertical: GripVertical,
  close: X,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
} as const;

export type AppIconName = keyof typeof ICONS;

/** One outline weight and sizing convention for the Arcane interface. */
export function AppIcon({
  name,
  size = 20,
  className = '',
}: {
  name: AppIconName;
  size?: number;
  className?: string;
}) {
  const Icon = ICONS[name];
  return (
    <Icon size={size} strokeWidth={1.75} className={`shrink-0 ${className}`} aria-hidden="true" />
  );
}
