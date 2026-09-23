// Shapes returned by GET /api/state. Dates are 'YYYY-MM-DD' strings in local time.
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

export type Repeat = 'daily' | 'weekdays' | 'weekly';
export interface Task {
  id: number; project_id: number | null; title: string; date: string; hours: number;
  note: string | null;
  repeat: Repeat | null; // done → moves to the next occurrence instead of disappearing
}

// A day with other hours than the usual weekday: 0 = day off, 4 = half day.
export interface Override { date: string; hours: number; note: string | null }
export interface Timer { project_id: number; started_at: number } // ms since epoch
export interface CalEvent { date: string; start: string; hours: number; title: string } // start 'HH:MM'

export interface State {
  pensum: number; // the usual week: sum of week_hours
  week_hours: number[]; // Mon..Sun
  overrides: Override[];
  timer: Timer | null;
  ics_url: string;
  ics_counts: boolean; // calendar events count as committed time
  events: CalEvent[]; // from ics_url, recurring events expanded
  ics_error: string | null; // last calendar fetch failed (events are the last good copy)
  projects: Project[];
  logs: Log[];
  tasks: Task[];
}

// Service worker → page messages (src/sw.ts posts them, App.tsx listens).
export type SwMessage = { type: 'queue'; size: number } | { type: 'synced'; sent: number; failed: string[] };
