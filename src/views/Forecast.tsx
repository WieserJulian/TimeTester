import { useApp } from '../App.tsx';
import { forecast, mondayOf } from '../planner.ts';
import { h, dshort } from '../format.ts';
import { WeekPicker } from './Week.tsx';

const WEEKS = 12;

// The next weeks at a glance: one stacked bar per week, a line at that week's pensum. Tap a week to open it.
export default function Forecast() {
  const { state, weekStart, setWeekStart } = useApp();
  const weeks = forecast(state, weekStart, WEEKS);
  const scale = Math.max(...weeks.map((w) => Math.max(w.pensum, w.committed)), 1); // 100% of the bar width
  const over = weeks.filter((w) => w.overbooked).length;
  const active = state.projects.filter((p) => !p.archived);

  return (
    <>
      <WeekPicker />
      <p className={over ? 'banner' : 'preview'}>
        {over ? `${over} of the next ${WEEKS} weeks are overbooked.` : `All ${WEEKS} weeks fit.`}
        {' '}Budget projects assume you keep to the plan each week.
      </p>
      <div className="card forecast">
        {weeks.map((w) => {
          const deadlines = w.rows.filter((r) => r.project.kind === 'budget' && r.project.end_date && mondayOf(r.project.end_date) === w.weekStart);
          const notes = [...(w.daysOff ? [`${w.daysOff} day${w.daysOff > 1 ? 's' : ''} off`] : []), ...deadlines.map((r) => `⚑ ${r.project.name} due`)];
          return (
            <button key={w.weekStart} className="fweek" style={{ '--pensum': `${(w.pensum / scale) * 100}%` }}
              onClick={() => { setWeekStart(w.weekStart); location.hash = '#week'; }}>
              <span className="fdate">{dshort(w.weekStart)}</span>
              <span className="fbar">
                {w.rows.filter((r) => r.required > 0).map((r) => (
                  <i key={r.project.id} style={{ '--c': r.project.color, width: `${(r.required / scale) * 100}%` }} title={`${r.project.name}: ${h(r.required)}`} />
                ))}
                {w.calendar > 0 && <i className="cal" style={{ width: `${(w.calendar / scale) * 100}%` }} title={`Calendar: ${h(w.calendar)}`} />}
              </span>
              <span className={`ffree ${w.overbooked ? 'bad' : ''}`}>{w.overbooked ? `${h(-w.free)} over` : `${h(w.free)} free`}</span>
              {notes.length > 0 && <small className="fnote">{notes.join(' · ')}</small>}
            </button>
          );
        })}
      </div>
      <div className="flegend">
        {active.map((p) => <span key={p.id} style={{ '--c': p.color }}>{p.name}</span>)}
        {state.ics_counts && state.events.length > 0 && <span className="k-cal">Calendar</span>}
      </div>
    </>
  );
}
