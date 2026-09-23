import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWeek, mondayOf, addDays } from './public/planner.js';

const W = '2026-09-21';
const work = { id: 1, kind: 'weekly', hours_per_week: 20 };
const code = { id: 2, kind: 'weekly', hours_per_week: 10, start_date: '2026-10-01', end_date: '2026-12-31' };
const thesis = { id: 3, kind: 'budget', total_hours: 100, end_date: '2026-12-20' };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const row = (r, id) => r.rows.find((x) => x.project.id === id);

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

test('planWeek: work on Mon-Wed splits hours; tasks land on their day; unscheduled = required - planned', async () => {
  const { planWeek } = await import('./public/planner.js');
  const w3 = { ...work, days: '1,2,3', hours_per_week: 24 };
  const tasks = [{ id: 1, project_id: 3, title: 'Outline', date: '2026-09-24', hours: 2 }];
  const { days, planned } = planWeek({ projects: [w3, thesis], tasks }, W);
  assert.deepEqual(days.map((d) => d.fixed.length), [1, 1, 1, 0, 0, 0, 0]);
  assert.equal(days[0].hours, 8);
  assert.equal(days[3].tasks.length, 1);
  assert.equal(planned[1], 24);
  assert.equal(planned[3], 2);
});
