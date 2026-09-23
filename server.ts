// Runs as-is on Node 22.18+ (built-in type stripping): `node server.ts`. No npm dependencies.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseIcs } from './ics.ts';

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || 'data/timetester.db';
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist'); // built by `npm run build`

mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4f7cff',
  kind TEXT NOT NULL CHECK (kind IN ('weekly','budget')),
  hours_per_week REAL,
  total_hours REAL,
  start_date TEXT,
  end_date TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  CHECK (kind <> 'weekly' OR hours_per_week > 0),
  CHECK (kind <> 'budget' OR (total_hours > 0 AND end_date IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours > 0),
  note TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours > 0)
);
CREATE TABLE IF NOT EXISTS day_overrides (
  date TEXT PRIMARY KEY,
  hours REAL NOT NULL CHECK (hours >= 0 AND hours <= 24),
  note TEXT
);`);
// Columns added after v1: migrate existing databases on startup.
const addColumn = (table: string, col: string, type: string) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
};
addColumn('projects', 'days', 'TEXT'); // weekdays a weekly project runs on, '1,2,3' = Mon-Wed
addColumn('tasks', 'note', 'TEXT');
addColumn('tasks', 'repeat', "TEXT CHECK (repeat IN ('daily','weekdays','weekly'))");

const PROJECT_COLS = 'name, color, kind, hours_per_week, total_hours, start_date, end_date, archived, days';
const q = {
  setting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  delSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
  projects: db.prepare('SELECT * FROM projects ORDER BY id'),
  project: db.prepare('SELECT * FROM projects WHERE id = ?'),
  addProject: db.prepare(`INSERT INTO projects (${PROJECT_COLS}) VALUES (?,?,?,?,?,?,?,?,?)`),
  setProject: db.prepare('UPDATE projects SET name=?, color=?, kind=?, hours_per_week=?, total_hours=?, start_date=?, end_date=?, archived=?, days=? WHERE id=?'),
  delProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  logs: db.prepare('SELECT * FROM logs ORDER BY date DESC, id DESC'),
  log: db.prepare('SELECT * FROM logs WHERE id = ?'),
  addLog: db.prepare('INSERT INTO logs (project_id, date, hours, note) VALUES (?,?,?,?)'),
  setLog: db.prepare('UPDATE logs SET project_id=?, date=?, hours=?, note=? WHERE id=?'),
  delLog: db.prepare('DELETE FROM logs WHERE id = ?'),
  tasks: db.prepare('SELECT * FROM tasks ORDER BY date, id'),
  task: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  addTask: db.prepare('INSERT INTO tasks (project_id, title, date, hours, note, repeat) VALUES (?,?,?,?,?,?)'),
  setTask: db.prepare('UPDATE tasks SET project_id=?, title=?, date=?, hours=?, note=?, repeat=? WHERE id=?'),
  delTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
  overrides: db.prepare('SELECT * FROM day_overrides ORDER BY date'),
  setOverride: db.prepare('INSERT INTO day_overrides (date, hours, note) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET hours = excluded.hours, note = excluded.note'),
  delOverride: db.prepare('DELETE FROM day_overrides WHERE date = ?'),
  // restore from a backup keeps the ids, so logs/tasks still point at their projects
  importProject: db.prepare(`INSERT INTO projects (${PROJECT_COLS}, id) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  importLog: db.prepare('INSERT INTO logs (project_id, date, hours, note, id) VALUES (?,?,?,?,?)'),
  importTask: db.prepare('INSERT INTO tasks (project_id, title, date, hours, note, repeat, id) VALUES (?,?,?,?,?,?,?)'),
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const bad = (msg: string): never => { throw new HttpError(400, msg); };

