import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useApp } from '../App.tsx';
import { api } from '../api.ts';
import { computeWeek } from '../planner.ts';
import { DAYS, h, dl, dshort, num } from '../format.ts';
import type { Project } from '../types.ts';

function describe(p: Project) {
  if (p.kind === 'weekly') {
    const range = p.start_date || p.end_date ? ` · ${p.start_date ? dl(p.start_date) : '…'} → ${p.end_date ? dl(p.end_date) : '…'}` : '';
    const on = p.days ? ` on ${p.days.split(',').map((d) => DAYS[Number(d) - 1]).join(', ')}` : '';
    return `${h(p.hours_per_week!)}/week${on}${range}`;
  }
  return `${h(p.total_hours!)} by ${dl(p.end_date!)}${p.start_date ? ` (from ${dl(p.start_date)})` : ''}`;
}

// Form state: inputs hold strings, weekdays as an array.
interface Draft {
  name: string; color: string; kind: Project['kind']; archived: 0 | 1;
  hours_per_week: string; total_hours: string; start_date: string; end_date: string; days: string[];
}
const toDraft = (p: Project | null): Draft => ({
  name: p?.name ?? '', color: p?.color ?? '#4f7cff', kind: p?.kind ?? 'weekly', archived: p?.archived ?? 0,
  hours_per_week: String(p?.hours_per_week ?? ''), total_hours: String(p?.total_hours ?? ''),
  start_date: p?.start_date ?? '', end_date: p?.end_date ?? '', days: p?.days ? p.days.split(',') : [],
});
const toBody = (d: Draft) => ({
  name: d.name, color: d.color, kind: d.kind, archived: d.archived,
  hours_per_week: d.kind === 'weekly' ? num(d.hours_per_week) : null,
  total_hours: d.kind === 'budget' ? num(d.total_hours) : null,
  start_date: d.start_date || null, end_date: d.end_date || null,
  days: d.kind === 'weekly' && d.days.length ? [...d.days].sort().join(',') : null,
});

function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { state, weekStart, run } = useApp();
  const [d, setD] = useState(() => toDraft(project));
  const set = (k: keyof Draft) => (e: ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const toggleDay = (v: string) => setD({ ...d, days: d.days.includes(v) ? d.days.filter((x) => x !== v) : [...d.days, v] });
  const body = toBody(d);
  const weekly = d.kind === 'weekly';

  // Live preview: this week with the draft project included answers "do I still have time for this?"
  let preview = <div className="preview wide">Fill in the hours to see how this week would look.</div>;
  if (weekly ? body.hours_per_week! > 0 : body.total_hours! > 0 && body.end_date) {
    const id = project?.id ?? -1;
    const w = computeWeek({ ...state, projects: [...state.projects.filter((p) => p.id !== id), { ...body, id, archived: 0 as const }] }, weekStart);
    const mine = w.rows.find((r) => r.project.id === id)!;
    preview = (
      <div className={`preview wide ${w.overbooked ? 'bad' : ''}`}>
        Week of {dshort(weekStart)}: this project needs <b>{h(mine.required)}</b>. Committed {h(w.committed)} of {h(w.pensum)} → <b>{w.overbooked ? `${h(-w.free)} over` : `${h(w.free)} free`}</b>.
      </div>
    );
  }

  const save = async (e: FormEvent) => {
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
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null); // project id with the delete question open
  const list = [...state.projects].sort((a, b) => a.archived - b.archived);
  const setArchived = (p: Project, archived: 0 | 1) => run(() => api('PUT', `/api/projects/${p.id}`, { archived }));
  const logCount = (p: Project) => state.logs.filter((l) => l.project_id === p.id).length;

  return (
    <>
      {editing
        ? <ProjectForm key={editing === 'new' ? 'new' : editing.id} project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
        : <button className="primary" onClick={() => setEditing('new')}>+ Add project</button>}
      {list.length ? list.map((p) => (
        <div key={p.id} className={`card proj ${p.archived ? 'archived' : ''}`} style={{ '--c': p.color }}>
          <div><b>{p.name}</b>{p.archived ? <> <span className="badge gray">archived</span></> : null}<br /><small>{describe(p)}</small></div>
          {deleting === p.id ? (
            // Deleting also removes every logged hour, so offer the reversible option first.
            <div className="confirm">
              <span>Delete <b>{p.name}</b> and its {logCount(p)} log entries for good?{!p.archived && ' Archiving hides it but keeps the history.'}</span>
              <div className="actions">
                {!p.archived && <button className="primary" onClick={() => { setDeleting(null); setArchived(p, 1); }}>Archive instead</button>}
                <button className="danger" onClick={() => { setDeleting(null); run(() => api('DELETE', `/api/projects/${p.id}`)); }}>Delete forever</button>
                <button onClick={() => setDeleting(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <button onClick={() => setEditing(p)}>Edit</button>
              <button onClick={() => setArchived(p, p.archived ? 0 : 1)}>{p.archived ? 'Restore' : 'Archive'}</button>
              <button className="danger" onClick={() => setDeleting(p.id)}>Delete</button>
            </div>
          )}
        </div>
      )) : <p className="empty">No projects yet.</p>}
    </>
  );
}
