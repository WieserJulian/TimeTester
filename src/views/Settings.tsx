import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useApp } from '../App.tsx';
import { api } from '../api.ts';
import { today } from '../planner.ts';
import { DAYS, h, dday, str } from '../format.ts';

// ---------- hours per weekday ----------
function WeekHours() {
  const { state, run } = useApp();
  const [v, setV] = useState(() => state.week_hours.map((x) => String(Math.round(x * 100) / 100)));
  const total = v.reduce((a, x) => a + (Number(x) || 0), 0);
  const save = (e: FormEvent) => { e.preventDefault(); run(() => api('PUT', '/api/settings', { week_hours: v.map(Number) }), 'Saved'); };
  return (
    <form className="card" onSubmit={save}>
      <p className="wide"><b>Pensum</b>: the hours you can realistically work on each weekday. <b>{h(total)}</b> per week.</p>
      <div className="wide weekhours">
        {DAYS.map((d, i) => (
          <label key={d}>{d}<input type="number" step="0.25" min="0" max="24" inputMode="decimal" value={v[i]} required
            onChange={(e) => setV(v.map((x, j) => (j === i ? e.target.value : x)))} /></label>
        ))}
      </div>
      <button className="primary wide">Save</button>
    </form>
  );
}

// ---------- days off / special days ----------
function TimeOff() {
  const { state, submit, undoable } = useApp();
  const now = today();
  const upcoming = state.overrides.filter((o) => o.date >= now);
  const past = state.overrides.length - upcoming.length;
  const save = (f: FormData) => api('POST', '/api/overrides', { from: str(f, 'from'), to: str(f, 'to') || str(f, 'from'), hours: Number(f.get('hours')), note: str(f, 'note') });
  return (
    <>
      <form className="card" onSubmit={submit(save)}>
        <p className="wide"><small>Vacation, holidays, half days. The week's pensum and fixed-weekday projects shrink to match.</small></p>
        <label>From <input name="from" type="date" required defaultValue={now} /></label>
        <label>To <span className="hint">(optional)</span> <input name="to" type="date" /></label>
        <label>Hours available <input name="hours" type="number" step="0.25" min="0" max="24" inputMode="decimal" defaultValue={0} required /></label>
        <label>Note <input name="note" maxLength={200} placeholder="Vacation" /></label>
        <button className="primary wide">Add</button>
      </form>
      {upcoming.map((o) => (
        <div key={o.date} className="item">
          <span>{dday(o.date)} {o.note && <small>{o.note}</small>}</span>
          <span>{o.hours === 0 ? 'off' : h(o.hours)}
            <button className="danger" aria-label="Remove" onClick={() => undoable('Day', () => api('DELETE', `/api/overrides/${o.date}`),
              () => api('POST', '/api/overrides', { from: o.date, hours: o.hours, note: o.note }))}>✕</button>
          </span>
        </div>
      ))}
      {past > 0 && <p><small>{past} past day{past > 1 ? 's' : ''} kept for the reports.</small></p>}
    </>
  );
}

// ---------- calendar link ----------
function Calendar() {
  const { state, run } = useApp();
  const [url, setUrl] = useState(state.ics_url);
  const [counts, setCounts] = useState(state.ics_counts);
  const save = (e: FormEvent) => { e.preventDefault(); run(() => api('PUT', '/api/settings', { ics_url: url, ics_counts: counts }), 'Saved'); };
  const upcoming = state.events.filter((e) => e.date >= today()).length;
  return (
    <form className="card" onSubmit={save}>
      <label className="wide">Calendar link (iCal / .ics)
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
      </label>
      <label className="wide check"><input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} /> Count meetings as committed time
        <span className="hint"> (turn off if they are already part of a project's hours, e.g. Work)</span></label>
      {state.ics_url && (state.ics_error
        ? <p className="wide banner">{state.ics_error}</p>
        : <p className="wide"><small>{upcoming} upcoming events loaded. Updates every 15 minutes.</small></p>)}
      <details className="wide"><summary><small>Where do I find this link?</small></summary><small>
        <b>Google Calendar</b>: Settings → pick your calendar → "Secret address in iCal format".<br />
        <b>Outlook</b>: Settings → Calendar → Shared calendars → Publish a calendar → "Can view all details" → copy the ICS link.<br />
        The link is private: anyone who has it can read the calendar. It's stored only on your server.
      </small></details>
      <button className="primary wide">Save</button>
    </form>
  );
}

