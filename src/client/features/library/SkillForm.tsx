import type {
  LibraryItemOut,
  LibrarySkillCreate,
  LibrarySkillOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
interface SkillFormProps {
  campaignId: string | null;
  initial?: LibrarySkillOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibrarySkillCreate) => void;
  onCancel: () => void;
  libraryItems: readonly LibraryItemOut[];
}
export function SkillForm(props: SkillFormProps) {
  return <LibraryEntryEditor<LibrarySkillCreate> section="skills" {...props} />;
}
