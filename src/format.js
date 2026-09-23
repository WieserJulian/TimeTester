export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const h = (n) => `${Math.round(n * 10) / 10}h`;
const date = (opts) => (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, opts);
export const dl = date({ day: 'numeric', month: 'short', year: 'numeric' });
export const dday = date({ weekday: 'short', day: 'numeric', month: 'short' });
export const dshort = date({ day: 'numeric', month: 'short' });
export const pct = (n, of) => Math.max(0, Math.min(100, (n / of) * 100));
export const num = (v) => (v === '' || v == null ? null : Number(v));
