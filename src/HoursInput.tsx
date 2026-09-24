import type { FormEvent } from 'react';
import { hoursInput, parseHours } from './format.ts';

// Text field for hours accepting "9.25", "9:10", "9h10m" or "45m". Read the value back with parseHours.
export function HoursInput({ name = 'hours', value, max, autoFocus }: { name?: string; value?: number; max?: number; autoFocus?: boolean }) {
  const check = (e: FormEvent<HTMLInputElement>) => {
    const el = e.currentTarget, v = parseHours(el.value);
    el.setCustomValidity(v == null ? 'Enter hours like 9.25, 9:10 or 9h10m' : max != null && v > max + 1 / 120 ? `At most ${hoursInput(max)} hours` : '');
  };
  return <input name={name} inputMode="decimal" autoComplete="off" placeholder="e.g. 9:10" required autoFocus={autoFocus}
    defaultValue={hoursInput(value)} onInput={check} onInvalid={check} />;
}
