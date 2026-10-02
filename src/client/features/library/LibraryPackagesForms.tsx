import type {
  LibraryLanguageCreate,
  LibraryLanguageOut,
  LibraryStyleCreate,
  LibraryStyleOut,
  LibraryTechniqueCreate,
  LibraryTechniqueOut,
} from '../../../shared/schemas/campaignLibrary.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
type FormProps<T, R> = {
  initial?: R;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: T) => void;
  onCancel: () => void;
};
export function LanguageForm(props: FormProps<LibraryLanguageCreate, LibraryLanguageOut>) {
  return <LibraryEntryEditor<LibraryLanguageCreate> section="languages" {...props} />;
}
export function TechniqueForm(props: FormProps<LibraryTechniqueCreate, LibraryTechniqueOut>) {
  return <LibraryEntryEditor<LibraryTechniqueCreate> section="techniques" {...props} />;
}
export function StyleForm(props: FormProps<LibraryStyleCreate, LibraryStyleOut>) {
  return <LibraryEntryEditor<LibraryStyleCreate> section="styles" {...props} />;
}
