// API tests against a real server on a random port with a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';

const dir = mkdtempSync(path.join(tmpdir(), 'timetester-'));
process.env.DB_PATH = path.join(dir, 'test.db');
let server: Server, db: { close(): void }, base: string;

before(async () => {
  ({ server, db } = await import('./server.ts'));
  await new Promise<void>((ok) => server.listen(0, ok));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => { server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

test('validation rejects bad input with 400', async () => {
  for (const [url, body] of [
    ['/api/projects', { name: '', kind: 'weekly', hours_per_week: 5 }],
    ['/api/projects', { name: 'X', kind: 'monthly' }],
    ['/api/projects', { name: 'X', kind: 'weekly', hours_per_week: -1 }],
    ['/api/projects', { name: 'X', kind: 'budget', total_hours: 10 }], // no deadline
    ['/api/projects', { name: 'X', kind: 'weekly', hours_per_week: 5, start_date: '2026-13-45' }],
    ['/api/projects', { name: 'X', kind: 'weekly', hours_per_week: 5, color: 'red' }],
    ['/api/logs', { project_id: 1, date: 'today', hours: 1 }],
    ['/api/logs', { project_id: 999, date: '2026-09-21', hours: 1 }], // FK violation
    ['/api/tasks', { title: ' ', date: '2026-09-21', hours: 1 }],
  ] as const) {
    const r = await call('POST', url, body);
    assert.equal(r.status, 400, `${url} ${JSON.stringify(body)} → ${r.status}`);
    assert.ok(r.data.error);
  }
  assert.equal((await call('PUT', '/api/settings', { pensum: 0 })).status, 400);
  assert.equal((await call('PUT', '/api/logs/12345', { hours: 1 })).status, 404);
});

test('create, edit, delete; deleting a project cascades to its logs and tasks', async () => {
  const p = (await call('POST', '/api/projects', { name: ' Thesis ', kind: 'budget', total_hours: 100, end_date: '2026-12-20' })).data;
  assert.equal(p.name, 'Thesis');
  const l = (await call('POST', '/api/logs', { project_id: p.id, date: '2026-09-21', hours: 2 })).data;
  const t = (await call('POST', '/api/tasks', { project_id: p.id, title: 'Outline', date: '2026-09-22', hours: 3 })).data;

  const l2 = await call('PUT', `/api/logs/${l.id}`, { hours: 2.5, note: 'fixed' });
  assert.equal(l2.data.hours, 2.5);
  assert.equal(l2.data.date, '2026-09-21'); // untouched fields kept
  const t2 = await call('PUT', `/api/tasks/${t.id}`, { date: '2026-09-23' });
  assert.equal(t2.data.date, '2026-09-23');
  assert.equal((await call('PUT', `/api/logs/${l.id}`, { hours: 0 })).status, 400);

  const archived = await call('PUT', `/api/projects/${p.id}`, { archived: 1 });
  assert.equal(archived.data.archived, 1);
  assert.equal(archived.data.total_hours, 100);

  await call('DELETE', `/api/projects/${p.id}`);
  const s = (await call('GET', '/api/state')).data;
  assert.ok(!s.logs.some((x: { id: number }) => x.id === l.id));
  assert.ok(!s.tasks.some((x: { id: number }) => x.id === t.id));
});

test('export → import restores the same data; a broken backup changes nothing', async () => {
  const p = (await call('POST', '/api/projects', { name: 'Work', kind: 'weekly', hours_per_week: 20, days: '3,1' })).data;
  assert.equal(p.days, '1,3');
  await call('POST', '/api/logs', { project_id: p.id, date: '2026-09-21', hours: 4, note: 'x' });
  await call('PUT', '/api/settings', { pensum: 42 });
  const exp = await call('GET', '/api/export');
  assert.match(exp.headers.get('content-disposition') ?? '', /attachment/);

  await call('POST', '/api/projects', { name: 'Later', kind: 'weekly', hours_per_week: 1 });
  const bad = await call('POST', '/api/import', { ...exp.data, logs: [{ id: 1, project_id: 999, date: '2026-09-21', hours: 1 }] });
  assert.equal(bad.status, 400);
  assert.equal((await call('GET', '/api/state')).data.projects.length, 2); // rolled back

  const r = await call('POST', '/api/import', exp.data);
  assert.equal(r.status, 200);
  assert.deepEqual((await call('GET', '/api/export')).data, exp.data);
  assert.equal((await call('POST', '/api/import', { hello: 1 })).status, 400);
  // a backup from before week_hours/overrides existed still restores
  const old = { pensum: 35, projects: [], logs: [], tasks: [] };
  assert.equal((await call('POST', '/api/import', old)).status, 200);
  assert.deepEqual((await call('GET', '/api/state')).data.week_hours, Array(7).fill(5));
});

test('weekday hours, days off, timer, recurring tasks', async () => {
  const week_hours = [10, 10, 10, 10, 10, 5, 5];
  assert.equal((await call('PUT', '/api/settings', { week_hours })).data.pensum, 60);
  assert.equal((await call('PUT', '/api/settings', { week_hours: [1, 2, 3] })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { week_hours: Array(7).fill(0) })).status, 400);

  const o = await call('POST', '/api/overrides', { from: '2026-12-24', to: '2026-12-26', hours: 0, note: 'Christmas' });
  assert.deepEqual(o.data.map((x: { date: string }) => x.date), ['2026-12-24', '2026-12-25', '2026-12-26']);
  await call('POST', '/api/overrides', { from: '2026-12-24', hours: 4 }); // replaces
  await call('DELETE', '/api/overrides/2026-12-26');
  assert.deepEqual((await call('GET', '/api/state')).data.overrides.map((x: { date: string; hours: number }) => [x.date, x.hours]), [['2026-12-24', 4], ['2026-12-25', 0]]);
  assert.equal((await call('POST', '/api/overrides', { from: '2026-12-24', hours: 30 })).status, 400);
  assert.equal((await call('POST', '/api/overrides', { from: '2026-12-24', to: '2026-12-01', hours: 0 })).status, 400);

  const p = (await call('POST', '/api/projects', { name: 'Timer', kind: 'weekly', hours_per_week: 1 })).data;
  assert.equal((await call('PUT', '/api/timer', { project_id: p.id, started_at: Date.now() + 3600e3 })).status, 400);
  assert.equal((await call('PUT', '/api/timer', { project_id: 99999, started_at: Date.now() })).status, 400);
  const started = Date.now() - 60e3;
  await call('PUT', '/api/timer', { project_id: p.id, started_at: started });
  assert.deepEqual((await call('GET', '/api/state')).data.timer, { project_id: p.id, started_at: started });
  await call('DELETE', '/api/timer');
  assert.equal((await call('GET', '/api/state')).data.timer, null);

  const t = (await call('POST', '/api/tasks', { title: 'Review', date: '2026-09-25', hours: 1, repeat: 'weekly', note: 'check drafts' })).data;
  assert.equal(t.repeat, 'weekly');
  assert.equal(t.note, 'check drafts');
  assert.equal((await call('PUT', `/api/tasks/${t.id}`, { repeat: 'monthly' })).status, 400);
  assert.equal((await call('PUT', `/api/tasks/${t.id}`, { repeat: null })).data.repeat, null);
});

test('calendar link: events come from the iCal feed; bad links are rejected or reported', async () => {
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const d = day.replaceAll('-', ''); // the server only keeps events within about a year of today
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', `DTSTART:${d}T090000`, `DTEND:${d}T100000`, 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const feed = createServer((req, res) => (req.url === '/cal.ics' ? res.end(ics) : res.writeHead(404).end()));
  await new Promise<void>((ok) => feed.listen(0, ok));
  const at = `http://localhost:${(feed.address() as AddressInfo).port}`;
  try {
    assert.equal((await call('PUT', '/api/settings', { ics_url: 'file:///etc/passwd' })).status, 400);
    await call('PUT', '/api/settings', { ics_url: `${at}/cal.ics`, ics_counts: true });
    const s = (await call('GET', '/api/state')).data;
    assert.deepEqual(s.events, [{ date: day, start: '09:00', hours: 1, title: 'Standup' }]);
    assert.equal(s.ics_counts, true);
    assert.equal(s.ics_error, null);
    await call('PUT', '/api/settings', { ics_url: `${at}/missing.ics` });
    const broken = (await call('GET', '/api/state')).data;
    assert.match(broken.ics_error, /404/);
    assert.deepEqual(broken.events, []);
  } finally {
    feed.close();
    await call('PUT', '/api/settings', { ics_url: '' });
  }
});
