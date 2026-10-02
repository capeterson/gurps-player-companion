import type {
  LibraryEnchantmentCreate,
  LibraryEnchantmentOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
interface EnchantmentFormProps {
  campaignId: string | null;
  initial?: LibraryEnchantmentOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryEnchantmentCreate) => void;
  onCancel: () => void;
}
export function EnchantmentForm(props: EnchantmentFormProps) {
  return <LibraryEntryEditor<LibraryEnchantmentCreate> section="enchantments" {...props} />;
}