// Request bodies are untrusted JSON; every clean* function checks each field it uses.
type Body = Record<string, any>;
type Params = (string | number | null)[];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: unknown): s is string => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isPos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const isHours = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 24;
const optDate = (v: unknown, name: string) => { if (v == null || v === '') return null; if (!isDate(v)) bad(`${name} must be YYYY-MM-DD`); return v as string; };
const optText = (v: unknown, name: string, max = 500) => { if (v != null && typeof v !== 'string') bad(`${name} must be a string`); return (v as string | null)?.trim().slice(0, max) || null; };

function cleanProject(b: Body): Params {
  if (typeof b.name !== 'string' || !b.name.trim()) bad('name required');
  if (b.kind !== 'weekly' && b.kind !== 'budget') bad("kind must be 'weekly' or 'budget'");
  const color = b.color ?? '#4f7cff';
  if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) bad('color must be #rrggbb');
  const start = optDate(b.start_date, 'start_date'), end = optDate(b.end_date, 'end_date');
  if (start && end && end < start) bad('end_date before start_date');
  let hpw = null, total = null;
  if (b.kind === 'weekly') { if (!isPos(b.hours_per_week)) bad('hours_per_week must be > 0'); hpw = b.hours_per_week; }
  else { if (!isPos(b.total_hours)) bad('total_hours must be > 0'); if (!end) bad('deadline (end_date) required'); total = b.total_hours; }
  if (b.archived != null && b.archived !== 0 && b.archived !== 1) bad('archived must be 0 or 1');
  let days = null;
  if (b.kind === 'weekly' && b.days) {
    if (typeof b.days !== 'string' || !/^[1-7](,[1-7])*$/.test(b.days)) bad('days must look like 1,2,3 (Mon=1)');
    days = [...new Set(b.days.split(','))].sort().join(',');
  }
  return [b.name.trim(), color, b.kind, hpw, total, start, end, b.archived ?? 0, days];
}

function cleanLog(b: Body): Params {
  if (!Number.isInteger(b.project_id)) bad('project_id required');
  if (!isDate(b.date)) bad('date must be YYYY-MM-DD');
  if (!isPos(b.hours)) bad('hours must be > 0');
  return [b.project_id, b.date, b.hours, optText(b.note, 'note')];
}

function cleanTask(b: Body): Params {
  if (typeof b.title !== 'string' || !b.title.trim()) bad('title required');
  if (b.project_id != null && !Number.isInteger(b.project_id)) bad('project_id must be an integer');
  if (!isDate(b.date)) bad('date must be YYYY-MM-DD');
  if (!isPos(b.hours)) bad('hours must be > 0');
  if (b.repeat != null && !['daily', 'weekdays', 'weekly'].includes(b.repeat)) bad("repeat must be 'daily', 'weekdays' or 'weekly'");
  return [b.project_id ?? null, b.title.trim().slice(0, 200), b.date, b.hours, optText(b.note, 'note', 2000), b.repeat ?? null];
}

// ---------- settings ----------
const getJson = <T>(key: string, fallback: T): T => { const v = q.setting.get(key)?.value; return v == null ? fallback : JSON.parse(String(v)); };
const setJson = (key: string, v: unknown) => q.setSetting.run(key, JSON.stringify(v));
// Hours per weekday, Mon..Sun. Databases from before this setting only have a weekly 'pensum': spread it over 7 days.
const weekHours = (): number[] => getJson('week_hours', null) ?? Array(7).fill(Number(q.setting.get('pensum')?.value ?? 60) / 7);

