// Pure weekly-load calculation. Dates are 'YYYY-MM-DD' local strings; weeks run Mon-Sun.
import type { Log, Project, State, Task } from './types.ts';

const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

export const today = () => fmt(new Date());
export const addDays = (s: string, n: number) => { const dt = parse(s); dt.setDate(dt.getDate() + n); return fmt(dt); };
export const mondayOf = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7));
const weeksBetween = (a: string, b: string) => Math.round((+parse(b) - +parse(a)) / (7 * 864e5)); // DST-safe via round

// Projects only need the fields the calculation reads, so drafts (live preview) fit too.
export type CalcProject = Pick<Project, 'id' | 'kind'> & Partial<Omit<Project, 'id' | 'kind'>>;
export type CalcLog = Pick<Log, 'project_id' | 'date' | 'hours'>;

export interface Row<P = CalcProject> { project: P; required: number; logged: number; left: number; overdue: boolean }
export interface Week<P = CalcProject> {
  weekStart: string; pensum: number; committed: number; free: number; loggedTotal: number; overbooked: boolean; rows: Row<P>[];
}

export function computeWeek<P extends CalcProject>({ pensum, projects, logs }: { pensum: number; projects: P[]; logs: CalcLog[] }, weekStart: string): Week<P> {
  const W = weekStart, end = addDays(W, 6);
  const inWeek = (l: CalcLog) => l.date >= W && l.date <= end;
  const rows: Row<P>[] = [];
  for (const project of projects) {
    if (project.archived) continue;
    const mine = logs.filter((l) => l.project_id === project.id);
    const logged = mine.filter(inWeek).reduce((a, l) => a + l.hours, 0);
    let required = 0, overdue = false;
    if (project.kind === 'weekly') {
      const active = (!project.start_date || project.start_date <= end) && (!project.end_date || project.end_date >= W);
      if (active) required = project.hours_per_week ?? 0;
    } else if (!project.start_date || mondayOf(project.start_date) <= W) {
      const remaining = (project.total_hours ?? 0) - mine.filter((l) => l.date < W).reduce((a, l) => a + l.hours, 0);
      const deadlineWeek = mondayOf(project.end_date!);
      if (W > deadlineWeek) {
        if (remaining > 0) { required = remaining; overdue = true; }
      } else {
        required = Math.max(0, remaining) / Math.max(1, weeksBetween(W, deadlineWeek) + 1);
      }
    }
    rows.push({ project, required, logged, left: required - logged, overdue });
  }
  const committed = rows.reduce((a, r) => a + r.required, 0);
  return {
    weekStart: W, pensum, committed, free: pensum - committed,
    loggedTotal: rows.reduce((a, r) => a + r.logged, 0), overbooked: committed > pensum, rows,
  };
}

// The next `weeks` weeks, assuming you keep to the plan: each budget project's unlogged
// requirement is counted as done, so its hours stay spread evenly instead of piling up.
export function forecast<P extends CalcProject>(data: { pensum: number; projects: P[]; logs: CalcLog[] }, weekStart: string, weeks: number): Week<P>[] {
  const logs = [...data.logs];
  return Array.from({ length: weeks }, (_, i) => {
    const w = computeWeek({ ...data, logs }, addDays(weekStart, 7 * i));
    for (const r of w.rows) if (r.project.kind === 'budget' && r.left > 0) logs.push({ project_id: r.project.id, date: w.weekStart, hours: r.left });
    return w;
  });
}

export interface Day { date: string; fixed: { project: Project; hours: number }[]; tasks: Task[]; hours: number }

// Day-by-day plan. Weekly projects with `days` (e.g. '1,2,3' = Mon-Wed) split hours_per_week evenly over those days.
// `planned[project_id]` = fixed + task hours, so required - planned is what's still unscheduled.
export function planWeek({ projects, tasks }: Pick<State, 'projects' | 'tasks'>, weekStart: string) {
  const planned: Record<number, number> = {};
  const add = (id: number | null, h: number) => { if (id != null) planned[id] = (planned[id] || 0) + h; };
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const fixed = projects
      .filter((p) => !p.archived && p.kind === 'weekly' && p.days && p.days.split(',').includes(String(i + 1))
        && (!p.start_date || p.start_date <= date) && (!p.end_date || p.end_date >= date))
      .map((project) => ({ project, hours: project.hours_per_week! / project.days!.split(',').length }));
    const dayTasks = tasks.filter((t) => t.date === date);
    fixed.forEach((f) => add(f.project.id, f.hours));
    dayTasks.forEach((t) => add(t.project_id, t.hours));
    const hours = fixed.reduce((a, f) => a + f.hours, 0) + dayTasks.reduce((a, t) => a + t.hours, 0);
    return { date, fixed, tasks: dayTasks, hours };
  });
  return { days, planned };
}
