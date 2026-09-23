import type { ChangeEvent } from 'react';
import { useApp } from '../App.tsx';
import { api } from '../api.ts';

export default function Settings() {
  const { state, run, submit } = useApp();

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
    <>
      {/* key: re-mount once the real pensum has loaded so defaultValue picks it up */}
      <form key={state.pensum} className="card" onSubmit={submit((f) => api('PUT', '/api/settings', { pensum: Number(f.get('pensum')) }))}>
        <label className="wide">Pensum: realistic hours per week <input name="pensum" type="number" step="0.5" min="0.5" inputMode="decimal" defaultValue={state.pensum} required /></label>
        <button className="primary wide">Save</button>
      </form>
      <h3>Backup</h3>
      <div className="card">
        <p><small>A JSON file with all projects, logs, tasks and the pensum.</small></p>
        <div className="actions">
          <a className="button" href="/api/export" download>Download backup</a>
          <label className="button">Restore from file… <input type="file" accept="application/json,.json" hidden onChange={restore} /></label>
        </div>
      </div>
    </>
  );
}
