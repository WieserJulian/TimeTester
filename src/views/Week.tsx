import { Fragment, useState } from 'react';
import { useApp } from '../App.tsx';
import { computeWeek, mondayOf, addDays, today } from '../planner.ts';
import { h, dl, dshort, pct } from '../format.ts';
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

export default function Week() {
  const { state, weekStart } = useApp();
  const [quick, setQuick] = useState<number | null>(null); // project id with the quick-log form open
  const w = computeWeek(state, weekStart);

  return (
    <>
      <WeekPicker />
      {w.overbooked && <div className="banner">Overbooked: {h(w.committed)} committed vs a {h(w.pensum)} pensum ({h(-w.free)} over).</div>}
      <div className="card">
        <div className={`free ${w.overbooked ? 'bad' : ''}`}>{h(w.free)} <small>free of {h(w.pensum)}</small></div>
        <div className="bar"><i className={`c ${w.overbooked ? 'bad' : ''}`} style={{ width: `${pct(w.committed, w.pensum)}%` }} /></div>
        <div className="legend">Committed {h(w.committed)}</div>
        <div className="bar"><i className="l" style={{ width: `${pct(w.loggedTotal, w.pensum)}%` }} /></div>
        <div className="legend">Logged {h(w.loggedTotal)}</div>
      </div>
      {w.rows.length ? w.rows.map(({ project: p, required, logged, left, overdue }) => (
        <Fragment key={p.id}>
          <button className="row" style={{ '--c': p.color }} onClick={() => setQuick(quick === p.id ? null : p.id)}>
            <span className="name">{p.name} {overdue && <span className="badge">overdue</span>}</span>
            <span className="nums"><b>{h(required)}</b> req · {h(logged)} logged · <b className={left > 0 ? '' : 'ok'}>{h(Math.max(0, left))}</b> left</span>
          </button>
          {quick === p.id && <LogForm projectId={p.id} onDone={() => setQuick(null)} />}
        </Fragment>
      )) : <p className="empty">No active projects this week. <a href="#projects">Add one</a>.</p>}
    </>
  );
}
