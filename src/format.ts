export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const h = (n: number) => `${Math.round(n * 10) / 10}h`;
const date = (opts: Intl.DateTimeFormatOptions) => (s: string) => new Date(s + 'T00:00').toLocaleDateString(undefined, opts);
export const dl = date({ day: 'numeric', month: 'short', year: 'numeric' });
export const dday = date({ weekday: 'short', day: 'numeric', month: 'short' });
export const dshort = date({ day: 'numeric', month: 'short' });
export const pct = (n: number, of: number) => Math.max(0, Math.min(100, (n / of) * 100));
export const num = (v: FormDataEntryValue | number | null | undefined) => (v === '' || v == null ? null : Number(v));
export const str = (f: FormData, k: string) => String(f.get(k) ?? '');
export const weekdayName = date({ weekday: 'short' });

// Parses hours typed as decimal ("9.25", "9,25"), clock ("9:10") or units ("9h10", "9h 10m", "45m", "1.5h").
// Returns null for anything else, including 0 and minutes >= 60 in the clock/unit forms.
export function parseHours(s: string): number | null {
  const t = s.trim().toLowerCase().replace(',', '.');
  let m;
  let v: number;
  if (/^(\d+\.?\d*|\.\d+)$/.test(t)) v = Number(t);
  else if ((m = t.match(/^(\d+):(\d{1,2})$/)) && +m[2] < 60) v = +m[1] + +m[2] / 60;
  else if ((m = t.match(/^(?:(\d+(?:\.\d+)?)\s*h\s*(?:(\d{1,2})\s*(?:m|min)?)?|(\d+)\s*(?:m|min))$/)) && !(m[2] && +m[2] >= 60)) {
    v = m[3] ? +m[3] / 60 : +m[1] + +(m[2] ?? 0) / 60;
  } else return null;
  return v > 0 ? Math.round(v * 1e4) / 1e4 : null;
}

// Hours for an input field: quarter hours stay decimal ("2.5"), anything else shows as "h:mm" ("9:10").
export function hoursInput(n: number | null | undefined) {
  if (n == null) return '';
  if (Number.isInteger(n * 4)) return String(n);
  const min = Math.round(n * 60);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}
