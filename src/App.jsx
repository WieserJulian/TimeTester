import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { mondayOf, today } from './planner.js';
import Week from './views/Week.jsx';
import Plan from './views/Plan.jsx';
import Projects from './views/Projects.jsx';
import Log from './views/Log.jsx';
import Settings from './views/Settings.jsx';

// Add a view: write the component, add one line here. The key is the #hash.
const VIEWS = { week: ['Week', Week], plan: ['Plan', Plan], projects: ['Projects', Projects], log: ['Log', Log], settings: ['Settings', Settings] };
const hashView = () => (location.hash.slice(1) in VIEWS ? location.hash.slice(1) : 'week');

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [state, setState] = useState({ pensum: 60, projects: [], logs: [], tasks: [] });
  const [weekStart, setWeekStart] = useState(() => mondayOf(today()));
  const [view, setView] = useState(hashView);
  const [msg, setMsg] = useState(null);
  const timer = useRef();

  const toast = useCallback((m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 4000);
  }, []);

  const reload = useCallback(async () => {
    try { setState(await api('GET', '/api/state')); } catch (e) { toast(`Can't load data: ${e.message}`); }
  }, [toast]);

  // Runs a write, reloads all data, shows errors as a toast. Returns true on success.
  const run = useCallback(async (fn, okMsg) => {
    try { await fn(); } catch (e) { toast(e.message); return false; }
    await reload();
    if (okMsg) toast(okMsg);
    return true;
  }, [reload, toast]);

  // onSubmit handler for uncontrolled forms: fn gets FormData; the form resets on success.
  const submit = useCallback((fn, after) => async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (await run(() => fn(new FormData(form)), 'Saved')) { form.reset(); after?.(); }
  }, [run]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const on = () => setView(hashView());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  const View = VIEWS[view][1];
  return (
    <Ctx.Provider value={{ state, weekStart, setWeekStart, run, submit }}>
      {/* key resets open forms when switching views */}
      <main id="app" aria-live="polite"><View key={view} /></main>
      {msg && <div id="toast" role="alert">{msg}</div>}
      <nav id="nav">
        {Object.entries(VIEWS).map(([k, [label]]) => <a key={k} href={`#${k}`} className={k === view ? 'on' : undefined}>{label}</a>)}
      </nav>
    </Ctx.Provider>
  );
}
