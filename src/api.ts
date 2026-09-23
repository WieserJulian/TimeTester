export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data; // 202 { queued: true } = offline, the service worker will send it later
}

// Saves rows as a CSV file (Excel-friendly: BOM, quoted cells, formulas neutralised).
export function downloadCsv(name: string, rows: string[][]) {
  const cell = (v: string) => {
    const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[",;\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const BOM = String.fromCharCode(0xfeff); // lets Excel detect UTF-8
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([BOM, rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
