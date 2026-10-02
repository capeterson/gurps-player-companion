import { useContext } from 'react';
import { type LibraryMetadata, libraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { SourcebooksContext, sourcebookLabel } from './SourcebooksContext.tsx';
import { libraryFormError } from './libraryFormErrors.ts';

export function LibraryMetadataEditor({
  value,
  onChange,
}: { value: LibraryMetadata; onChange: (value: LibraryMetadata) => void }) {
  const sources = useContext(SourcebooksContext);
  const patch = (next: Partial<LibraryMetadata>) => onChange({ ...value, ...next });
  const validation = libraryMetadata.safeParse(value);
  const error = validation.success
    ? null
    : libraryFormError(validation.error, {
        key: 'Definition identifier',
        sourceId: 'Sourcebook',
        sourceLocator: 'Page',
        rawText: 'Original row or excerpt',
        reviewNotes: 'Review notes',
      });
  return (
    <LibraryAdvancedFields
      title={`Source and completeness · ${(value.status ?? 'complete').replaceAll('_', ' ')}`}
      error={error}
      hint="Optional publication details and review status. Only complete definitions can be added to a character."
    >
      <fieldset className="fieldset min-w-0">
        <legend className="sr-only">Source and completeness</legend>
        {error && (
          <p role="alert" className="text-sm text-error break-words">
            {error}
          </p>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-2 sm:grid-cols-[minmax(0,1fr)_5rem]">
          <label className="min-w-0">
            Sourcebook
            <select
              className="select select-sm min-w-0 w-full"
              value={value.sourceId ?? ''}
              onChange={(e) => patch({ sourceId: e.target.value || null })}
            >
              <option value="">No sourcebook</option>
              {value.sourceId && !sources.some((source) => source.id === value.sourceId) && (
                <option value={value.sourceId}>Unavailable sourcebook</option>
              )}
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {sourcebookLabel(source)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            Page
            <input
              className="input input-sm min-w-0 w-full"
              inputMode="numeric"
              value={value.sourceLocator ?? ''}
              onChange={(e) => patch({ sourceLocator: e.target.value || null })}
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>
            Status
            <select
              className="select select-sm w-full"
              value={value.status ?? 'complete'}
              onChange={(e) => patch({ status: e.target.value as LibraryMetadata['status'] })}
            >
              <option value="complete">Complete</option>
              <option value="needs_review">Needs review</option>
              <option value="reference_only">Reference only</option>
            </select>
          </label>
          <label>
            Content role
            <select
              className="select select-sm w-full"
              value={value.role ?? 'definition'}
              onChange={(e) => patch({ role: e.target.value as LibraryMetadata['role'] })}
            >
              <option value="definition">Definition</option>
              <option value="template">Template</option>
              <option value="example">Example</option>
              <option value="reference">Reference</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.preferredEdition ?? false}
              onChange={(e) => patch({ preferredEdition: e.target.checked })}
            />{' '}
            Preferred edition
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={value.restricted ?? false}
              onChange={(e) => patch({ restricted: e.target.checked })}
            />
            Restricted (GM only)
          </label>
        </div>
        <label>
          Original row or excerpt
          <textarea
            className="textarea w-full"
            value={value.extraction?.rawText ?? ''}
            onChange={(e) =>
              patch({ extraction: { ...value.extraction, rawText: e.target.value } })
            }
          />
        </label>
        <label>
          Review notes
          <textarea
            className="textarea w-full"
            value={value.extraction?.reviewNotes ?? ''}
            onChange={(e) =>
              patch({ extraction: { ...value.extraction, reviewNotes: e.target.value } })
            }
          />
        </label>
      </fieldset>
    </LibraryAdvancedFields>
  );
}
