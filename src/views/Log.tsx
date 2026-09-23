import { useState } from 'react';
import { useApp } from '../App.tsx';
import { api } from '../api.ts';
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
      <label className="wide">Note <input name="note" maxLength={200} defaultValue={log?.note ?? ''} /></label>
      <div className="actions wide">
        <button className="primary">{log ? 'Save' : projectId ? 'Log time' : 'Add entry'}</button>
        {log && <button type="button" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  );
}

export default function Log() {
  const { state, run } = useApp();
  const [editing, setEditing] = useState<number | null>(null);
  const byId = Object.fromEntries(state.projects.map((p) => [p.id, p]));
  const entries = state.logs.slice(0, 50);
  return (
    <>
      <LogForm />
      <h3>Last entries</h3>
      {entries.length ? entries.map((l) => {
        if (editing === l.id) return <LogForm key={l.id} log={l} onDone={() => setEditing(null)} />;
        const p = byId[l.project_id] ?? { name: '?', color: '#888' };
        return (
          <div key={l.id} className="card entry" style={{ '--c': p.color }}>
            <div><b>{p.name}</b> · {h(l.hours)}<br /><small>{dl(l.date)}{l.note && ` · ${l.note}`}</small></div>
            <div className="actions">
              <button onClick={() => setEditing(l.id)}>Edit</button>
              <button className="danger" onClick={() => run(() => api('DELETE', `/api/logs/${l.id}`))} aria-label="Delete entry">✕</button>
            </div>
          </div>
        );
      }) : <p className="empty">Nothing logged yet.</p>}
    </>
  );
}
