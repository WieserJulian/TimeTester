// Row shapes as returned by GET /api/state. Dates are 'YYYY-MM-DD' strings.
export interface Project {
  id: number;
  name: string;
  color: string;
  kind: 'weekly' | 'budget';
  hours_per_week: number | null;
  total_hours: number | null;
  start_date: string | null;
  end_date: string | null; // weekly: optional end; budget: deadline
  archived: 0 | 1;
  days: string | null; // weekly: '1,2,3' = Mon-Wed
}

export interface Log { id: number; project_id: number; date: string; hours: number; note: string | null }
export interface Task { id: number; project_id: number | null; title: string; date: string; hours: number }
export interface State { pensum: number; projects: Project[]; logs: Log[]; tasks: Task[] }

// Service worker → page messages (src/sw.ts posts them, App.tsx listens).
export type SwMessage = { type: 'queue'; size: number } | { type: 'synced'; sent: number; failed: string[] };
