import { useState } from 'react';
import { useApp } from '../App.tsx';
import { downloadCsv } from '../api.ts';
import { computeWeek, mondayOf, addDays, today } from '../planner.ts';
import { h, dshort, dl } from '../format.ts';

const RANGES = { 4: '4 weeks', 12: '12 weeks', 26: '6 months', 52: '1 year' } as const;

// Looking back: planned (required) vs logged, per week and per project. Answers "is my pensum realistic?"
export default function Reports() {
  const { state } = useApp();
  const [n, setN] = useState<keyof typeof RANGES>(12);
  const last = mondayOf(today());
  // Weeks before your first log say nothing about you (projects have no creation date), so they're left out.
  const firstLog = state.logs.reduce((min, l) => (l.date < min ? l.date : min), today());
  const weeks = Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)))
    .filter((W) => W >= mondayOf(firstLog))
    .map((W) => computeWeek(state, W));
  const done = weeks.slice(0, -1); // the current week isn't over; leave it out of averages
  const avg = (f: (w: (typeof weeks)[number]) => number) => (done.length ? done.reduce((a, w) => a + f(w), 0) / done.length : 0);
  const avgLogged = avg((w) => w.loggedTotal), avgPensum = avg((w) => w.pensum), avgCommitted = avg((w) => w.committed);
  const scale = Math.max(1, ...weeks.map((w) => Math.max(w.pensum, w.committed, w.loggedTotal)));

  const perProject = state.projects.map((p) => {
    const rows = weeks.map((w) => w.rows.find((r) => r.project.id === p.id)).filter((r) => r !== undefined);
    return { p, planned: rows.reduce((a, r) => a + r.required, 0), logged: rows.reduce((a, r) => a + r.logged, 0) };
  }).filter((x) => x.planned > 0 || x.logged > 0).sort((a, b) => b.logged - a.logged);

  const from = weeks[0].weekStart, to = addDays(last, 6);
  const csv = () => downloadCsv(`timetester-weeks-${from}-${to}.csv`, [
    ['week', 'pensum', 'committed', 'logged', ...perProject.map((x) => x.p.name)],
    ...weeks.map((w) => [w.weekStart, w.pensum.toFixed(2), w.committed.toFixed(2), w.loggedTotal.toFixed(2),
      ...perProject.map((x) => (w.rows.find((r) => r.project.id === x.p.id)?.logged ?? 0).toFixed(2))]),
  ]);

  return (
    <>
      <div className="seg ranges">
        {Object.entries(RANGES).map(([k, label]) => (
          <button key={k} className={Number(k) === n ? 'on' : ''} onClick={() => setN(Number(k) as keyof typeof RANGES)}>{label}</button>
        ))}
      </div>
      <div className="card">
        <div className="free">{h(avgLogged)} <small>logged per week on average</small></div>
        <p>
          That is <b>{avgPensum ? Math.round((avgLogged / avgPensum) * 100) : 0}%</b> of your pensum ({h(avgPensum)}) and{' '}
          <b>{avgCommitted ? Math.round((avgLogged / avgCommitted) * 100) : 0}%</b> of what you committed ({h(avgCommitted)}).
          <br /><small>{dl(from)} – {dl(addDays(last, -1))}, {done.length} full week{done.length === 1 ? '' : 's'}{weeks.length < n && ', since your first log entry'}.</small>
        </p>
        {done.length > 0 && avgLogged < avgPensum * 0.75 && (
          <p className="note">You log a lot less than your pensum. If that's real, a pensum near {h(Math.ceil(avgLogged))} would make the plan honest (Settings).</p>
        )}
      </div>

      <h3>Week by week</h3>
      <div className="card forecast" >
        {weeks.map((w) => (
          <div key={w.weekStart} className="fweek static" style={{ '--pensum': `${(w.pensum / scale) * 100}%` }}>
            <span className="fdate">{dshort(w.weekStart)}</span>
            <span className="fbar two">
              <i className="plan" style={{ width: `${(w.committed / scale) * 100}%` }} />
              <i className="done" style={{ width: `${(w.loggedTotal / scale) * 100}%` }} />
            </span>
            <span className="ffree">{h(w.loggedTotal)} / {h(w.committed)}</span>
          </div>
        ))}
        <div className="flegend"><span className="k-plan">committed</span><span className="k-done">logged</span><span className="k-pensum">pensum</span></div>
      </div>

      <h3>By project</h3>
      <div className="card">
        {perProject.length ? perProject.map(({ p, planned, logged }) => (
          <div key={p.id} className="item" style={{ '--c': p.color }}>
            <span>{p.name}{p.archived ? <small> archived</small> : null}</span>
            <span><b>{h(logged)}</b> of {h(planned)} {planned > 0 && <small>({Math.round((logged / planned) * 100)}%)</small>}</span>
          </div>
        )) : <p className="empty">Nothing planned or logged in this range.</p>}
      </div>
      <button onClick={csv}>Export these weeks as CSV</button>
    </>
  );
}
