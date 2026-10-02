import type {
  LibraryItemOut,
  LibraryTraitCreate,
  LibraryTraitOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
interface TraitFormProps {
  campaignId: string | null;
  initial?: LibraryTraitOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryTraitCreate) => void;
  onCancel: () => void;
  libraryItems: readonly LibraryItemOut[];
}
export function TraitForm(props: TraitFormProps) {
  return <LibraryEntryEditor<LibraryTraitCreate> section="traits" {...props} />;
}
