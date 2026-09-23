import { computeWeek, mondayOf, addDays, today } from './planner.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let state = { pensum: 60, projects: [], logs: [] };
let weekStart = mondayOf(today());
let editing = null; // null = no form, 'new' or project id
let quick = null; // project id with the quick-log form open

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (n) => `${Math.round(n * 10) / 10}h`;
const dl = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dshort = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const pct = (n, of) => Math.max(0, Math.min(100, (n / of) * 100));

function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (toastEl.hidden = true), 4000);
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function load() {
  try { state = await api('GET', '/api/state'); } catch (e) { toast(`Can't load data: ${e.message}`); }
}

const projectOptions = (selected) => state.projects.filter((p) => !p.archived)
  .map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

// ---------- views ----------
function weekView() {
  const w = computeWeek(state, weekStart);
  const isNow = weekStart === mondayOf(today());
  const rows = w.rows.map((r) => {
    const p = r.project;
    return `
    <button class="row" data-act="quick" data-id="${p.id}" style="--c:${esc(p.color)}">
      <span class="name">${esc(p.name)} ${r.overdue ? '<span class="badge">overdue</span>' : ''}</span>
      <span class="nums"><b>${h(r.required)}</b> req · ${h(r.logged)} logged · <b class="${r.left > 0 ? '' : 'ok'}">${h(Math.max(0, r.left))}</b> left</span>
    </button>
    ${quick === p.id ? `
    <form class="card quick" data-form="quick">
      <input type="hidden" name="project_id" value="${p.id}">
      <label>Hours <input name="hours" type="number" step="0.25" min="0.25" inputmode="decimal" required autofocus></label>
      <label>Date <input name="date" type="date" value="${today()}" required></label>
      <label class="wide">Note <input name="note" maxlength="200"></label>
      <button class="primary">Log time</button>
    </form>` : ''}`;
  }).join('');

  return `
    <div class="picker">
      <button data-act="week-prev" aria-label="Previous week">◀</button>
      <div><b>${dshort(weekStart)} – ${dl(addDays(weekStart, 6))}</b>${isNow ? '' : '<br><a href="#" data-act="week-now">this week</a>'}</div>
      <button data-act="week-next" aria-label="Next week">▶</button>
    </div>
    ${w.overbooked ? `<div class="banner">Overbooked: ${h(w.committed)} committed vs a ${h(w.pensum)} pensum (${h(-w.free)} over).</div>` : ''}
    <div class="card">
      <div class="free ${w.overbooked ? 'bad' : ''}">${h(w.free)} <small>free of ${h(w.pensum)}</small></div>
      <div class="bar"><i class="c ${w.overbooked ? 'bad' : ''}" style="width:${pct(w.committed, w.pensum)}%"></i></div>
      <div class="legend">Committed ${h(w.committed)}</div>
      <div class="bar"><i class="l" style="width:${pct(w.loggedTotal, w.pensum)}%"></i></div>
      <div class="legend">Logged ${h(w.loggedTotal)}</div>
    </div>
    ${rows || '<p class="empty">No active projects this week. <a href="#projects">Add one</a>.</p>'}`;
}

function describe(p) {
  if (p.kind === 'weekly') {
    const range = p.start_date || p.end_date ? ` · ${p.start_date ? dl(p.start_date) : '…'} → ${p.end_date ? dl(p.end_date) : '…'}` : '';
    return `${h(p.hours_per_week)}/week${range}`;
  }
  return `${h(p.total_hours)} by ${dl(p.end_date)}${p.start_date ? ` (from ${dl(p.start_date)})` : ''}`;
}