function saveSettings(b: Body) {
  if (b.week_hours !== undefined) {
    if (!Array.isArray(b.week_hours) || b.week_hours.length !== 7 || !b.week_hours.every(isHours)) bad('week_hours must be 7 numbers from 0 to 24');
    if (!b.week_hours.some((x: number) => x > 0)) bad('week_hours must have at least one working day');
    setJson('week_hours', b.week_hours);
  } else if (b.pensum !== undefined) { // older clients: a weekly total, spread evenly
    if (!isPos(b.pensum) || b.pensum > 168) bad('pensum must be > 0');
    setJson('week_hours', Array(7).fill(b.pensum / 7));
  }
  if (b.ics_url !== undefined) {
    const url = optText(b.ics_url, 'ics_url', 2000) ?? '';
    if (url && !/^(https?|webcal):\/\//i.test(url)) bad('calendar link must start with https:// or webcal://');
    setJson('ics_url', url);
    calendar.at = 0; // refetch
  }
  if (b.ics_counts !== undefined) { if (typeof b.ics_counts !== 'boolean') bad('ics_counts must be true or false'); setJson('ics_counts', b.ics_counts); }
}

// ---------- calendar (iCal link) ----------
// ponytail: one in-memory cache, refreshed at most every 15 min when /api/state is loaded; fine for one user.
const calendar = { url: '', at: 0, events: [] as ReturnType<typeof parseIcs>, error: null as string | null };
async function calendarEvents() {
  const url = getJson<string>('ics_url', '');
  if (!url) return { events: [], error: null };
  if (url !== calendar.url || Date.now() - calendar.at > 15 * 60e3) {
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    try {
      const res = await fetch(url.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`calendar answered HTTP ${res.status}`);
      Object.assign(calendar, { events: parseIcs(await res.text(), day(-400), day(200)), error: null });
    } catch (e) {
      if (url !== calendar.url) calendar.events = [];
      calendar.error = `Calendar not updated: ${(e as Error).message}`;
    }
    Object.assign(calendar, { url, at: Date.now() });
  }
  return { events: calendar.events, error: calendar.error };
}

// ---------- state, backup ----------
const backupData = () => {
  const week_hours = weekHours();
  return {
    pensum: week_hours.reduce((a, b) => a + b, 0), week_hours, overrides: q.overrides.all(),
    ics_url: getJson('ics_url', ''), ics_counts: getJson('ics_counts', false),
    projects: q.projects.all(), logs: q.logs.all(), tasks: q.tasks.all(),
  };
};
async function state() {
  const { events, error } = await calendarEvents();
  return { ...backupData(), timer: getJson('timer', null), events, ics_error: error };
}

// Replaces everything with a backup made by GET /api/export. All-or-nothing. Older backups
// without week_hours/overrides/calendar settings restore fine.
function restore(b: Body) {
  if (!isPos(b.pensum) || ![b.projects, b.logs, b.tasks].every(Array.isArray)) bad('not a Time Tester backup');
  const id = (r: Body) => (Number.isInteger(r?.id) ? r.id : bad('every row needs an integer id'));
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM tasks; DELETE FROM logs; DELETE FROM projects; DELETE FROM day_overrides;');
    saveSettings({ week_hours: b.week_hours, pensum: b.pensum, ics_url: b.ics_url ?? '', ics_counts: b.ics_counts ?? false });
    for (const o of b.overrides ?? []) q.setOverride.run(...cleanOverride(o.date, o));
    for (const p of b.projects) q.importProject.run(...cleanProject(p), id(p));
    for (const l of b.logs) q.importLog.run(...cleanLog(l), id(l));
    for (const t of b.tasks) q.importTask.run(...cleanTask(t), id(t));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return backupData();
}

function cleanOverride(date: unknown, b: Body): Params {
  if (!isDate(date)) bad('date must be YYYY-MM-DD');
  if (!isHours(b.hours)) bad('hours must be 0 to 24 (0 = day off)');
  return [date as string, b.hours, optText(b.note, 'note', 200)];
}

// Days off / special days for one date or a range (a vacation). Existing entries are replaced.
function saveOverrides(b: Body) {
  const from = b.from, to = b.to ?? b.from;
  if (!isDate(from) || !isDate(to) || to < from) bad('from/to must be dates, to not before from');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
  if (days > 366) bad('at most one year at a time');
  for (let i = 0; i <= days; i++) q.setOverride.run(...cleanOverride(new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10), b));
  return q.overrides.all();
}

