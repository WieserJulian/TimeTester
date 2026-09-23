import { useState } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { computeWeek } from '../planner.js';
import { DAYS, h, dl, dshort, num } from '../format.js';

function describe(p) {
  if (p.kind === 'weekly') {
    const range = p.start_date || p.end_date ? ` · ${p.start_date ? dl(p.start_date) : '…'} → ${p.end_date ? dl(p.end_date) : '…'}` : '';
    const on = p.days ? ` on ${p.days.split(',').map((d) => DAYS[d - 1]).join(', ')}` : '';
    return `${h(p.hours_per_week)}/week${on}${range}`;
  }
  return `${h(p.total_hours)} by ${dl(p.end_date)}${p.start_date ? ` (from ${dl(p.start_date)})` : ''}`;
}

// Form draft (strings, days as array) → API body
const toBody = (d) => ({
  name: d.name, color: d.color, kind: d.kind, archived: d.archived ?? 0,
  hours_per_week: d.kind === 'weekly' ? num(d.hours_per_week) : null,
  total_hours: d.kind === 'budget' ? num(d.total_hours) : null,
  start_date: d.start_date || null, end_date: d.end_date || null,
  days: d.kind === 'weekly' && d.days.length ? [...d.days].sort().join(',') : null,
});

function ProjectForm({ project, onClose }) {
  const { state, weekStart, run } = useApp();
  const [d, setD] = useState(() => ({
    name: '', color: '#4f7cff', kind: 'weekly', ...project,
    hours_per_week: project?.hours_per_week ?? '', total_hours: project?.total_hours ?? '',
    start_date: project?.start_date ?? '', end_date: project?.end_date ?? '', days: project?.days ? project.days.split(',') : [],
  }));
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const toggleDay = (v) => setD({ ...d, days: d.days.includes(v) ? d.days.filter((x) => x !== v) : [...d.days, v] });
  const body = toBody(d);
  const weekly = d.kind === 'weekly';

  // Live preview: this week with the draft project included answers "do I still have time for this?"
  let preview = <div className="preview wide">Fill in the hours to see how this week would look.</div>;
  if (weekly ? body.hours_per_week > 0 : body.total_hours > 0 && body.end_date) {
    const id = project?.id ?? -1;
    const w = computeWeek({ ...state, projects: [...state.projects.filter((p) => p.id !== id), { ...body, id, archived: 0 }] }, weekStart);
    const mine = w.rows.find((r) => r.project.id === id);
    preview = (
      <div className={`preview wide ${w.overbooked ? 'bad' : ''}`}>
        Week of {dshort(weekStart)}: this project needs <b>{h(mine.required)}</b>. Committed {h(w.committed)} of {h(w.pensum)} → <b>{w.overbooked ? `${h(-w.free)} over` : `${h(w.free)} free`}</b>.
      </div>
    );
  }

  const save = async (e) => {
    e.preventDefault();
    const ok = await run(() => (project ? api('PUT', `/api/projects/${project.id}`, body) : api('POST', '/api/projects', body)), 'Saved');
    if (ok) onClose();
  };

  return (
    <form className="card" onSubmit={save}>
      <h3>{project ? 'Edit project' : 'New project'}</h3>
      <label className="wide">Name <input value={d.name} onChange={set('name')} required maxLength={80} autoFocus /></label>
      <div className="seg wide">
        <label><input type="radio" checked={weekly} onChange={() => setD({ ...d, kind: 'weekly' })} /> Hours per week</label>
        <label><input type="radio" checked={!weekly} onChange={() => setD({ ...d, kind: 'budget' })} /> Total budget</label>
      </div>
      {weekly ? (
        <>
          <label>Hours / week <input type="number" step="0.25" min="0.25" inputMode="decimal" value={d.hours_per_week} onChange={set('hours_per_week')} required /></label>
          <div className="seg wide">
            {DAYS.map((label, i) => (
              <label key={label}><input type="checkbox" checked={d.days.includes(String(i + 1))} onChange={() => toggleDay(String(i + 1))} /> {label}</label>
            ))}
          </div>
        </>
      ) : (
        <label>Total hours <input type="number" step="0.25" min="0.25" inputMode="decimal" value={d.total_hours} onChange={set('total_hours')} required /></label>
      )}
      <label>Color <input type="color" value={d.color} onChange={set('color')} /></label>
      <label>Start <span className="hint">(optional)</span> <input type="date" value={d.start_date} onChange={set('start_date')} /></label>
      <label>{weekly ? <>End <span className="hint">(optional)</span></> : 'Deadline'} <input type="date" value={d.end_date} onChange={set('end_date')} required={!weekly} /></label>
      {preview}
      <div className="actions wide"><button className="primary">Save</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  );
}

export default function Projects() {
  const { state, run } = useApp();
  const [editing, setEditing] = useState(null); // null = no form, 'new' or a project
  const list = [...state.projects].sort((a, b) => a.archived - b.archived);
  const del = (p) => confirm(`Delete "${p.name}" and all its logged hours?`) && run(() => api('DELETE', `/api/projects/${p.id}`));

  return (
    <>
      {editing
        ? <ProjectForm key={editing.id ?? 'new'} project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
        : <button className="primary" onClick={() => setEditing('new')}>+ Add project</button>}
      {list.length ? list.map((p) => (
        <div key={p.id} className={`card proj ${p.archived ? 'archived' : ''}`} style={{ '--c': p.color }}>
          <div><b>{p.name}</b>{p.archived ? <> <span className="badge gray">archived</span></> : null}<br /><small>{describe(p)}</small></div>
          <div className="actions">
            <button onClick={() => setEditing(p)}>Edit</button>
            <button onClick={() => run(() => api('PUT', `/api/projects/${p.id}`, { archived: p.archived ? 0 : 1 }))}>{p.archived ? 'Restore' : 'Archive'}</button>
            <button className="danger" onClick={() => del(p)}>Delete</button>
          </div>
        </div>
      )) : <p className="empty">No projects yet.</p>}
    </>
  );
}