function projectForm() {
  const p = editing === 'new' ? { kind: 'weekly', color: '#4f7cff' } : state.projects.find((x) => x.id === editing);
  return `
  <form class="card" data-form="project" data-kind="${p.kind}">
    <h3>${editing === 'new' ? 'New project' : 'Edit project'}</h3>
    <label class="wide">Name <input name="name" value="${esc(p.name)}" required maxlength="80"></label>
    <div class="seg wide">
      <label><input type="radio" name="kind" value="weekly" ${p.kind === 'weekly' ? 'checked' : ''}> Hours per week</label>
      <label><input type="radio" name="kind" value="budget" ${p.kind === 'budget' ? 'checked' : ''}> Total budget</label>
    </div>
    <label class="only-weekly">Hours / week <input name="hours_per_week" type="number" step="0.25" min="0.25" inputmode="decimal" value="${p.hours_per_week ?? ''}"></label>
    <label class="only-budget">Total hours <input name="total_hours" type="number" step="0.25" min="0.25" inputmode="decimal" value="${p.total_hours ?? ''}"></label>
    <label>Color <input name="color" type="color" value="${esc(p.color)}"></label>
    <label>Start <span class="hint">(optional)</span> <input name="start_date" type="date" value="${p.start_date ?? ''}"></label>
    <label><span class="only-weekly">End <span class="hint">(optional)</span></span><span class="only-budget">Deadline</span> <input name="end_date" type="date" value="${p.end_date ?? ''}"></label>
    <div class="preview wide" id="preview"></div>
    <div class="actions wide"><button class="primary">Save</button><button type="button" data-act="cancel-edit">Cancel</button></div>
  </form>`;
}

function projectsView() {
  const list = [...state.projects].sort((a, b) => a.archived - b.archived).map((p) => `
    <div class="card proj ${p.archived ? 'archived' : ''}" style="--c:${esc(p.color)}">
      <div><b>${esc(p.name)}</b>${p.archived ? ' <span class="badge gray">archived</span>' : ''}<br><small>${describe(p)}</small></div>
      <div class="actions">
        <button data-act="edit" data-id="${p.id}">Edit</button>
        <button data-act="${p.archived ? 'unarchive' : 'archive'}" data-id="${p.id}">${p.archived ? 'Restore' : 'Archive'}</button>
        <button class="danger" data-act="del-project" data-id="${p.id}">Delete</button>
      </div>
    </div>`).join('');
  return `${editing ? projectForm() : '<button class="primary" data-act="new-project">+ Add project</button>'}${list || '<p class="empty">No projects yet.</p>'}`;
}

function logView() {
  const names = Object.fromEntries(state.projects.map((p) => [p.id, p]));
  const entries = state.logs.slice(0, 50).map((l) => {
    const p = names[l.project_id] || { name: '?', color: '#888' };
    return `<div class="card entry" style="--c:${esc(p.color)}">
      <div><b>${esc(p.name)}</b> · ${h(l.hours)}<br><small>${dl(l.date)}${l.note ? ` · ${esc(l.note)}` : ''}</small></div>
      <button class="danger" data-act="del-log" data-id="${l.id}" aria-label="Delete entry">✕</button>
    </div>`;
  }).join('');
  return `
    <form class="card" data-form="log">
      <label class="wide">Project <select name="project_id" required>${projectOptions()}</select></label>
      <label>Date <input name="date" type="date" value="${today()}" required></label>
      <label>Hours <input name="hours" type="number" step="0.25" min="0.25" inputmode="decimal" required></label>
      <label class="wide">Note <input name="note" maxlength="200"></label>
      <button class="primary wide">Add entry</button>
    </form>
    <h3>Last entries</h3>${entries || '<p class="empty">Nothing logged yet.</p>'}`;
}

function settingsView() {
  return `
    <form class="card" data-form="settings">
      <label class="wide">Pensum: realistic hours per week <input name="pensum" type="number" step="0.5" min="0.5" inputmode="decimal" value="${state.pensum}" required></label>
      <button class="primary wide">Save</button>
    </form>`;
}

const views = { week: weekView, projects: projectsView, log: logView, settings: settingsView };
const currentView = () => (location.hash.slice(1) in views ? location.hash.slice(1) : 'week');

