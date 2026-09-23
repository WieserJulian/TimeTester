import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeek, forecast, planWeek, autoPlan, suggestFixes, alerts, nextOccurrence, mondayOf, addDays, type CalcProject, type Week } from './src/planner.ts';
import type { Project, Task } from './src/types.ts';

const W = '2026-09-21';
const work: CalcProject = { id: 1, kind: 'weekly', hours_per_week: 20 };
const code: CalcProject = { id: 2, kind: 'weekly', hours_per_week: 10, start_date: '2026-10-01', end_date: '2026-12-31' };
const thesis: CalcProject = { id: 3, kind: 'budget', total_hours: 100, end_date: '2026-12-20' };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const row = (r: Week, id: number) => r.rows.find((x) => x.project.id === id)!;

test('date helpers', () => {
  assert.equal(mondayOf('2026-09-27'), W); // Sunday
  assert.equal(mondayOf(W), W);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-10-25', 7), '2026-11-01'); // across DST end
});

test('worked example', () => {
  const r = computeWeek({ pensum: 60, projects: [work, code, thesis], logs: [{ project_id: 3, date: '2026-09-10', hours: 30 }] }, W);
  assert.equal(row(r, 1).required, 20);
  assert.equal(row(r, 2).required, 0);
  near(row(r, 3).required, 70 / 13);
  near(r.committed, 20 + 70 / 13);
  near(r.free, 60 - 20 - 70 / 13);
  assert.equal(r.overbooked, false);
});

test('weekly project outside its dates', () => {
  const r = computeWeek({ pensum: 60, projects: [code], logs: [] }, W);
  assert.equal(r.committed, 0);
  assert.equal(computeWeek({ pensum: 60, projects: [code], logs: [] }, '2026-12-28').committed, 10); // partial last week counts
  assert.equal(computeWeek({ pensum: 60, projects: [code], logs: [] }, '2027-01-04').committed, 0);
});

test('budget before its start', () => {
  const p = { ...thesis, start_date: '2026-10-05' };
  assert.equal(computeWeek({ pensum: 60, projects: [p], logs: [] }, W).committed, 0);
  assert.ok(computeWeek({ pensum: 60, projects: [p], logs: [] }, '2026-10-05').committed > 0);
});

test('overdue budget', () => {
  const r = computeWeek({ pensum: 60, projects: [thesis], logs: [{ project_id: 3, date: '2026-12-01', hours: 90 }] }, '2026-12-28');
  assert.equal(row(r, 3).required, 10);
  assert.equal(row(r, 3).overdue, true);
  const done = computeWeek({ pensum: 60, projects: [thesis], logs: [{ project_id: 3, date: '2026-12-01', hours: 100 }] }, '2026-12-28');
  assert.equal(row(done, 3).required, 0);
  assert.equal(row(done, 3).overdue, false);
});

test('deadline in the current week: weeksLeft = 1', () => {
  const r = computeWeek({ pensum: 60, projects: [thesis], logs: [] }, '2026-12-14');
  assert.equal(row(r, 3).required, 100);
  assert.equal(row(r, 3).overdue, false);
});

test('this week logs do not move the target; overbooked; archived skipped', () => {
  const logs = [{ project_id: 3, date: '2026-09-22', hours: 5 }];
  const r = computeWeek({ pensum: 20, projects: [work, thesis, { ...code, id: 9, archived: 1, start_date: null }], logs }, W);
  near(row(r, 3).required, 100 / 13);
  assert.equal(row(r, 3).logged, 5);
  assert.equal(r.loggedTotal, 5);
  assert.equal(r.overbooked, true);
  assert.equal(r.rows.length, 2);
});

test('forecast keeps budget hours even when you stick to the plan; overbooking shows in the right week', () => {
  const logs = [{ project_id: 3, date: '2026-09-10', hours: 30 }];
  const f = forecast({ pensum: 30, projects: [work, code, thesis], logs }, W, 14);
  assert.equal(f.length, 14);
  assert.equal(f[1].weekStart, '2026-09-28');
  for (const w of f.slice(0, 13)) near(row(w, 3).required, 70 / 13); // same share every week up to the deadline
  assert.equal(row(f[13], 3).required, 0); // after the deadline: done, not overdue
  assert.equal(row(f[13], 3).overdue, false);
  assert.deepEqual(f.map((w) => w.overbooked).slice(0, 3), [false, true, true]); // code starts 2026-10-01, in the second week
  assert.equal(logs.length, 1); // input not mutated
});

