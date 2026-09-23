import { Fragment, useState } from 'react';
import { useApp } from '../App.tsx';
import { api } from '../api.ts';
import { alerts, computeWeek, suggestFixes, mondayOf, addDays, today, type Fix } from '../planner.ts';
import { h, dl, dshort, pct } from '../format.ts';
import type { Project } from '../types.ts';
import { startTimer } from '../Timer.tsx';
import { LogForm } from './Log.tsx';

export function WeekPicker() {
  const { weekStart, setWeekStart } = useApp();
  const now = mondayOf(today());
  return (
    <div className="picker">
      <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">◀</button>
      <div>
        <b>{dshort(weekStart)} – {dl(addDays(weekStart, 6))}</b>
        {weekStart !== now && <><br /><a href="#" onClick={(e) => { e.preventDefault(); setWeekStart(now); }}>this week</a></>}
      </div>
      <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">▶</button>
    </div>
  );
}

const fixText = (f: Fix<Project>) =>
  f.kind === 'deadline' ? `Move ${f.project.name}'s deadline to ${dl(f.end_date)}`
    : f.kind === 'hours' ? `Cut ${f.project.name} to ${h(f.hours_per_week)}/week`
      : `Archive ${f.project.name}`;
const fixBody = (f: Fix<Project>) =>
  f.kind === 'deadline' ? { end_date: f.end_date } : f.kind === 'hours' ? { hours_per_week: f.hours_per_week } : { archived: 1 };

export default function Week() {
  const { state, weekStart, run } = useApp();
  const [quick, setQuick] = useState<number | null>(null); // project id with the quick-log form open
  const w = computeWeek(state, weekStart);
  const isNow = weekStart === mondayOf(today());
  const notes = isNow ? alerts(state).filter((a) => a.key !== `over:${weekStart}`) : []; // this week's overbooking has its own banner
  const fixes = w.overbooked ? suggestFixes(state, weekStart) : [];
  const special = w.pensum !== state.pensum;

  return (
    <>
      <WeekPicker />
      {notes.map((a) => <div key={a.key} className={a.bad ? 'banner' : 'note'}>{a.text}</div>)}
      {w.overbooked && (
        <div className="banner">
          Overbooked: {h(w.committed)} committed vs {h(w.pensum)} available ({h(-w.free)} over).
          {fixes.length > 0 && <div className="fixes"><small>Any one of these would make it fit:</small>
            {fixes.map((f) => (
              <button key={`${f.kind}${f.project.id}`} onClick={() => run(() => api('PUT', `/api/projects/${f.project.id}`, fixBody(f)), 'Updated')}>{fixText(f)}</button>
            ))}
          </div>}
        </div>
      )}
      <div className="card">
        <div className={`free ${w.overbooked ? 'bad' : ''}`}>{h(w.free)} <small>free of {h(w.pensum)}</small></div>
        {special && <small>Usual week {h(state.pensum)}{w.daysOff ? `, ${w.daysOff} day${w.daysOff > 1 ? 's' : ''} off` : ', special days'}</small>}
        <div className="bar"><i className={`c ${w.overbooked ? 'bad' : ''}`} style={{ width: `${pct(w.committed, w.pensum)}%` }} /></div>
        <div className="legend">Committed {h(w.committed)}{w.calendar > 0 && ` (incl. ${h(w.calendar)} calendar)`}</div>
        <div className="bar"><i className="l" style={{ width: `${pct(w.loggedTotal, w.pensum)}%` }} /></div>
        <div className="legend">Logged {h(w.loggedTotal)}</div>
      </div>
      {w.rows.length ? w.rows.map(({ project: p, required, logged, left, overdue }) => (
        <Fragment key={p.id}>
          <div className="row" style={{ '--c': p.color }}>
            <button className="main" onClick={() => setQuick(quick === p.id ? null : p.id)}>
              <span className="name">{p.name} {overdue && <span className="badge">overdue</span>}</span>
              <span className="nums"><b>{h(required)}</b> req · {h(logged)} logged · <b className={left > 0 ? '' : 'ok'}>{h(Math.max(0, left))}</b> left</span>
            </button>
            {state.timer?.project_id === p.id
              ? <span className="running" aria-label="Timer running">●</span>
              : <button className="play" onClick={() => startTimer(state, run, p.id)} aria-label={`Start timer for ${p.name}`}>▶</button>}
          </div>
          {quick === p.id && <LogForm projectId={p.id} onDone={() => setQuick(null)} />}
        </Fragment>
      )) : <p className="empty">No active projects this week. <a href="#projects">Add one</a>.</p>}
    </>
  );
}
