import type {
  LibrarySpellCreate,
  LibrarySpellOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
interface SpellFormProps {
  initial?: LibrarySpellOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibrarySpellCreate) => void;
  onCancel: () => void;
}
export function SpellForm(props: SpellFormProps) {
  return <LibraryEntryEditor<LibrarySpellCreate> section="spells" {...props} />;
}
