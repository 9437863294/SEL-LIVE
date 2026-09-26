'use client';

import { useId, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { normalizeHex, type Hex } from '@/lib/appearance/color';

/**
 * A colour as six-digit hex only — the picker or typed. Anything else is shown as an error and
 * never reaches the theme; clearing the field goes back to the base theme's colour.
 */
export function HexColorField({
  label,
  value,
  placeholder,
  onChange,
  disabled,
}: {
  label: string;
  value: Hex | undefined;
  /** The colour used when this is left empty. */
  placeholder: Hex;
  onChange: (value: Hex | undefined) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const errorId = useId();
  const [text, setText] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  // A new colour from outside (a reset, a preset, a save from another device) replaces whatever is
  // typed and clears the error. Adjusted during render rather than in an effect, so the stale text
  // never paints: React re-runs this component with the new state before committing.
  const [shownValue, setShownValue] = useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    setText(value ?? '');
    setInvalid(false);
  }

  function commit(next: string) {
    setText(next);
    if (!next.trim()) {
      setInvalid(false);
      onChange(undefined);
      return;
    }
    const hex = normalizeHex(next.trim().startsWith('#') ? next.trim() : `#${next.trim()}`);
    setInvalid(!hex);
    if (hex) onChange(hex);
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={value ?? placeholder}
          disabled={disabled}
          onChange={(event) => commit(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed"
        />
        <input
          id={id}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => commit(event.target.value)}
          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-danger"
        />
        {value && (
          <button type="button" onClick={() => commit('')} disabled={disabled} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label={`Reset ${label} to the base theme`}>
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {invalid && (
        <p id={errorId} className="text-[11px] font-medium text-danger">
          Use a six-digit hex colour such as #1a73e8.
        </p>
      )}
    </div>
  );
}
