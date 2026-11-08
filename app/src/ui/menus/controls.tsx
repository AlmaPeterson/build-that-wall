// Small form controls shared by Settings and the Play box: a labelled row, a −/+ stepper, an on/off
// switch, and a row of choice buttons.
import type { ComponentChildren } from 'preact';

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

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'toggle' + (on ? ' is-on' : '')} onClick={() => onChange(!on)}>
      {on ? 'On' : 'Off'}
    </button>
  );
}

/** One of a few choices, as a row of buttons (the one picked is filled in). `value` null: none picked. */
export function Choice<T extends string>({ value, options, onChange, label }: {
  value: T | null; options: { value: T; name: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div class="settings__steps" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button type="button" role="radio" key={o.value} aria-checked={value === o.value} class={value === o.value ? 'is-current' : ''}
          onClick={() => onChange(o.value)}>{o.name}</button>
      ))}
    </div>
  );
}
