import { type LibraryMetadata, libraryMetadata } from '../../../shared/schemas/libraryMetadata.ts';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { libraryFormError } from './libraryFormErrors.ts';

export function LibraryMetadataEditor({
  value,
  onChange,
}: { value: LibraryMetadata; onChange: (value: LibraryMetadata) => void }) {
  const patch = (next: Partial<LibraryMetadata>) => onChange({ ...value, ...next });
  const validation = libraryMetadata.safeParse(value);
  const error = validation.success
    ? null
    : libraryFormError(validation.error, {
        key: 'Canonical key',
        sourceKey: 'Source key',
        sourceLocator: 'Page or locator',
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
        <div className="grid gap-2 sm:grid-cols-2">
          <label>
            Canonical key
            <input
              className="input input-sm w-full"
              value={value.key ?? ''}
              onChange={(e) => patch({ key: e.target.value || undefined })}
            />
          </label>
          <label>
            Source key
            <input
              className="input input-sm w-full"
              value={value.sourceKey ?? ''}
              onChange={(e) => patch({ sourceKey: e.target.value || null })}
            />
          </label>
          <label>
            Page or locator
            <input
              className="input input-sm w-full"
              value={value.sourceLocator ?? ''}
              onChange={(e) => patch({ sourceLocator: e.target.value || null })}
            />
          </label>
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
