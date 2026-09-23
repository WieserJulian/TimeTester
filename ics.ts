// Minimal iCalendar (RFC 5545) reader for busy time. Handles what Google/Outlook "secret iCal" links
// contain in practice: timed events, RRULE FREQ=DAILY/WEEKLY (INTERVAL, COUNT, UNTIL, BYDAY),
// simple MONTHLY/YEARLY, EXDATE, moved or cancelled single occurrences (RECURRENCE-ID).
// Skipped: all-day events (holidays, birthdays), free/transparent and cancelled events.
// ponytail: TZID times are read as local wall time (fine when calendar and user share a zone);
// MONTHLY with BYDAY ("2nd Tuesday") only yields the first occurrence. Add a tz/rrule lib if that matters.
import type { CalEvent } from './src/types.ts';

interface VEvent {
  uid: string; start: Date; ms: number; title: string; rrule: Record<string, string> | null;
  exdates: Set<number>; recurrenceId: number | null; skip: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

// '20260921T090000' (local), '...Z' (UTC) → Date; '20260921' (all-day) → null
function parseTime(v: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v.trim());
  if (!m || m[4] === undefined) return null;
  const [y, mo, d, H, M, S] = m.slice(1, 7).map(Number);
  return m[7] ? new Date(Date.UTC(y, mo - 1, d, H, M, S)) : new Date(y, mo - 1, d, H, M, S);
}

// 'PT1H30M', 'P1D', '-PT15M' → ms
function parseDuration(v: string) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [w, d, h, mi, s] = m.slice(2).map((x) => Number(x || 0));
  return (m[1] === '-' ? -1 : 1) * ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

function readEvents(text: string): VEvent[] {
  const out: VEvent[] = [];
  let cur: Record<string, string[]> | null = null;
  for (const line of text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) { // unfold continued lines
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT' && cur) {
      const get = (k: string) => cur![k]?.[0];
      const start = parseTime(get('DTSTART') ?? '');
      const end = parseTime(get('DTEND') ?? '');
      if (start) {
        const ms = end ? +end - +start : parseDuration(get('DURATION') ?? '');
        const rid = parseTime(get('RECURRENCE-ID') ?? '');
        out.push({
          uid: get('UID') ?? '', start, ms,
          title: (get('SUMMARY') ?? '').replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' '),
          rrule: get('RRULE') ? Object.fromEntries(get('RRULE')!.split(';').map((kv) => kv.split('=') as [string, string])) : null,
          exdates: new Set((cur.EXDATE ?? []).flatMap((v) => v.split(',')).map(parseTime).filter((d) => d).map((d) => +d!)),
          recurrenceId: rid ? +rid : null,
          skip: get('STATUS') === 'CANCELLED' || get('TRANSP') === 'TRANSPARENT' || ms <= 0,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    (cur[name] ??= []).push(line.slice(colon + 1));
  }
  return out;
}

// Occurrence start times of one event, in order, up to `until` (inclusive).
function* occurrences(e: VEvent, until: Date) {
  if (!e.rrule) { yield e.start; return; }
  const r = e.rrule, every = Number(r.INTERVAL || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const last = r.UNTIL ? parseTime(r.UNTIL.length === 8 ? r.UNTIL + 'T235959' : r.UNTIL)! : until;
  const stop = last < until ? last : until;
  const at = (base: Date, addDays: number, addMonths = 0) =>
    new Date(base.getFullYear(), base.getMonth() + addMonths, base.getDate() + addDays, e.start.getHours(), e.start.getMinutes(), e.start.getSeconds());
  let n = 0;
  for (let i = 0; i < 5000; i++) { // hard cap against endless rules
    let batch: Date[];
    if (r.FREQ === 'DAILY') batch = [at(e.start, i * every)];
    else if (r.FREQ === 'WEEKLY') {
      const monday = at(e.start, -((e.start.getDay() + 6) % 7) + i * 7 * every);
      const byday = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))) : [(e.start.getDay() + 6) % 7];
      batch = byday.sort().map((d) => at(monday, d));
    } else if (r.FREQ === 'MONTHLY' && !r.BYDAY) batch = [at(e.start, 0, i * every)];
    else if (r.FREQ === 'YEARLY' && !r.BYDAY) batch = [at(e.start, 0, 12 * i * every)];
    else { yield e.start; return; }
    for (const d of batch) {
      if (d < e.start) continue;
      if (d > stop || n >= count) return;
      n++;
      yield d;
    }
  }
}

// Busy blocks between two 'YYYY-MM-DD' dates (inclusive), sorted by date and start.
export function parseIcs(text: string, from: string, to: string): CalEvent[] {
  const events = readEvents(text);
  const moved = new Set(events.filter((e) => e.recurrenceId != null).map((e) => `${e.uid}|${e.recurrenceId}`));
  const until = new Date(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10), 23, 59, 59);
  const out: CalEvent[] = [];
  for (const e of events) {
    if (e.skip) continue;
    for (const d of occurrences(e, until)) {
      if (e.recurrenceId == null && (e.exdates.has(+d) || moved.has(`${e.uid}|${+d}`))) continue;
      const date = ymd(d);
      if (date < from || date > to) continue;
      out.push({ date, start: `${pad(d.getHours())}:${pad(d.getMinutes())}`, hours: Math.min(24, e.ms / 3.6e6), title: e.title });
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}
