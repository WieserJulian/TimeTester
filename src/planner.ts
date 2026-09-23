// Pure planning logic, shared by the app, the service worker and the tests.
// Dates are 'YYYY-MM-DD' local strings; weeks run Mon-Sun.
import type { CalEvent, Log, Override, Project, Repeat, Task } from './types.ts';
import { h, dshort } from './format.ts';

const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

export const today = () => fmt(new Date());
export const dateOf = (ms: number) => fmt(new Date(ms)); // local date of a timestamp
export const addDays = (s: string, n: number) => { const dt = parse(s); dt.setDate(dt.getDate() + n); return fmt(dt); };
export const weekday = (s: string) => (parse(s).getDay() + 6) % 7; // Mon = 0
export const mondayOf = (s: string) => addDays(s, -weekday(s));
export const daysBetween = (a: string, b: string) => Math.round((+parse(b) - +parse(a)) / 864e5); // DST-safe via round
const weekDates = (W: string) => Array.from({ length: 7 }, (_, i) => addDays(W, i));
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

// Projects only need the fields the calculation reads, so drafts (live preview) fit too.
export type CalcProject = Pick<Project, 'id' | 'kind'> & Partial<Omit<Project, 'id' | 'kind'>>;
export type CalcLog = Pick<Log, 'project_id' | 'date' | 'hours'>;
// Everything but projects/logs is optional so old callers (and tests) can pass just a pensum.
export interface CalcData<P extends CalcProject = CalcProject> {
  pensum: number; week_hours?: number[]; overrides?: Override[]; events?: CalEvent[]; ics_counts?: boolean;
  projects: P[]; logs: CalcLog[];
}

// ---------- capacity ----------
export function capacity(d: Pick<CalcData, 'pensum' | 'week_hours' | 'overrides'>, date: string) {
  const o = d.overrides?.find((x) => x.date === date);
  if (o) return o.hours;
  return d.week_hours ? d.week_hours[weekday(date)] : d.pensum / 7;
}
const isOff = (d: Pick<CalcData, 'overrides'>, date: string) => !!d.overrides?.some((x) => x.date === date && x.hours === 0);
export const busyHours = (d: Pick<CalcData, 'events'>, date: string) => sum((d.events ?? []).filter((e) => e.date === date), (e) => e.hours);
// The week's pensum: the usual week, minus days off / plus extra days.
export const pensumFor = (d: Pick<CalcData, 'pensum' | 'week_hours' | 'overrides'>, W: string) =>
  d.week_hours || d.overrides?.length ? sum(weekDates(W), (x) => capacity(d, x)) : d.pensum;

// ---------- one week ----------
export interface Row<P = CalcProject> { project: P; required: number; logged: number; left: number; overdue: boolean }
export interface Week<P = CalcProject> {
  weekStart: string; pensum: number; committed: number; free: number; loggedTotal: number; overbooked: boolean;
  calendar: number; // calendar hours counted as committed (0 unless ics_counts)
  daysOff: number;
  rows: Row<P>[];
}

export function computeWeek<P extends CalcProject>(data: CalcData<P>, weekStart: string): Week<P> {
  const W = weekStart, end = addDays(W, 6), dates = weekDates(W);
  const inWeek = (l: CalcLog) => l.date >= W && l.date <= end;
  const rows: Row<P>[] = [];
  for (const project of data.projects) {
    if (project.archived) continue;
    const mine = data.logs.filter((l) => l.project_id === project.id);
    const logged = sum(mine.filter(inWeek), (l) => l.hours);
    let required = 0, overdue = false;
    if (project.kind === 'weekly') {
      const active = (!project.start_date || project.start_date <= end) && (!project.end_date || project.end_date >= W);
      if (active) {
        required = project.hours_per_week ?? 0;
        // A project on fixed weekdays loses the share of the days you take off.
        const days = project.days?.split(',');
        if (days) required *= days.filter((n) => !isOff(data, dates[Number(n) - 1])).length / days.length;
      }
    } else if (!project.start_date || mondayOf(project.start_date) <= W) {
      const remaining = (project.total_hours ?? 0) - sum(mine.filter((l) => l.date < W), (l) => l.hours);
      const deadlineWeek = mondayOf(project.end_date!);
      if (W > deadlineWeek) {
        if (remaining > 0) { required = remaining; overdue = true; }
      } else {
        // ponytail: spread evenly per week, not by each week's capacity; weight by capacity if vacation weeks feel wrong
        required = Math.max(0, remaining) / (daysBetween(W, deadlineWeek) / 7 + 1);
      }
    }
    rows.push({ project, required, logged, left: required - logged, overdue });
  }
  const calendar = data.ics_counts ? sum(dates, (x) => busyHours(data, x)) : 0;
  const committed = sum(rows, (r) => r.required) + calendar;
  const pensum = pensumFor(data, W);
  return {
    weekStart: W, pensum, committed, free: pensum - committed, loggedTotal: sum(rows, (r) => r.logged),
    overbooked: committed > pensum + 1e-9, calendar, daysOff: dates.filter((x) => isOff(data, x)).length, rows,
  };
}

