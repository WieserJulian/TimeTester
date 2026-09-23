import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8787;
const DB_PATH = process.env.DB_PATH || '/data/timetester.db';
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
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
);`);

const q = {
  settings: db.prepare("SELECT value FROM settings WHERE key = 'pensum'"),
  setPensum: db.prepare("INSERT INTO settings (key, value) VALUES ('pensum', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
  projects: db.prepare('SELECT * FROM projects ORDER BY id'),
  project: db.prepare('SELECT * FROM projects WHERE id = ?'),
  addProject: db.prepare('INSERT INTO projects (name, color, kind, hours_per_week, total_hours, start_date, end_date, archived) VALUES (?,?,?,?,?,?,?,?)'),
  setProject: db.prepare('UPDATE projects SET name=?, color=?, kind=?, hours_per_week=?, total_hours=?, start_date=?, end_date=?, archived=? WHERE id=?'),
  delProject: db.prepare('DELETE FROM projects WHERE id = ?'),
  logs: db.prepare('SELECT * FROM logs ORDER BY date DESC, id DESC'),
  log: db.prepare('SELECT * FROM logs WHERE id = ?'),
  addLog: db.prepare('INSERT INTO logs (project_id, date, hours, note) VALUES (?,?,?,?)'),
  delLog: db.prepare('DELETE FROM logs WHERE id = ?'),
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s) => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isPos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const optDate = (v, name) => { if (v == null || v === '') return null; if (!isDate(v)) bad(`${name} must be YYYY-MM-DD`); return v; };

function cleanProject(b) {
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
  return [b.name.trim(), color, b.kind, hpw, total, start, end, b.archived ?? 0];
}

function cleanLog(b) {
  if (!Number.isInteger(b.project_id)) bad('project_id required');
  if (!isDate(b.date)) bad('date must be YYYY-MM-DD');
  if (!isPos(b.hours)) bad('hours must be > 0');
  if (b.note != null && typeof b.note !== 'string') bad('note must be a string');
  return [b.project_id, b.date, b.hours, b.note || null];
}

const state = () => ({ pensum: Number(q.settings.get()?.value ?? 60), projects: q.projects.all(), logs: q.logs.all() });

function api(method, parts, body) {
  const res = parts[1], id = Number(parts[2]);
  if (method === 'GET' && res === 'state') return state();
  if (method === 'PUT' && res === 'settings') {
    if (!isPos(body.pensum)) bad('pensum must be > 0');
    q.setPensum.run(String(body.pensum));
    return { pensum: body.pensum };
  }
  if (res === 'projects') {
    if (method === 'POST') return q.project.get(q.addProject.run(...cleanProject(body)).lastInsertRowid);
    const existing = Number.isInteger(id) && q.project.get(id);
    if (!existing) throw new HttpError(404, 'not found');
    if (method === 'PUT') { q.setProject.run(...cleanProject({ ...existing, ...body }), id); return q.project.get(id); }
    if (method === 'DELETE') { q.delProject.run(id); return { ok: true }; }
  }
  if (res === 'logs') {
    if (method === 'POST') return q.log.get(q.addLog.run(...cleanLog(body)).lastInsertRowid);
    if (method === 'DELETE' && Number.isInteger(id)) { q.delLog.run(id); return { ok: true }; }
  }
  throw new HttpError(404, 'not found');
}

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { if ((size += c.length) > 1e6) throw new HttpError(413, 'body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { const b = JSON.parse(Buffer.concat(chunks)); if (b && typeof b === 'object' && !Array.isArray(b)) return b; } catch {}
  return bad('body must be a JSON object');
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function serveStatic(url, res) {
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad path'); }
  const file = path.join(PUBLIC, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(PUBLIC + path.sep)) throw new HttpError(403, 'forbidden');
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(data);
  } catch { throw new HttpError(404, 'not found'); }
}

http.createServer(async (req, res) => {
  const json = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      return json(200, api(req.method, url.pathname.split('/').slice(1), body));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    await serveStatic(url, res);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message });
    if (String(e?.code).startsWith('ERR_SQLITE')) return json(400, { error: e.message }); // constraint / FK violations
    console.error(e); json(500, { error: 'internal error' });
  }
}).listen(PORT, () => console.log(`Time Tester on :${PORT}`));
