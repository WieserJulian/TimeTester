// API tests against a real server on a random port with a throwaway database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

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
  assert.deepEqual((await call('GET', '/api/state')).data, exp.data);
  assert.equal((await call('POST', '/api/import', { hello: 1 })).status, 400);
});