// The next `weeks` weeks, assuming you keep to the plan: each budget project's unlogged
// requirement is counted as done, so its hours stay spread evenly instead of piling up.
export function forecast<P extends CalcProject>(data: CalcData<P>, weekStart: string, weeks: number): Week<P>[] {
  const logs = [...data.logs];
  return Array.from({ length: weeks }, (_, i) => {
    const w = computeWeek({ ...data, logs }, addDays(weekStart, 7 * i));
    for (const r of w.rows) if (r.project.kind === 'budget' && r.left > 0) logs.push({ project_id: r.project.id, date: w.weekStart, hours: r.left });
    return w;
  });
}

// ---------- recurring tasks ----------
const step: Record<Repeat, (s: string) => string> = {
  daily: (s) => addDays(s, 1),
  weekdays: (s) => addDays(s, weekday(s) >= 4 ? 7 - weekday(s) : 1),
  weekly: (s) => addDays(s, 7),
};
// Date a recurring task moves to when you finish it: the first occurrence after today.
export function nextOccurrence(t: Pick<Task, 'date' | 'repeat'>, now: string) {
  let d = step[t.repeat!](t.date);
  while (d <= now) d = step[t.repeat!](d);
  return d;
}
const occursOn = (t: Task, date: string) =>
  t.repeat === 'daily' || (t.repeat === 'weekdays' && weekday(date) < 5) || (t.repeat === 'weekly' && weekday(date) === weekday(t.date));

// ---------- day by day ----------
export interface PlanTask extends Task { virtual?: boolean; rolled?: boolean }
export interface Day {
  date: string; capacity: number; off: boolean; hours: number;
  fixed: { project: Project; hours: number }[]; tasks: PlanTask[]; events: CalEvent[];
}
export type PlanData = Omit<CalcData<Project>, 'logs'> & { tasks: Task[] };

// Weekly projects with `days` split hours_per_week evenly over those days (none on days off).
// Unfinished tasks from past days roll over to today. Recurring tasks also show their upcoming
// occurrences (virtual: read-only). planned[project_id] = fixed + task hours.
export function planWeek(data: PlanData, weekStart: string, now = today()) {
  const planned: Record<number, number> = {};
  const add = (id: number | null, h: number) => { if (id != null) planned[id] = (planned[id] || 0) + h; };
  const days: Day[] = weekDates(weekStart).map((date, i) => {
    const off = isOff(data, date);
    const fixed = off ? [] : data.projects
      .filter((p) => !p.archived && p.kind === 'weekly' && p.days && p.days.split(',').includes(String(i + 1))
        && (!p.start_date || p.start_date <= date) && (!p.end_date || p.end_date >= date))
      .map((project) => ({ project, hours: project.hours_per_week! / project.days!.split(',').length }));
    const tasks: PlanTask[] = [];
    for (const t of data.tasks) {
      const due = t.date < now ? now : t.date;
      if (due === date) tasks.push(t.date < now ? { ...t, rolled: true } : t);
      else if (t.repeat && date > due && occursOn(t, date)) tasks.push({ ...t, virtual: true });
    }
    const events = (data.events ?? []).filter((e) => e.date === date);
    fixed.forEach((f) => add(f.project.id, f.hours));
    tasks.forEach((t) => add(t.project_id, t.hours));
    const hours = sum(fixed, (f) => f.hours) + sum(tasks, (t) => t.hours) + sum(events, (e) => e.hours);
    return { date, capacity: capacity(data, date), off, fixed, tasks, events, hours };
  });
  return { days, planned };
}

