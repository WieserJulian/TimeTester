import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { api } from './api.ts';
import { mondayOf, today } from './planner.ts';
import type { State, SwMessage } from './types.ts';
import Week from './views/Week.tsx';
import Plan from './views/Plan.tsx';
import Forecast from './views/Forecast.tsx';
import Projects from './views/Projects.tsx';
import Log from './views/Log.tsx';
import Settings from './views/Settings.tsx';

// Add a view: write the component, add one line here. The key is the #hash.
const VIEWS: Record<string, [string, ComponentType]> = {
  week: ['Week', Week], plan: ['Plan', Plan], forecast: ['Ahead', Forecast], projects: ['Projects', Projects], log: ['Log', Log], settings: ['Settings', Settings],
};
const hashView = () => (location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'week');

interface AppCtx {
  state: State;
  weekStart: string;
  setWeekStart: (w: string) => void;
  run: (fn: () => Promise<unknown>, okMsg?: string) => Promise<boolean>;
  submit: (fn: (f: FormData) => Promise<unknown>, after?: () => void) => (e: FormEvent<HTMLFormElement>) => Promise<void>;
}
const Ctx = createContext<AppCtx>(null!);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [state, setState] = useState<State>({ pensum: 60, projects: [], logs: [], tasks: [] });
  const [weekStart, setWeekStart] = useState(() => mondayOf(today()));
  const [view, setView] = useState(hashView);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState(0); // writes queued offline in the service worker
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4000);
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
    addEventListener('hashchange', onHash);
    addEventListener('online', reload); // loading /api/state makes the service worker send queued writes first
    navigator.serviceWorker?.addEventListener('message', onSw);
    navigator.serviceWorker?.startMessages(); // addEventListener alone doesn't start delivery
    return () => {
      removeEventListener('hashchange', onHash);
      removeEventListener('online', reload);
      navigator.serviceWorker?.removeEventListener('message', onSw);
    };
  }, [reload, toast]);

  const View = VIEWS[view][1];
  return (
    <Ctx.Provider value={{ state, weekStart, setWeekStart, run, submit }}>
      {/* key resets open forms when switching views */}
      <main id="app" aria-live="polite">
        {pending > 0 && <div className="offline">Offline: {pending} change{pending > 1 ? 's' : ''} waiting to sync. The numbers below don't include them yet.</div>}
        <View key={view} />
      </main>
      {msg && <div id="toast" role="alert">{msg}</div>}
      <nav id="nav">
        {Object.entries(VIEWS).map(([k, [label]]) => <a key={k} href={`#${k}`} className={k === view ? 'on' : undefined}>{label}</a>)}
      </nav>
    </Ctx.Provider>
  );
}
