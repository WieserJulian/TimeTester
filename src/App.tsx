import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { api } from './api.ts';
import { mondayOf, today } from './planner.ts';
import type { State, SwMessage } from './types.ts';
import { TimerBar } from './Timer.tsx';
import Week from './views/Week.tsx';
import Plan from './views/Plan.tsx';
import Forecast from './views/Forecast.tsx';
import Reports from './views/Reports.tsx';
import Projects from './views/Projects.tsx';
import Log from './views/Log.tsx';
import Settings from './views/Settings.tsx';

// Add a view: write the component, add one line here. The key is the #hash.
const VIEWS: Record<string, [string, ComponentType]> = {
  week: ['Week', Week], plan: ['Plan', Plan], forecast: ['Ahead', Forecast], reports: ['Stats', Reports],
  projects: ['Projects', Projects], log: ['Log', Log], settings: ['⚙', Settings],
};
const hashView = () => (location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'week');

type Toast = { text: string; action?: { label: string; fn: () => void } };
interface AppCtx {
  state: State;
  weekStart: string;
  setWeekStart: (w: string) => void;
  toast: (text: string, action?: Toast['action']) => void;
  run: (fn: () => Promise<unknown>, okMsg?: string) => Promise<boolean>;
  submit: (fn: (f: FormData) => Promise<unknown>, after?: () => void) => (e: FormEvent<HTMLFormElement>) => Promise<void>;
  // Deletes, then offers Undo in the toast for a few seconds.
  undoable: (what: string, del: () => Promise<unknown>, restore: () => Promise<unknown>) => Promise<void>;
}
const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

const EMPTY: State = { pensum: 60, week_hours: Array(7).fill(60 / 7), overrides: [], timer: null, ics_url: '', ics_counts: false, events: [], ics_error: null, projects: [], logs: [], tasks: [] };

export default function App() {
  const [state, setState] = useState<State>(EMPTY);
  const [weekStart, setWeekStart] = useState(() => mondayOf(today()));
  const [view, setView] = useState(hashView);
  const [msg, setMsg] = useState<Toast | null>(null);
  const [pending, setPending] = useState(0); // writes queued offline in the service worker
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback<AppCtx['toast']>((text, action) => {
    setMsg({ text, action });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), action ? 7000 : 4000);
  }, []);

  const reload = useCallback(async () => {
    try { setState(await api<State>('GET', '/api/state')); } catch (e) { toast(`Can't load data: ${(e as Error).message}`); }
  }, [toast]);

  // Runs a write, reloads all data, shows errors as a toast. Returns true on success.
  const run = useCallback<AppCtx['run']>(async (fn, okMsg) => {
    try { await fn(); } catch (e) { toast((e as Error).message); return false; }
    await reload();
    if (okMsg) toast(okMsg);
    return true;
  }, [reload, toast]);

  // onSubmit handler for uncontrolled forms: fn gets FormData; the form resets on success.
  const submit = useCallback<AppCtx['submit']>((fn, after) => async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (await run(() => fn(new FormData(form)), 'Saved')) { form.reset(); after?.(); }
  }, [run]);

  const undoable = useCallback<AppCtx['undoable']>(async (what, del, restore) => {
    if (await run(del)) toast(`${what} deleted`, { label: 'Undo', fn: () => run(restore, 'Restored') });
  }, [run, toast]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const onHash = () => setView(hashView());
    const onSw = (e: MessageEvent<SwMessage>) => {
      if (e.data.type === 'queue') setPending(e.data.size);
      if (e.data.type === 'synced') {
        reload();
        toast(e.data.failed.length ? `Synced ${e.data.sent}, rejected ${e.data.failed.length}: ${e.data.failed.join('; ')}` : `Synced ${e.data.sent} offline change(s)`);
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); }; // back to the app: fresh data
    addEventListener('hashchange', onHash);
    addEventListener('online', reload); // loading /api/state makes the service worker send queued writes first
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onSw);
    navigator.serviceWorker?.startMessages(); // addEventListener alone doesn't start delivery
    return () => {
      removeEventListener('hashchange', onHash);
      removeEventListener('online', reload);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onSw);
    };
  }, [reload, toast]);

  const View = VIEWS[view][1];
  return (
    <Ctx.Provider value={{ state, weekStart, setWeekStart, toast, run, submit, undoable }}>
      <main id="app" aria-live="polite">
        {pending > 0 && <div className="offline">Offline: {pending} change{pending > 1 ? 's' : ''} waiting to sync. The numbers below don't include them yet.</div>}
        <TimerBar />
        {/* key resets open forms when switching views */}
        <View key={view} />
      </main>
      {msg && (
        <div id="toast" role="alert">
          {msg.text}
          {msg.action && <button onClick={() => { setMsg(null); msg.action!.fn(); }}>{msg.action.label}</button>}
        </div>
      )}
      <nav id="nav">
        {Object.entries(VIEWS).map(([k, [label]]) => (
          <a key={k} href={`#${k}`} className={k === view ? 'on' : undefined} aria-label={k === 'settings' ? 'Settings' : undefined}>{label}</a>
        ))}
      </nav>
    </Ctx.Provider>
  );
}
