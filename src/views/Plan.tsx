import { useState } from 'react';
import { useApp } from '../App.tsx';
import { api } from '../api.ts';
import { computeWeek, planWeek, today } from '../planner.ts';
import { h, dday, str } from '../format.ts';
import type { Task } from '../types.ts';
import { WeekPicker } from './Week.tsx';
import { ProjectOptions } from './Log.tsx';

// New task on `date`, or edit `task` (then the date can change too, to move it to another day).
function TaskForm({ date, task, onDone }: { date: string; task?: Task; onDone: () => void }) {
  const { state, submit } = useApp();
  const save = (f: FormData) => {
    const body = { title: str(f, 'title'), date: str(f, 'date'), hours: Number(f.get('hours')), project_id: f.get('project_id') ? Number(f.get('project_id')) : null };
    return task ? api('PUT', `/api/tasks/${task.id}`, body) : api('POST', '/api/tasks', body);
  };
  return (
    <form className="quick" onSubmit={submit(save, onDone)}>
      <label className="wide">Task <input name="title" required maxLength={200} autoFocus defaultValue={task?.title} /></label>
      <label>Hours <input name="hours" type="number" step="0.25" min="0.25" inputMode="decimal" required defaultValue={task?.hours} /></label>
      <label>Project
        <select name="project_id" defaultValue={task?.project_id ?? ''}><option value="">–</option><ProjectOptions projects={state.projects} keep={task?.project_id} /></select>
      </label>
      {task ? <label className="wide">Day <input name="date" type="date" required defaultValue={task.date} /></label> : <input type="hidden" name="date" value={date} />}
      <div className="actions wide">
        <button className="primary">{task ? 'Save' : 'Add task'}</button>
        <button type="button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export default function Plan() {
  const { state, weekStart, run } = useApp();
  const [open, setOpen] = useState<string | number | null>(null); // a date = add-task form, a task id = edit form
  const { days, planned } = planWeek(state, weekStart);
  const w = computeWeek(state, weekStart);
  const byId = Object.fromEntries(state.projects.map((p) => [p.id, p]));
  const todo = w.rows.map((r) => ({ ...r, todo: r.required - (planned[r.project.id] || 0) })).filter((r) => r.todo > 0.05);
  const close = () => setOpen(null);

  const delTask = (id: number) => api('DELETE', `/api/tasks/${id}`);
  // finishing a task logs its hours to the project, then drops the task
  const doneTask = (t: Task) => run(async () => {
    await api('POST', '/api/logs', { project_id: t.project_id, date: today(), hours: t.hours, note: t.title });
    await delTask(t.id);
  });

  return (
    <>
      <WeekPicker />
      {days.map((d) => (
        <div key={d.date} className={`card day ${d.date === today() ? 'now' : ''}`}>
          <div className="dayhead">
            <b>{dday(d.date)}</b><span>{d.hours ? h(d.hours) : ''}</span>
            <button onClick={() => setOpen(open === d.date ? null : d.date)} aria-label="Add task">+</button>
          </div>
          {d.fixed.map((f) => (
            <div key={f.project.id} className="item fixed" style={{ '--c': f.project.color }}><span>{f.project.name}</span><span>{h(f.hours)}</span></div>
          ))}
          {d.tasks.map((t) => {
            if (open === t.id) return <TaskForm key={t.id} date={d.date} task={t} onDone={close} />;
            const p = t.project_id == null ? undefined : byId[t.project_id];
            return (
              <div key={t.id} className="item" style={{ '--c': p?.color ?? '#888' }}>
                <button className="edit" onClick={() => setOpen(t.id)} aria-label={`Edit task ${t.title}`}>{t.title}{p && <> <small>{p.name}</small></>}</button>
                <span>{h(t.hours)}
                  {p && <button onClick={() => doneTask(t)} aria-label="Done, log the hours">✓</button>}
                  <button className="danger" onClick={() => run(() => delTask(t.id))} aria-label="Delete task">✕</button>
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
          </div>
        </>
      )}
    </>
  );
}