function render() {
  const v = currentView();
  app.innerHTML = views[v]();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === v));
  if (v === 'projects' && editing) updatePreview();
  app.querySelector('[autofocus]')?.focus();
}

// ---------- live preview ----------
function readDraft(form) {
  const f = new FormData(form), num = (k) => (f.get(k) === '' ? null : Number(f.get(k)));
  return { kind: f.get('kind'), name: f.get('name'), color: f.get('color'), hours_per_week: num('hours_per_week'), total_hours: num('total_hours'),
    start_date: f.get('start_date') || null, end_date: f.get('end_date') || null, archived: 0 };
}

function updatePreview() {
  const form = app.querySelector('form[data-form=project]'), box = document.getElementById('preview');
  const d = readDraft(form);
  const ok = d.kind === 'weekly' ? d.hours_per_week > 0 : d.total_hours > 0 && d.end_date;
  if (!ok) { box.textContent = 'Fill in the hours to see how this week would look.'; box.className = 'preview wide'; return; }
  const id = editing === 'new' ? -1 : editing;
  const w = computeWeek({ ...state, projects: [...state.projects.filter((p) => p.id !== id), { ...d, id }] }, weekStart);
  const mine = w.rows.find((r) => r.project.id === id);
  box.className = `preview wide ${w.overbooked ? 'bad' : ''}`;
  const free = w.overbooked ? `${h(-w.free)} over` : `${h(w.free)} free`;
  box.innerHTML = `Week of ${dshort(weekStart)}: this project needs <b>${h(mine.required)}</b>. Committed ${h(w.committed)} of ${h(w.pensum)} → <b>${free}</b>.`;
}

// ---------- events ----------
const actions = {
  'week-prev': () => (weekStart = addDays(weekStart, -7)),
  'week-next': () => (weekStart = addDays(weekStart, 7)),
  'week-now': () => (weekStart = mondayOf(today())),
  quick: (id) => (quick = quick === id ? null : id),
  'new-project': () => (editing = 'new'),
  edit: (id) => (editing = id),
  'cancel-edit': () => (editing = null),
  archive: (id) => api('PUT', `/api/projects/${id}`, { archived: 1 }).then(load),
  unarchive: (id) => api('PUT', `/api/projects/${id}`, { archived: 0 }).then(load),
  'del-project': (id) => confirm('Delete this project and all its logged hours?') && api('DELETE', `/api/projects/${id}`).then(load),
  'del-log': (id) => api('DELETE', `/api/logs/${id}`).then(load),
};

const forms = {
  async quick(f) { await api('POST', '/api/logs', logBody(f)); quick = null; },
  async log(f) { await api('POST', '/api/logs', logBody(f)); },
  async settings(f) { await api('PUT', '/api/settings', { pensum: Number(f.get('pensum')) }); },
  async project(f, form) {
    const d = readDraft(form);
    if (d.kind === 'weekly') d.total_hours = null; else d.hours_per_week = null;
    if (editing === 'new') await api('POST', '/api/projects', d); else await api('PUT', `/api/projects/${editing}`, d);
    editing = null;
  },
};
const logBody = (f) => ({ project_id: Number(f.get('project_id')), date: f.get('date'), hours: Number(f.get('hours')), note: f.get('note') });

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  try { await actions[el.dataset.act](el.dataset.id && Number(el.dataset.id)); } catch (err) { toast(err.message); }
  render();
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try { await forms[form.dataset.form](new FormData(form), form); await load(); toast('Saved'); } catch (err) { toast(err.message); }
  render();
});

app.addEventListener('input', (e) => {
  const form = e.target.closest('form[data-form=project]');
  if (!form) return;
  form.dataset.kind = form.kind.value;
  updatePreview();
});

window.addEventListener('hashchange', () => { editing = quick = null; render(); });

await load();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