// One CRUD handler per table: POST creates, PUT merges into the existing row, DELETE removes.
type Crud = { get: typeof q.log; add: typeof q.log; set: typeof q.log; del: typeof q.log; clean: (b: Body) => Params };
const crud: Record<string, Crud> = {
  projects: { get: q.project, add: q.addProject, set: q.setProject, del: q.delProject, clean: cleanProject },
  logs: { get: q.log, add: q.addLog, set: q.setLog, del: q.delLog, clean: cleanLog },
  tasks: { get: q.task, add: q.addTask, set: q.setTask, del: q.delTask, clean: cleanTask },
};

async function api(method: string, parts: string[], body: Body) {
  const res = parts[1], arg = parts[2];
  if (method === 'GET' && res === 'state') return state();
  if (method === 'GET' && res === 'export') return backupData();
  if (method === 'POST' && res === 'import') return restore(body);
  if (method === 'PUT' && res === 'settings') { saveSettings(body); return backupData(); }
  if (res === 'timer') { // one running timer, kept on the server so it survives closing the app
    if (method === 'PUT') {
      if (!Number.isInteger(body.project_id) || !q.project.get(body.project_id)) bad('project_id must be an existing project');
      if (!isPos(body.started_at) || body.started_at > Date.now() + 60e3) bad('started_at must be a time in ms, not in the future');
      setJson('timer', { project_id: body.project_id, started_at: body.started_at });
      return getJson('timer', null);
    }
    if (method === 'DELETE') { q.delSetting.run('timer'); return { ok: true }; }
  }
  if (res === 'overrides') {
    if (method === 'POST') return saveOverrides(body);
    if (method === 'DELETE' && isDate(arg)) { q.delOverride.run(arg); return { ok: true }; }
  }
  const t = crud[res], id = Number(arg);
  if (t) {
    if (method === 'POST') return t.get.get(t.add.run(...t.clean(body)).lastInsertRowid);
    const existing = Number.isInteger(id) && t.get.get(id);
    if (!existing) throw new HttpError(404, 'not found');
    if (method === 'PUT') { t.set.run(...t.clean({ ...existing, ...body }), id); return t.get.get(id); }
    if (method === 'DELETE') { t.del.run(id); return { ok: true }; }
  }
  throw new HttpError(404, 'not found');
}

async function readBody(req: http.IncomingMessage): Promise<Body> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { if ((size += c.length) > 1e7) throw new HttpError(413, 'body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { const b = JSON.parse(Buffer.concat(chunks).toString()); if (b && typeof b === 'object' && !Array.isArray(b)) return b; } catch {}
  return bad('body must be a JSON object');
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function serveStatic(url: URL, res: http.ServerResponse) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad path'); }
  const file = path.join(PUBLIC, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(PUBLIC + path.sep)) throw new HttpError(403, 'forbidden');
  let data;
  try { data = await readFile(file); } catch { throw new HttpError(404, 'not found'); }
  // Vite puts content-hashed files in /assets/, so those never change under the same name
  const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': cache }).end(data);
}

export const server = http.createServer(async (req, res) => {
  const json = (status: number, obj: unknown, headers = {}) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(obj));
  try {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const parts = url.pathname.split('/').slice(1);
      const download = parts[1] === 'export' ? { 'content-disposition': `attachment; filename="timetester-${new Date().toISOString().slice(0, 10)}.json"` } : {};
      return json(200, await api(req.method!, parts, body), download);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    await serveStatic(url, res);
  } catch (e: any) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    if (String(e?.code).startsWith('ERR_SQLITE')) return json(400, { error: e.message }); // constraint / FK violations
    console.error(e); json(500, { error: 'internal error' });
  }
});

// Started directly (`node server.ts`) → listen. Imported (tests) → the caller listens.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) server.listen(PORT, () => console.log(`Time Tester on :${PORT}`));
