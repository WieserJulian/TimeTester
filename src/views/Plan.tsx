import { useState } from 'react';
import { useApp } from '../App.tsx';
import { api } from '../api.ts';
import { autoPlan, computeWeek, planWeek, nextOccurrence, addDays, today, type PlanTask } from '../planner.ts';
import { h, dday, str, weekdayName, parseHours } from '../format.ts';
import { HoursInput } from '../HoursInput.tsx';
import type { Task } from '../types.ts';
import { WeekPicker } from './Week.tsx';
import { ProjectOptions } from './Log.tsx';

const REPEAT = { '': 'Once', daily: 'Every day', weekdays: 'Every weekday (Mon–Fri)', weekly: 'Every week' } as const;

// New task on `date`, or edit `task` (then the date can change too, to move it to another day).
function TaskForm({ date, task, onDone }: { date: string; task?: Task; onDone: () => void }) {
  const { state, submit } = useApp();
  const save = (f: FormData) => {
    const body = {
      title: str(f, 'title'), date: str(f, 'date'), hours: parseHours(str(f, 'hours')), note: str(f, 'note'),
      project_id: f.get('project_id') ? Number(f.get('project_id')) : null, repeat: str(f, 'repeat') || null,
    };
    return task ? api('PUT', `/api/tasks/${task.id}`, body) : api('POST', '/api/tasks', body);
  };
  return (
    <form className="quick" onSubmit={submit(save, onDone)}>
      <label className="wide">Task <input name="title" required maxLength={200} autoFocus defaultValue={task?.title} /></label>
      <label>Hours <HoursInput value={task?.hours} /></label>
      <label>Project
        <select name="project_id" defaultValue={task?.project_id ?? ''}><option value="">–</option><ProjectOptions projects={state.projects} keep={task?.project_id} /></select>
      </label>
      <label>{task ? 'Day' : 'Starts'} <input name="date" type="date" required defaultValue={task?.date ?? date} /></label>
      <label>Repeat
        <select name="repeat" defaultValue={task?.repeat ?? ''}>{Object.entries(REPEAT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label className="wide">Note <textarea name="note" rows={2} maxLength={2000} defaultValue={task?.note ?? ''} /></label>
      <div className="actions wide">
        <button className="primary">{task ? 'Save' : 'Add task'}</button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export default function Plan() {
  const { state, weekStart, run, undoable } = useApp();
  const [open, setOpen] = useState<string | number | null>(null); // a date = add-task form, a task id = edit form
  const now = today();
  const { days, planned } = planWeek(state, weekStart, now);
  const w = computeWeek(state, weekStart);
  const byId = Object.fromEntries(state.projects.map((p) => [p.id, p]));
  const todo = w.rows.map((r) => ({ ...r, todo: r.required - r.logged - (planned[r.project.id] || 0) })).filter((r) => r.todo > 0.05);
  const close = () => setOpen(null);
  const canAutoPlan = addDays(weekStart, 6) >= now && todo.length > 0;

  const body = (t: Task) => ({ title: t.title, date: t.date, hours: t.hours, note: t.note, project_id: t.project_id, repeat: t.repeat });
  const delTask = (t: Task) => undoable(t.repeat ? 'Repeating task' : 'Task', () => api('DELETE', `/api/tasks/${t.id}`), () => api('POST', '/api/tasks', body(t)));
  // Done: logs the hours to the project. A one-off task disappears; a repeating one moves to its next date.
  const doneTask = (t: PlanTask) => run(async () => {
    if (t.project_id != null) await api('POST', '/api/logs', { project_id: t.project_id, date: now, hours: t.hours, note: t.title });
    if (t.repeat) await api('PUT', `/api/tasks/${t.id}`, { date: nextOccurrence(t, now) });
    else await api('DELETE', `/api/tasks/${t.id}`);
  }, t.project_id != null ? `Logged ${h(t.hours)}` : 'Done');
  const fill = () => run(async () => {
    for (const p of autoPlan(state, weekStart, now)) {
      await api('POST', '/api/tasks', { project_id: p.project_id, date: p.date, hours: p.hours, title: byId[p.project_id].name, note: 'Auto-planned' });
    }
  }, 'Planned the rest of the week');

  return (
    <>
      <WeekPicker />
      {days.map((d) => (
        <div key={d.date} className={`card day ${d.date === now ? 'now' : ''} ${d.off ? 'off' : ''}`}>
          <div className="dayhead">
            <b>{dday(d.date)}</b>
            <span className={d.hours > d.capacity + 1e-9 ? 'over' : ''}>
              {d.off ? 'day off' : `${h(d.hours)} of ${h(d.capacity)}`}
            </span>
            <button onClick={() => setOpen(open === d.date ? null : d.date)} aria-label="Add task">+</button>
          </div>
          {d.events.map((e, i) => (
            <div key={`e${i}`} className="item event"><span>{e.start} {e.title}</span><span>{h(e.hours)}</span></div>
          ))}
          {d.fixed.map((f) => (
            <div key={f.project.id} className="item fixed" style={{ '--c': f.project.color }}><span>{f.project.name}</span><span>{h(f.hours)}</span></div>
          ))}
          {d.tasks.map((t) => {
            if (open === t.id && !t.virtual) return <TaskForm key={t.id} date={d.date} task={t} onDone={close} />;
            const p = t.project_id == null ? undefined : byId[t.project_id];
            return (
              <div key={`${t.id}${t.virtual ? d.date : ''}`} className={`item ${t.virtual ? 'virtual' : ''}`} style={{ '--c': p?.color ?? '#888' }}>
                <button className="edit" onClick={() => setOpen(t.id)} aria-label={`Edit task ${t.title}`} disabled={t.virtual}>
                  {t.repeat && <span aria-label="repeats">↻ </span>}{t.title}{p && p.name !== t.title && <> <small>{p.name}</small></>}
                  {t.rolled && <small className="rolled"> · from {weekdayName(t.date)}</small>}
                  {t.note && !t.virtual && <small className="tnote">{t.note}</small>}
                </button>
                <span>{h(t.hours)}
                  {!t.virtual && <>
                    <button onClick={() => doneTask(t)} aria-label={p ? 'Done, log the hours' : 'Done'}>✓</button>
                    <button className="danger" onClick={() => delTask(t)} aria-label={t.repeat ? 'Delete repeating task' : 'Delete task'}>✕</button>
                  </>}
                </span>
              </div>
            );
          })}
          {open === d.date && <TaskForm date={d.date} onDone={close} />}
        </div>
      ))}
      {todo.length > 0 && (
        <>
          <h3>Still to schedule</h3>
          <div className="card">
            {todo.map((r) => (
              <div key={r.project.id} className="item" style={{ '--c': r.project.color }}>
                <span>{r.project.name}</span><span><b>{h(r.todo)}</b> of {h(r.required)}</span>
              </div>
            ))}
            {canAutoPlan && <button className="primary" onClick={fill}>Auto-plan into free time</button>}
            {canAutoPlan && <small>Adds tasks from today to Sunday, only into hours you have free. Earliest deadline first.</small>}
          </div>
        </>
      )}
    </>
  );
}
