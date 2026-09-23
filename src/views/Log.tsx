import { useState } from 'react';
import { useApp } from '../App.tsx';
import { api, downloadCsv } from '../api.ts';
import { today } from '../planner.ts';
import { h, dl, str } from '../format.ts';
import type { Log as LogEntry, Project } from '../types.ts';

// Active projects, plus `keep` even if archived, so editing an old entry doesn't silently switch its project.
export const ProjectOptions = ({ projects, keep }: { projects: Project[]; keep?: number | null }) =>
  projects.filter((p) => !p.archived || p.id === keep).map((p) => <option key={p.id} value={p.id}>{p.name}</option>);

// projectId: quick-log on the Week view (project fixed). log: edit an entry. Neither: new entry with a project picker.
export function LogForm({ projectId, log, onDone }: { projectId?: number; log?: LogEntry; onDone?: () => void }) {
  const { state, submit } = useApp();
  const save = (f: FormData) => {
    const body = { project_id: projectId ?? Number(f.get('project_id')), date: str(f, 'date'), hours: Number(f.get('hours')), note: str(f, 'note') };
    return log ? api('PUT', `/api/logs/${log.id}`, body) : api('POST', '/api/logs', body);
  };
  return (
    <form className={`card ${projectId || log ? 'quick' : ''}`} onSubmit={submit(save, onDone)}>
      {!projectId && (
        <label className="wide">Project
          <select name="project_id" required defaultValue={log?.project_id}><ProjectOptions projects={state.projects} keep={log?.project_id} /></select>
        </label>
      )}
      <label>Hours <input name="hours" type="number" step="0.25" min="0.25" inputMode="decimal" required autoFocus={!!(projectId || log)} defaultValue={log?.hours} /></label>
      <label>Date <input name="date" type="date" defaultValue={log?.date ?? today()} required /></label>
      <label className="wide">Note <input name="note" maxLength={500} defaultValue={log?.note ?? ''} /></label>
      <div className="actions wide">
        <button className="primary">{log ? 'Save' : projectId ? 'Log time' : 'Add entry'}</button>
        {log && <button type="button" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

const SHOW = 100;

export default function Log() {
  const { state, undoable } = useApp();
  const [editing, setEditing] = useState<number | null>(null);
  const [f, setF] = useState({ project: '', from: '', to: '', q: '' });
  const [all, setAll] = useState(false);
  const byId = Object.fromEntries(state.projects.map((p) => [p.id, p]));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const filtered = !!(f.project || f.from || f.to || f.q);
  const q = f.q.toLowerCase();
  const matches = state.logs.filter((l) => (!f.project || l.project_id === Number(f.project)) && (!f.from || l.date >= f.from)
    && (!f.to || l.date <= f.to) && (!q || (l.note ?? '').toLowerCase().includes(q) || (byId[l.project_id]?.name ?? '').toLowerCase().includes(q)));
  const shown = all ? matches : matches.slice(0, SHOW);
  const total = matches.reduce((a, l) => a + l.hours, 0);

  const csv = () => downloadCsv(`timetester-log-${today()}.csv`, [['date', 'project', 'hours', 'note'],
    ...matches.map((l) => [l.date, byId[l.project_id]?.name ?? '', String(l.hours), l.note ?? ''])]);
  const del = (l: LogEntry) => undoable('Entry', () => api('DELETE', `/api/logs/${l.id}`),
    () => api('POST', '/api/logs', { project_id: l.project_id, date: l.date, hours: l.hours, note: l.note }));

  return (
    <>
      <LogForm />
      <h3>Entries</h3>
      <div className="card filters">
        <label>Project <select value={f.project} onChange={set('project')}><option value="">All</option>
          {state.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archived ? ' (archived)' : ''}</option>)}</select></label>
        <label>Search <input type="search" value={f.q} onChange={set('q')} placeholder="note or project" /></label>
        <label>From <input type="date" value={f.from} onChange={set('from')} /></label>
        <label>To <input type="date" value={f.to} onChange={set('to')} /></label>
        <div className="wide sumline">
          <span><b>{h(total)}</b> in {matches.length} entr{matches.length === 1 ? 'y' : 'ies'}</span>
          <span className="actions">
            {filtered && <button onClick={() => setF({ project: '', from: '', to: '', q: '' })}>Clear</button>}
            <button onClick={csv} disabled={!matches.length}>Export CSV</button>
          </span>
        </div>
      </div>
      {shown.length ? shown.map((l) => {
        if (editing === l.id) return <LogForm key={l.id} log={l} onDone={() => setEditing(null)} />;
        const p = byId[l.project_id] ?? { name: '?', color: '#888' };
        return (
          <div key={l.id} className="card entry" style={{ '--c': p.color }}>
            <div><b>{p.name}</b> · {h(l.hours)}<br /><small>{dl(l.date)}{l.note && ` · ${l.note}`}</small></div>
            <div className="actions">
              <button onClick={() => setEditing(l.id)}>Edit</button>
              <button className="danger" onClick={() => del(l)} aria-label="Delete entry">✕</button>
            </div>
          </div>
        );
      }) : <p className="empty">{filtered ? 'No entries match.' : 'Nothing logged yet.'}</p>}
      {!all && matches.length > SHOW && <button onClick={() => setAll(true)}>Show all {matches.length}</button>}
    </>
  );
}