const deadline = (p: CalcProject) => (p.kind === 'budget' ? p.end_date! : '9999'); // weekly projects last

// Fills the free hours from today to Sunday with what each project still needs this week.
// Projects take turns in chunks of at most 2h per day, earliest deadline picking first each round,
// so work spreads over the days. When time is short, every project gets some rather than one getting all.
export function autoPlan(data: PlanData & { logs: CalcLog[] }, weekStart: string, now = today()) {
  const w = computeWeek(data, weekStart);
  const { days, planned } = planWeek(data, weekStart, now);
  const open = days.filter((d) => d.date >= now);
  const free = new Map(open.map((d) => [d.date, Math.max(0, d.capacity - d.hours)]));
  // Same as the Plan view's "Still to schedule": fixed weekday blocks count as scheduled, even past ones.
  const need = w.rows
    .map((r) => ({ project: r.project, left: r.required - r.logged - (planned[r.project.id] || 0) }))
    .filter((n) => n.left >= 0.25)
    .sort((a, b) => deadline(a.project).localeCompare(deadline(b.project)));
  const out = new Map<string, { project_id: number; date: string; hours: number }>();
  for (let placed = true; placed;) {
    placed = false;
    for (const n of need) for (const d of open) {
      const h = Math.floor(Math.min(2, n.left, free.get(d.date)!) * 4) / 4; // quarter hours
      if (h < 0.25) continue;
      const key = `${n.project.id}|${d.date}`;
      const e = out.get(key) ?? { project_id: n.project.id, date: d.date, hours: 0 };
      e.hours += h; out.set(key, e);
      free.set(d.date, free.get(d.date)! - h);
      n.left -= h; placed = true;
    }
  }
  return [...out.values()];
}

// ---------- overbooked: what would fix it ----------
export type Fix<P = CalcProject> =
  | { project: P; kind: 'deadline'; end_date: string }
  | { project: P; kind: 'hours'; hours_per_week: number }
  | { project: P; kind: 'archive' };

// Each fix alone brings the week back within the pensum.
export function suggestFixes<P extends CalcProject>(data: CalcData<P>, W: string): Fix<P>[] {
  const w = computeWeek(data, W);
  if (!w.overbooked) return [];
  const over = w.committed - w.pensum, out: Fix<P>[] = [];
  for (const r of w.rows) {
    const p = r.project;
    if (r.required <= 0 || r.overdue) continue;
    if (p.kind === 'budget' && r.required > over) {
      const n = daysBetween(W, mondayOf(p.end_date!)) / 7 + 1, remaining = r.required * n;
      const k = Math.max(1, Math.ceil(remaining / (r.required - over) - n - 1e-9));
      out.push({ project: p, kind: 'deadline', end_date: addDays(p.end_date!, 7 * k) });
    }
    if (p.kind === 'weekly') {
      const hpw = Math.floor((p.hours_per_week! * (r.required - over)) / r.required * 4) / 4;
      if (hpw > 0) out.push({ project: p, kind: 'hours', hours_per_week: hpw });
      if (r.required >= over) out.push({ project: p, kind: 'archive' });
    }
  }
  return out;
}

// ---------- alerts (Week view banner + reminder notifications) ----------
export interface Alert { key: string; text: string; bad: boolean }
const fmtHours = (n: number) => `${Math.round(n * 10) / 10}h`;

export function alerts(data: CalcData<Project>, now = today(), weeksAhead = 4): Alert[] {
  const out: Alert[] = [];
  for (const p of data.projects) {
    if (p.archived || p.kind !== 'budget') continue;
    const left = p.total_hours! - sum(data.logs.filter((l) => l.project_id === p.id), (l) => l.hours);
    if (left <= 0) continue;
    const days = daysBetween(now, p.end_date!);
    if (days < 0) out.push({ key: `overdue:${p.id}`, text: `${p.name} is overdue: ${h(left)} left`, bad: true });
    else if (days <= 14) out.push({ key: `due:${p.id}`, text: `${p.name} is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}: ${h(left)} left`, bad: days <= 3 });
  }
  for (const w of forecast(data, mondayOf(now), weeksAhead)) {
    if (w.overbooked) out.push({ key: `over:${w.weekStart}`, text: `Week of ${dshort(w.weekStart)} is overbooked by ${h(-w.free)}`, bad: false });
  }
  return out;
}
