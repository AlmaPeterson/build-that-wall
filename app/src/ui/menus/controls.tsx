// Small form controls shared by Settings and the Play box: a labelled row, a −/+ stepper, an on/off
// switch, and a row of choice buttons.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export function Row({ label, children, id }: { label: string; children: ComponentChildren; id?: string }) {
  return (
    <div class="settings__row">
      <label class="settings__label" for={id}>{label}</label>
      <div class="settings__control">{children}</div>
    </div>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <span class="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={label + ' fewer'} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={label + ' more'} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

/**
 * A box to type a whole number in, then a word after it ("miles", "minutes"). Typing is free; the number is kept
 * (in range) when the box is left or Enter is pressed, and the box shows what was kept.
 */
export function NumberBox({ id, value, min, max, unit, label, onChange }: {
  id: string; value: number; min: number; max: number; unit: string; label: string; onChange: (v: number) => void;
}) {
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);
  // Read what's in the box now: the typed text may not have been saved yet when the box is left
  const keep = (now: string) => {
    const n = Math.round(Number(now));
    const v = now.trim() !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
    setTyped(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <span class="numberbox">
      <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={typed} aria-label={label}
        onInput={e => setTyped(e.currentTarget.value)} onChange={e => keep(e.currentTarget.value)} onBlur={e => keep(e.currentTarget.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); keep(e.currentTarget.value); } }} />
      <span class="numberbox__unit">{unit}</span>
    </span>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'toggle' + (on ? ' is-on' : '')} onClick={() => onChange(!on)}>
      {on ? 'On' : 'Off'}
    </button>
  );
}

/** One of a few choices, as a row of buttons (the one picked is filled in). `value` null: none picked. */
export function Choice<T extends string>({ value, options, onChange, label }: {
  value: T | null; options: { value: T; name: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div class="settings__steps" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button type="button" role="radio" key={o.value} aria-checked={value === o.value} class={value === o.value ? 'is-current' : ''}
          disabled={o.disabled} title={o.title} onClick={() => onChange(o.value)}>{o.name}</button>
      ))}
    </div>
  );
}
