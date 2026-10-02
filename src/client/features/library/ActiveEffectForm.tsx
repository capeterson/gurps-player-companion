import type { ActiveEffectDefinition } from '../../../shared/schemas/activeEffects.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
export function ActiveEffectForm({
  initial,
  onSave,
  onCancel,
}: {
  campaignId?: string | null;
  initial?: ActiveEffectDefinition;
  onSave: (value: ActiveEffectDefinition) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <LibraryEntryEditor<ActiveEffectDefinition>
      section="activeEffects"
      initial={initial}
      onSubmit={onSave}
      onCancel={onCancel}
      isPending={false}
    />
  );
}
