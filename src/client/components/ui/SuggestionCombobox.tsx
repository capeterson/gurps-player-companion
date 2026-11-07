import { type ChangeEvent, type FocusEventHandler, type KeyboardEventHandler, useId } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Existing values offered as suggestions; any other text is kept as entered. */
  options: readonly string[];
  'aria-label': string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  inputProps?: {
    id?: string;
    onFocus?: FocusEventHandler<HTMLInputElement>;
    onBlur?: FocusEventHandler<HTMLInputElement>;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
    'aria-invalid'?: boolean | 'true' | 'false' | undefined;
    'aria-describedby'?: string | undefined;
    'data-flashing'?: string;
    'data-flash-parity'?: string;
  };
  disabled?: boolean;
}

/**
 * A free-text input that suggests existing values. It is a native combobox
 * (`input` + `datalist`): the browser filters the suggestions as the user
 * types and positions the list inside the viewport, and typing a value that
 * is not listed is always allowed.
 */
export function SuggestionCombobox({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  placeholder,
  className = '',
  inputClassName = '',
  inputProps,
  disabled = false,
}: Props) {
  const listId = useId();
  return (
    <span className={`block min-w-0 ${className}`}>
      <input
        {...inputProps}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={false}
        list={listId}
        aria-controls={listId}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        placeholder={placeholder ?? ''}
        className={`input input-bordered input-sm w-full min-w-0 ${inputClassName}`}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </span>
  );
}
