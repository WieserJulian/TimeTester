// Runs as-is on Node 22.18+ (built-in type stripping): `node server.ts`. No npm dependencies.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
);`);
// weekdays a weekly project runs on, '1,2,3' = Mon-Wed (added after v1, so migrate existing DBs)
if (!db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'days')) db.exec('ALTER TABLE projects ADD COLUMN days TEXT');

const PROJECT_COLS = 'name, color, kind, hours_per_week, total_hours, start_date, end_date, archived, days';
const q = {
  settings: db.prepare("SELECT value FROM settings WHERE key = 'pensum'"),
  setPensum: db.prepare("INSERT INTO settings (key, value) VALUES ('pensum', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
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
  addTask: db.prepare('INSERT INTO tasks (project_id, title, date, hours) VALUES (?,?,?,?)'),
  setTask: db.prepare('UPDATE tasks SET project_id=?, title=?, date=?, hours=? WHERE id=?'),
  delTask: db.prepare('DELETE FROM tasks WHERE id = ?'),
  // restore from a backup keeps the ids, so logs/tasks still point at their projects
  importProject: db.prepare(`INSERT INTO projects (${PROJECT_COLS}, id) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  importLog: db.prepare('INSERT INTO logs (project_id, date, hours, note, id) VALUES (?,?,?,?,?)'),
  importTask: db.prepare('INSERT INTO tasks (project_id, title, date, hours, id) VALUES (?,?,?,?,?)'),
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
const optDate = (v: unknown, name: string) => { if (v == null || v === '') return null; if (!isDate(v)) bad(`${name} must be YYYY-MM-DD`); return v as string; };

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
  if (b.note != null && typeof b.note !== 'string') bad('note must be a string');
  return [b.project_id, b.date, b.hours, b.note || null];
}

function cleanTask(b: Body): Params {
  if (typeof b.title !== 'string' || !b.title.trim()) bad('title required');
  if (b.project_id != null && !Number.isInteger(b.project_id)) bad('project_id must be an integer');
  if (!isDate(b.date)) bad('date must be YYYY-MM-DD');
  if (!isPos(b.hours)) bad('hours must be > 0');
  return [b.project_id ?? null, b.title.trim().slice(0, 200), b.date, b.hours];
}

const state = () => ({ pensum: Number(q.settings.get()?.value ?? 60), projects: q.projects.all(), logs: q.logs.all(), tasks: q.tasks.all() });

// Replaces everything with a backup made by GET /api/export. All-or-nothing.
function restore(b: Body) {
  if (!isPos(b.pensum) || ![b.projects, b.logs, b.tasks].every(Array.isArray)) bad('not a Time Tester backup');
  const id = (r: Body) => (Number.isInteger(r?.id) ? r.id : bad('every row needs an integer id'));
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM tasks; DELETE FROM logs; DELETE FROM projects;');
    q.setPensum.run(String(b.pensum));
    for (const p of b.projects) q.importProject.run(...cleanProject(p), id(p));
    for (const l of b.logs) q.importLog.run(...cleanLog(l), id(l));
    for (const t of b.tasks) q.importTask.run(...cleanTask(t), id(t));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return state();
}

// One CRUD handler per table: POST creates, PUT merges into the existing row, DELETE removes.
type Crud = { get: typeof q.log; add: typeof q.log; set: typeof q.log; del: typeof q.log; clean: (b: Body) => Params };
const crud: Record<string, Crud> = {
  projects: { get: q.project, add: q.addProject, set: q.setProject, del: q.delProject, clean: cleanProject },
  logs: { get: q.log, add: q.addLog, set: q.setLog, del: q.delLog, clean: cleanLog },
  tasks: { get: q.task, add: q.addTask, set: q.setTask, del: q.delTask, clean: cleanTask },
};

function api(method: string, parts: string[], body: Body) {
  const res = parts[1], id = Number(parts[2]);
  if (method === 'GET' && (res === 'state' || res === 'export')) return state();
  if (method === 'POST' && res === 'import') return restore(body);
  if (method === 'PUT' && res === 'settings') {
    if (!isPos(body.pensum)) bad('pensum must be > 0');
    q.setPensum.run(String(body.pensum));
    return { pensum: body.pensum };
  }
  const t = crud[res];
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
      return json(200, api(req.method!, parts, body), download);
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
