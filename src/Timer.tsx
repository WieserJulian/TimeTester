import { useEffect, useState } from 'react';
import { useApp } from './App.tsx';
import { api } from './api.ts';
import { dateOf } from './planner.ts';
import { h } from './format.ts';
import type { State, Timer } from './types.ts';

const LONG = 8; // hours: a timer this long was probably forgotten, so ask before logging it
const elapsed = (t: Timer) => Math.max(0.01, Math.round((Date.now() - t.started_at) / 36e3) / 100); // hours, 2 decimals
const clock = (t: Timer) => { const m = Math.floor((Date.now() - t.started_at) / 60e3); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

// Logs the running timer (on the day it started) and clears it.
const logTimer = async (t: Timer, hours: number) => {
  await api('POST', '/api/logs', { project_id: t.project_id, date: dateOf(t.started_at), hours, note: 'Timer' });
  await api('DELETE', '/api/timer');
};

// Start a timer for a project. A timer already running for another project is logged first.
export async function startTimer(state: State, run: (fn: () => Promise<unknown>, okMsg?: string) => Promise<boolean>, project_id: number) {
  const t = state.timer;
  await run(async () => {
    if (t && elapsed(t) > LONG) throw new Error(`The running timer has gone ${h(elapsed(t))}; stop it first and check the hours`);
    if (t) await logTimer(t, elapsed(t));
    await api('PUT', '/api/timer', { project_id, started_at: Date.now() });
  }, t ? `Logged ${h(elapsed(t))}, timer switched` : 'Timer started');
}

export function TimerBar() {
  const { state, run, undoable } = useApp();
  const [, tick] = useState(0);
  const [asking, setAsking] = useState(false); // forgotten timer: confirm the hours
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 20e3); return () => clearInterval(i); }, []);
  const t = state.timer;
  if (!t) return null;
  const p = state.projects.find((x) => x.id === t.project_id);
  const hours = elapsed(t);
  const stop = (hrs: number) => run(() => logTimer(t, hrs), `Logged ${h(hrs)} to ${p?.name}`).then(() => setAsking(false));

  return (
    <div className="timer" style={{ '--c': p?.color ?? '#888' }}>
      <div className="timerrow">
        <span className="dot" aria-hidden /> <b>{p?.name ?? '?'}</b> <span className="clock">{clock(t)}</span>
        <button className="primary" onClick={() => (hours > LONG ? setAsking(true) : stop(hours))}>Stop</button>
        <button onClick={() => undoable('Timer', () => api('DELETE', '/api/timer'), () => api('PUT', '/api/timer', t))} aria-label="Discard timer">✕</button>
      </div>
      {asking && (
        <form className="quick" onSubmit={(e) => { e.preventDefault(); stop(Number(new FormData(e.currentTarget).get('hours'))); }}>
          <span className="wide">The timer ran {h(hours)}. Did you forget to stop it? Log how many hours?</span>
          <label>Hours <input name="hours" type="number" step="0.25" min="0.25" max={hours} inputMode="decimal" defaultValue={Math.min(hours, LONG)} required autoFocus /></label>
          <button className="primary">Log</button>
        </form>
      )}
    </div>
  );
}
