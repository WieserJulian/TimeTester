import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { today } from '../planner.js';
import { h, dl } from '../format.js';

export const ProjectOptions = ({ projects }) => projects.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>);

// With projectId: the quick-log form on the Week view. Without: the full form with a project picker.
export function LogForm({ projectId, onDone }) {
  const { state, submit } = useApp();
  const save = (f) => api('POST', '/api/logs', { project_id: projectId ?? Number(f.get('project_id')), date: f.get('date'), hours: Number(f.get('hours')), note: f.get('note') });
  return (
    <form className={`card ${projectId ? 'quick' : ''}`} onSubmit={submit(save, onDone)}>
      {!projectId && <label className="wide">Project <select name="project_id" required><ProjectOptions projects={state.projects} /></select></label>}
      <label>Hours <input name="hours" type="number" step="0.25" min="0.25" inputMode="decimal" required autoFocus={!!projectId} /></label>
      <label>Date <input name="date" type="date" defaultValue={today()} required /></label>
      <label className="wide">Note <input name="note" maxLength={200} /></label>
      <button className="primary wide">{projectId ? 'Log time' : 'Add entry'}</button>
    </form>
  );
}

export default function Log() {
  const { state, run } = useApp();
  const byId = Object.fromEntries(state.projects.map((p) => [p.id, p]));
  const entries = state.logs.slice(0, 50);
  return (
    <>
      <LogForm />
      <h3>Last entries</h3>
      {entries.length ? entries.map((l) => {
        const p = byId[l.project_id] || { name: '?', color: '#888' };
        return (
          <div key={l.id} className="card entry" style={{ '--c': p.color }}>
            <div><b>{p.name}</b> · {h(l.hours)}<br /><small>{dl(l.date)}{l.note && ` · ${l.note}`}</small></div>
            <button className="danger" onClick={() => run(() => api('DELETE', `/api/logs/${l.id}`))} aria-label="Delete entry">✕</button>
          </div>
        );
      }) : <p className="empty">Nothing logged yet.</p>}
    </>
  );
}
