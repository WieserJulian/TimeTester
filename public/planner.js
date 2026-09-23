// Pure weekly-load calculation. Dates are 'YYYY-MM-DD' local strings; weeks run Mon-Sun.
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

export const today = () => fmt(new Date());
export const addDays = (s, n) => { const dt = parse(s); dt.setDate(dt.getDate() + n); return fmt(dt); };
export const mondayOf = (s) => addDays(s, -((parse(s).getDay() + 6) % 7));
const weeksBetween = (a, b) => Math.round((parse(b) - parse(a)) / (7 * 864e5)); // DST-safe via round

export function computeWeek({ pensum, projects, logs }, weekStart) {
  const W = weekStart, end = addDays(W, 6);
  const inWeek = (l) => l.date >= W && l.date <= end;
  const rows = [];
  for (const project of projects) {
    if (project.archived) continue;
    const mine = logs.filter((l) => l.project_id === project.id);
    const logged = mine.filter(inWeek).reduce((a, l) => a + l.hours, 0);
    let required = 0, overdue = false;
    if (project.kind === 'weekly') {
      const active = (!project.start_date || project.start_date <= end) && (!project.end_date || project.end_date >= W);
      if (active) required = project.hours_per_week;
    } else if (!project.start_date || mondayOf(project.start_date) <= W) {
      const remaining = project.total_hours - mine.filter((l) => l.date < W).reduce((a, l) => a + l.hours, 0);
      const deadlineWeek = mondayOf(project.end_date);
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


// Day-by-day plan. Weekly projects with `days` (e.g. '1,2,3' = Mon-Wed) split hours_per_week evenly over those days.
// `planned[project_id]` = fixed + task hours, so required - planned is what's still unscheduled.
export function planWeek({ projects, tasks }, weekStart) {
  const planned = {};
  const add = (id, h) => { if (id != null) planned[id] = (planned[id] || 0) + h; };
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const fixed = projects
      .filter((p) => !p.archived && p.kind === 'weekly' && p.days && p.days.split(',').includes(String(i + 1))
        && (!p.start_date || p.start_date <= date) && (!p.end_date || p.end_date >= date))
      .map((project) => ({ project, hours: project.hours_per_week / project.days.split(',').length }));
    const dayTasks = tasks.filter((t) => t.date === date);
    fixed.forEach((f) => add(f.project.id, f.hours));
    dayTasks.forEach((t) => add(t.project_id, t.hours));
    const hours = fixed.reduce((a, f) => a + f.hours, 0) + dayTasks.reduce((a, t) => a + t.hours, 0);
    return { date, fixed, tasks: dayTasks, hours };
  });
  return { days, planned };
}