// ---------- reminders ----------
type SyncReg = ServiceWorkerRegistration & { periodicSync?: { register(tag: string, o: { minInterval: number }): Promise<void>; unregister(tag: string): Promise<void>; getTags(): Promise<string[]> } };
type Status = 'checking' | 'unsupported' | 'off' | 'on' | 'blocked';

function Reminders() {
  const { toast } = useApp();
  const [status, setStatus] = useState<Status>('checking');
  const reg = () => navigator.serviceWorker?.getRegistration() as Promise<SyncReg | undefined>;
  const check = async () => {
    const r = await reg();
    if (!r?.periodicSync || !('Notification' in window)) return setStatus('unsupported');
    if (Notification.permission === 'denied') return setStatus('blocked');
    setStatus((await r.periodicSync.getTags()).includes('reminders') && Notification.permission === 'granted' ? 'on' : 'off');
  };
  useEffect(() => { check(); }, []);

  const enable = async () => {
    if ((await Notification.requestPermission()) !== 'granted') return check();
    try { await (await reg())!.periodicSync!.register('reminders', { minInterval: 12 * 3600e3 }); toast('Reminders on'); }
    catch { toast('The browser refused background checks. Install the app to your home screen first, then try again.'); }
    check();
  };
  const disable = async () => { await (await reg())?.periodicSync?.unregister('reminders'); toast('Reminders off'); check(); };
  const test = async () => { (await reg())?.active?.postMessage('remind'); toast('Checking now; notifications appear if something is due.'); };

  return (
    <div className="card">
      <p><small>Notifications when a deadline is close, a week ahead is overbooked, or nothing is logged by 18:00.
        Your phone decides the exact timing (about twice a day). Works in the installed app on Android/Chrome.</small></p>
      {status === 'unsupported' && <p className="note">This browser can't run background reminders. The same warnings show at the top of the Week view.</p>}
      {status === 'blocked' && <p className="note">Notifications are blocked for this site. Allow them in the browser's site settings.</p>}
      <div className="actions">
        {status === 'off' && <button className="primary" onClick={enable}>Turn on reminders</button>}
        {status === 'on' && <><button onClick={disable}>Turn off reminders</button><button onClick={test}>Check now</button></>}
      </div>
    </div>
  );
}

// ---------- backup ----------
function Backup() {
  const { run } = useApp();
  const restore = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // same file can be picked again
    if (!file) return;
    let backup;
    try { backup = JSON.parse(await file.text()); } catch { return void run(() => Promise.reject(new Error('Not a JSON file'))); }
    const what = `${backup.projects?.length ?? 0} projects, ${backup.logs?.length ?? 0} log entries, ${backup.tasks?.length ?? 0} tasks`;
    if (!confirm(`Replace ALL current data with this backup (${what})?`)) return;
    await run(() => api('POST', '/api/import', backup), 'Backup restored');
  };
  return (
    <div className="card">
      <p><small>A JSON file with all projects, logs, tasks, days off and settings.</small></p>
      <div className="actions">
        <a className="button" href="/api/export" download>Download backup</a>
        <label className="button">Restore from file… <input type="file" accept="application/json,.json" hidden onChange={restore} /></label>
      </div>
    </div>
  );
}

export default function Settings() {
  const { state } = useApp();
  const loaded = String(state.week_hours) + state.ics_url + state.ics_counts; // re-mount forms once real data is in
  return (
    <>
      <h3>Your week</h3>
      <WeekHours key={`w${loaded}`} />
      <h3>Days off</h3>
      <TimeOff />
      <h3>Calendar</h3>
      <Calendar key={`c${loaded}`} />
      <h3>Reminders</h3>
      <Reminders />
      <h3>Backup</h3>
      <Backup />
    </>
  );
}