const task = (t: Partial<Task>): Task => ({ id: 1, project_id: 3, title: 'T', date: W, hours: 1, note: null, repeat: null, ...t });
const w3 = { ...work, days: '1,2,3', hours_per_week: 24 } as Project;
const WEEK_HOURS = [10, 10, 10, 10, 10, 5, 5]; // 60

test('planWeek: work on Mon-Wed splits hours; tasks land on their day; unscheduled = required - planned', () => {
  const tasks = [task({ title: 'Outline', date: '2026-09-24', hours: 2 })];
  const { days, planned } = planWeek({ pensum: 60, projects: [w3, thesis as Project], tasks }, W, W);
  assert.deepEqual(days.map((d) => d.fixed.length), [1, 1, 1, 0, 0, 0, 0]);
  assert.equal(days[0].hours, 8);
  assert.equal(days[3].tasks.length, 1);
  assert.equal(planned[1], 24);
  assert.equal(planned[3], 2);
});

test('weekday hours and days off shrink the pensum and fixed-day projects', () => {
  const base = { pensum: 60, week_hours: WEEK_HOURS, projects: [w3], logs: [] };
  assert.equal(computeWeek(base, W).pensum, 60);
  const overrides = [{ date: '2026-09-21', hours: 0, note: 'off' }, { date: '2026-09-22', hours: 4, note: 'half' }];
  const r = computeWeek({ ...base, overrides }, W);
  assert.equal(r.pensum, 44); // 60 - 10 (Mon off) - 6 (Tue 4h instead of 10h)
  assert.equal(r.daysOff, 1);
  assert.equal(row(r, 1).required, 16); // Mon off: 2 of 3 work days left
  assert.equal(planWeek({ ...base, overrides, tasks: [] }, W, W).days[0].fixed.length, 0);
  assert.equal(computeWeek({ ...base, overrides }, '2026-09-28').pensum, 60); // next week untouched
});

test('calendar events count as committed only when ics_counts is on', () => {
  const events = [{ date: '2026-09-22', start: '09:00', hours: 1.5, title: 'Standup' }, { date: '2026-09-24', start: '14:00', hours: 2, title: 'Review' }];
  const data = { pensum: 60, projects: [work], logs: [], events };
  assert.equal(computeWeek(data, W).committed, 20);
  const r = computeWeek({ ...data, ics_counts: true }, W);
  assert.equal(r.calendar, 3.5);
  assert.equal(r.committed, 23.5);
});

test('recurring tasks: next occurrence, rollover to today, upcoming occurrences shown', () => {
  assert.equal(nextOccurrence({ date: '2026-09-21', repeat: 'weekly' }, '2026-09-21'), '2026-09-28');
  assert.equal(nextOccurrence({ date: '2026-09-21', repeat: 'daily' }, '2026-09-23'), '2026-09-24'); // rolled, done on Wed
  assert.equal(nextOccurrence({ date: '2026-09-25', repeat: 'weekdays' }, '2026-09-25'), '2026-09-28'); // Fri → Mon

  const tasks = [task({ id: 1, date: '2026-09-21', title: 'Late' }), task({ id: 2, date: '2026-09-23', repeat: 'daily', title: 'Daily' })];
  const { days } = planWeek({ pensum: 60, projects: [], tasks }, W, '2026-09-23'); // today = Wed
  assert.equal(days[0].tasks.length, 0);
  assert.deepEqual(days[2].tasks.map((t) => [t.title, !!t.rolled, !!t.virtual]), [['Late', true, false], ['Daily', false, false]]);
  assert.deepEqual(days.slice(3).map((d) => d.tasks.length), [1, 1, 1, 1]);
  assert.ok(days[3].tasks[0].virtual);
});

