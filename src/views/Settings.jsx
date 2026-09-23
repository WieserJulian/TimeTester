import { useApp } from '../App.jsx';
import { api } from '../api.js';

export default function Settings() {
  const { state, submit } = useApp();
  return (
    // key: re-mount once the real pensum has loaded so defaultValue picks it up
    <form key={state.pensum} className="card" onSubmit={submit((f) => api('PUT', '/api/settings', { pensum: Number(f.get('pensum')) }))}>
      <label className="wide">Pensum: realistic hours per week <input name="pensum" type="number" step="0.5" min="0.5" inputMode="decimal" defaultValue={state.pensum} required /></label>
      <button className="primary wide">Save</button>
    </form>
  );
}
