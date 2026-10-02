import type {
  LibraryEnchantmentOut,
  LibraryItemCreate,
  LibraryItemOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
interface ItemFormProps {
  initial?: LibraryItemOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryItemCreate) => void;
  onCancel: () => void;
  definitions: readonly LibraryEnchantmentOut[];
}
export function ItemForm(props: ItemFormProps) {
  return <LibraryEntryEditor<LibraryItemCreate> section="items" {...props} />;
}