test('autoPlan fills free hours from today, earliest deadline first, never past capacity', () => {
  const data = { pensum: 60, week_hours: [4, 4, 4, 4, 4, 0, 0], projects: [thesis as Project, { ...work, hours_per_week: 6 } as Project], logs: [], tasks: [] };
  const plan = autoPlan(data, W, '2026-09-23'); // Wed-Fri left: 12h capacity
  assert.ok(plan[0].project_id === 3); // earliest deadline picks first
  assert.equal(autoPlan({ ...data, week_hours: [8, 8, 8, 8, 8, 0, 0] }, W, '2026-09-23').filter((p) => p.project_id === 3).reduce((a, p) => a + p.hours, 0), 7.5); // room for all: 7.69 → quarter hours
  const total = (id: number) => plan.filter((p) => p.project_id === id).reduce((a, p) => a + p.hours, 0);
  const perDay = (d: string) => plan.filter((p) => p.date === d).reduce((a, p) => a + p.hours, 0);
  assert.ok(plan.every((p) => p.date >= '2026-09-23' && p.date <= '2026-09-25'));
  for (const d of ['2026-09-23', '2026-09-24', '2026-09-25']) assert.ok(perDay(d) <= 4);
  assert.equal(total(3) + total(1), 12); // needs 7.69 + 6, only 12h free: all of it used, both get some
  assert.ok(total(1) > 0);
  assert.ok(plan.every((p) => (p.hours * 4) % 1 === 0));
  // a project on fixed weekdays is already scheduled by its blocks, even the unlogged past ones
  assert.deepEqual(autoPlan({ ...data, projects: [w3] }, W, '2026-09-23'), []);
});

test('suggestFixes: each suggestion alone makes the week fit', () => {
  const data = { pensum: 30, projects: [work, thesis], logs: [{ project_id: 3, date: '2026-09-10', hours: 30 }] };
  const fixes = suggestFixes(data, W); // 20 + 5.38 = 25.38 → fits
  assert.equal(fixes.length, 0);
  const tight = { ...data, pensum: 22 }; // 3.38h over
  const all = suggestFixes(tight, W);
  assert.deepEqual(all.map((f) => [f.project.id, f.kind]), [[1, 'hours'], [1, 'archive'], [3, 'deadline']]);
  for (const f of all) {
    const projects = tight.projects.map((p) => p.id !== f.project.id ? p
      : f.kind === 'archive' ? { ...p, archived: 1 as const } : f.kind === 'hours' ? { ...p, hours_per_week: f.hours_per_week } : { ...p, end_date: f.end_date });
    assert.equal(computeWeek({ ...tight, projects }, W).overbooked, false, f.kind);
  }
  const deadline = suggestFixes({ ...data, pensum: 23 }, W).find((f) => f.kind === 'deadline')!; // 2.38h over, thesis 5.38h
  assert.ok(deadline && deadline.kind === 'deadline');
  const moved = [work, { ...thesis, end_date: deadline.end_date }];
  assert.equal(computeWeek({ ...data, pensum: 23, projects: moved }, W).overbooked, false);
  assert.equal(computeWeek({ ...data, pensum: 23, projects: [work, { ...thesis, end_date: addDays(deadline.end_date, -7) }] }, W).overbooked, true); // minimal
});

test('alerts: deadlines within 14 days, overdue, overbooked weeks ahead', () => {
  const p = (x: Partial<Project>) => ({ id: 3, name: 'Thesis', kind: 'budget', total_hours: 10, archived: 0, ...x }) as Project;
  const keys = (projects: Project[], pensum = 60) => alerts({ pensum, projects, logs: [] }, W).map((a) => a.key);
  assert.deepEqual(keys([p({ end_date: '2026-10-01' })]), ['due:3']);
  assert.deepEqual(keys([p({ end_date: '2026-12-01' })]), []);
  assert.deepEqual(keys([p({ end_date: '2026-09-20' })]), ['overdue:3']);
  assert.deepEqual(keys([w3], 10), ['over:2026-09-21', 'over:2026-09-28', 'over:2026-10-05', 'over:2026-10-12']);
});
