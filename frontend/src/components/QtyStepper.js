import React, { useEffect, useState } from 'react';

/**
 * - [type a number] + quantity control.
 *
 * The number between the buttons is a real input, so a stack of 200 does not
 * take 200 clicks. Typing is held in local state while the field has focus and
 * committed on blur or Enter, so a half-typed "1" is never pushed into the
 * parent and briefly read as 1 unit.
 *
 * The value is always clamped to [min, max] and normalised to an integer, so a
 * parent can never receive something it has to defend against.
 */
const QtyStepper = ({
  value,
  min = 0,
  max = 1,
  onChange,
  className = '',
  inputId,
  ariaLabel = 'quantity',
  disabled = false
}) => {
  const clamped = Math.max(min, Math.min(max, Number(value) || 0));
  const [draft, setDraft] = useState(String(clamped));
  const [editing, setEditing] = useState(false);

  // Track the parent unless the user is mid-edit, so an external change (a
  // search filter, a reset) shows up immediately but typing is not stomped.
  useEffect(() => {
    if (!editing) setDraft(String(clamped));
  }, [clamped, editing]);

  const commit = (raw) => {
    const n = parseInt(String(raw).replace(/[^0-9-]/g, ''), 10);
    const next = Number.isNaN(n) ? min : Math.max(min, Math.min(max, n));
    setDraft(String(next));
    setEditing(false);
    if (next !== clamped) onChange(next);
    return next;
  };

  const step = (n) => {
    if (disabled) return;
    const next = Math.max(min, Math.min(max, clamped + n));
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className={`qt ${className}`}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={disabled || clamped <= min}
        aria-label={`decrease ${ariaLabel}`}
      >
        &minus;
      </button>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="qt-input"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={(e) => { setEditing(true); e.target.select(); }}
        onChange={(e) => {
          setDraft(e.target.value);
          setEditing(true);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(String(clamped)); setEditing(false); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
        }}
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={disabled || clamped >= max}
        aria-label={`increase ${ariaLabel}`}
      >
        +
      </button>
    </div>
  );
};

export default QtyStepper;
