import type { LibraryRaceCreate, LibraryRaceOut } from '../../../shared/schemas/race.ts';
import { LibraryEntryEditor } from './LibraryEntryEditor.tsx';
export function RaceForm(props: {
  initial?: LibraryRaceOut;
  isPending: boolean;
  error?: string | null;
  onSubmit: (body: LibraryRaceCreate) => void;
  onCancel: () => void;
}) {
  return <LibraryEntryEditor<LibraryRaceCreate> section="races" {...props} />;
}
