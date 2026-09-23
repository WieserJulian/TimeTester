import { useState } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';
import { computeWeek, planWeek, today } from '../planner.js';
import { h, dday } from '../format.js';
import { WeekPicker } from './Week.jsx';
import { ProjectOptions } from './Log.jsx';

export default function Plan() {
  const { state, weekStart, run, submit } = useApp();
  const [taskDay, setTaskDay] = useState(null); // date with the add-task form open
  const { days, planned } = planWeek(state, weekStart);
  const w = computeWeek(state, weekStart);
  const byId = Object.fromEntries(state.projects.map((p) => [p.id, p]));
  const todo = w.rows.map((r) => ({ ...r, todo: r.required - (planned[r.project.id] || 0) })).filter((r) => r.todo > 0.05);

  const delTask = (id) => api('DELETE', `/api/tasks/${id}`);
  // finishing a task logs its hours to the project, then drops the task
  const doneTask = (t) => run(async () => {
    await api('POST', '/api/logs', { project_id: t.project_id, date: today(), hours: t.hours, note: t.title });
    await delTask(t.id);
  });
  const addTask = (f) => api('POST', '/api/tasks', {
    title: f.get('title'), date: f.get('date'), hours: Number(f.get('hours')), project_id: f.get('project_id') ? Number(f.get('project_id')) : null,
  });

  return (
    <>
      <WeekPicker />
      {days.map((d) => (
        <div key={d.date} className={`card day ${d.date === today() ? 'now' : ''}`}>
          <div className="dayhead">
            <b>{dday(d.date)}</b><span>{d.hours ? h(d.hours) : ''}</span>
            <button onClick={() => setTaskDay(taskDay === d.date ? null : d.date)} aria-label="Add task">+</button>
          </div>
          {d.fixed.map((f) => (
            <div key={f.project.id} className="item fixed" style={{ '--c': f.project.color }}><span>{f.project.name}</span><span>{h(f.hours)}</span></div>
          ))}
          {d.tasks.map((t) => {
            const p = byId[t.project_id];
            return (
              <div key={t.id} className="item" style={{ '--c': p?.color ?? '#888' }}>
                <span>{t.title}{p && <> <small>{p.name}</small></>}</span>
                <span>{h(t.hours)}
                  {p && <button onClick={() => doneTask(t)} aria-label="Done, log the hours">✓</button>}
                  <button className="danger" onClick={() => run(() => delTask(t.id))} aria-label="Delete task">✕</button>
                </span>
              </div>
            );
          })}
          {taskDay === d.date && (
            <form className="quick" onSubmit={submit(addTask, () => setTaskDay(null))}>
              <input type="hidden" name="date" value={d.date} />
              <label className="wide">Task <input name="title" required maxLength={200} autoFocus /></label>
              <label>Hours <input name="hours" type="number" step="0.25" min="0.25" inputMode="decimal" required /></label>
              <label>Project <select name="project_id"><option value="">–</option><ProjectOptions projects={state.projects} /></select></label>
              <button className="primary">Add task</button>
            </form>
          )}
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
