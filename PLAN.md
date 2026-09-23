# Time Tester — Architecture & Build Plan

Build spec for the goal in `README.md`. Keep it small. The frontend is React (Vite build); the server stays dependency-free.

## Decisions (fixed)

| Topic | Decision | Why |
|---|---|---|
| Hosting | One Docker container on a home system, reached over Tailscale | Syncs across devices without a cloud service |
| Auth | **None.** Only devices on the tailnet can reach it | Tailscale already controls who has access |
| HTTPS | `tailscale serve` on the host → `https://<host>.<tailnet>.ts.net` | A PWA's service worker and install only work over HTTPS |
| Android | Installable PWA (manifest + service worker) | One codebase, no app store |
| Backend | Node 24, `node:http` + built-in `node:sqlite` | **Zero npm dependencies** |
| Frontend | React 19 + Vite, plain JSX and CSS. `vite build` → `dist/`, which `server.js` serves | Components are easier to change than string templates. The build only runs in Docker's build stage; the runtime image has no `node_modules` |
| Storage | SQLite file in a Docker volume at `/data/timetester.db` (`./data/` when run locally) | A single file is easy to back up |
| Calculation | A pure module `src/planner.js`, run in the browser | Easy to test. The data is small enough to load all of it |
| Offline | The service worker caches only the app shell. Saving data needs a connection | Avoids having to handle sync conflicts |

## Domain model

**Pensum**: the hours per week you can realistically work (e.g. 60). Stored as a single setting.

**Project** has one of two kinds:

1. `weekly`: a fixed number of hours per week, with optional `start_date` and `end_date`.
   - "Work, 20h/week" → weekly, no dates.
   - "Code project, 10h/week from start to end" → weekly with dates.
2. `budget`: a total number of hours with a `deadline` and an optional `start_date`.
   - "Thesis, 100h, due 2026-12-20".

A weekly project may also have `days` (`'1,2,3'` = Mon–Wed). The Plan view then spreads `hours_per_week` evenly over those days.

**Log entry**: hours actually spent on a project on a given date.

**Task**: a planned block of hours on a given date, optionally tied to a project. Marking it done logs its hours to that project and deletes the task.

### Rules for the weekly calculation (`planner.js`)

Weeks run Monday to Sunday. Every date is a `'YYYY-MM-DD'` string in local time. **Never** use `new Date('YYYY-MM-DD')`, because that parses as UTC and the day shifts by timezone. Parse the parts and call `new Date(y, m-1, d)`.

For a week starting on Monday `W`:

- **weekly project**: it is active if the range [start, end] overlaps the week. `required = hours_per_week`. A partial first or last week still counts as a full week.
- **budget project**:
  - `remaining = total_hours - sum(logs dated before W)`. Leave out this week's logs so the target doesn't move while you log hours during the week.
  - `firstWeek = max(W, monday(start_date))`. If W is before firstWeek, then `required = 0`.
  - `weeksLeft = number of weeks from W to monday(deadline), counting both ends` (at least 1).
  - `required = max(0, remaining) / weeksLeft`
  - It is **overdue** if W is after the deadline's week and `remaining > 0`. Then `required = remaining`. Show this as an alert.
- `logged` = sum of this project's logs within W to W+6.
- Totals: `committed = Σ required`, `free = pensum - committed`, `loggedTotal = Σ logged`, and `overbooked = committed > pensum`.

Exported function:

```js
computeWeek({ pensum, projects, logs }, weekStart) → {
  weekStart, pensum, committed, free, loggedTotal, overbooked,
  rows: [{ project, required, logged, left: required - logged, overdue }]
}
```

Also export the date helpers `mondayOf(dateStr)`, `addDays(dateStr, n)` and `today()`, plus
`planWeek({ projects, tasks }, weekStart) → { days: [{ date, fixed, tasks, hours }], planned: { [project_id]: hours } }`
for the Plan view (`required - planned` = still to schedule).

### Worked example (use this as a test case)

Pensum 60. The week starts on 2026-09-21 (a Monday).
- Work: weekly 20h → required 20.
- Code: weekly 10h, 2026-10-01 to 2026-12-31 → not active this week → 0.
- Thesis: budget 100h, deadline 2026-12-20, 30h logged before 09-21 → the deadline week is Monday 12-14, which is 84 days / 12 weeks later, so there are 13 weeks counting both ends → 70/13 = **5.38**.
- committed = 25.38, free = 34.62, overbooked = false.

## Database (`server.js` creates this on startup)

```sql
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4f7cff',
  kind TEXT NOT NULL CHECK (kind IN ('weekly','budget')),
  hours_per_week REAL,          -- weekly
  total_hours REAL,             -- budget
  start_date TEXT,              -- optional, both kinds
  end_date TEXT,                -- weekly: optional end; budget: required deadline
  archived INTEGER NOT NULL DEFAULT 0,
  days TEXT,                    -- weekly: optional '1,2,3' (Mon=1); added by migration on startup
  CHECK (kind <> 'weekly' OR hours_per_week > 0),
  CHECK (kind <> 'budget' OR (total_hours > 0 AND end_date IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours > 0),
  note TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  hours REAL NOT NULL CHECK (hours > 0)
);
PRAGMA foreign_keys = ON;
```

The default pensum is 60 if the setting is missing.

## API (JSON; the server also serves the built `dist/` as static files)

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/state` | `{ pensum, projects, logs, tasks }`. The frontend loads everything with this one call |
| PUT | `/api/settings` | `{ pensum }` |
| POST | `/api/projects` | project fields → the created row |
| PUT | `/api/projects/:id` | project fields |
| DELETE | `/api/projects/:id` | cascades to its logs. Archiving instead is done with PUT `archived: 1` |
| POST | `/api/logs` | `{ project_id, date, hours, note? }` |
| DELETE | `/api/logs/:id` | |
| POST | `/api/tasks` | `{ title, date, hours, project_id? }` |
| DELETE | `/api/tasks/:id` | |

Validate every request body on the server (types, `kind`, dates matching `^\d{4}-\d{2}-\d{2}$`, positive numbers) and return `400 { error }` if it's invalid. Rely on the SQL CHECKs as a second layer. Always use prepared statements.

## Files

```
server.js                 # ~175 lines: static files from dist/ + API + schema. No npm deps
index.html                # Vite entry, mounts src/main.jsx
vite.config.js            # React plugin; dev server proxies /api to :8787
src/main.jsx              # mounts <App>, registers the service worker (production only)
src/App.jsx               # the tab list (VIEWS), #hash routing, shared state via useApp()
src/views/*.jsx           # Week, Plan, Projects, Log, Settings
src/planner.js            # pure calculation (see above)
src/api.js, src/format.js # fetch wrapper; hour/date formatting
src/style.css             # mobile-first
public/                   # copied as-is into dist/: manifest, sw.js, icons
planner.test.js           # node --test, includes the worked example
Dockerfile                # build stage (npm ci, test, vite build) → slim runtime stage
deploy/compose.yaml, .env.example, README.md   # server deploy (Watchtower + GHCR image)
```

### Frontend conventions

- `useApp()` gives every view `{ state, weekStart, setWeekStart, run, submit }`.
- Writes go through `run(fn, okMsg?)`: it calls the API, reloads `/api/state`, and shows errors as a toast. No per-view caching; reloading everything is fine at this data size.
- Simple forms are uncontrolled: `onSubmit={submit((formData) => api(...), afterSuccess)}`. The project form is controlled because it drives the live preview.
- Local UI state (which form is open) lives in the view; switching tabs remounts the view and closes it.

## Views

1. **Week** (`#week`, the default): a week picker (◀ this week ▶), a bar comparing committed and logged hours against the pensum, the free hours, and a red banner if overbooked. Each project gets a row with color, name, required, logged and left, plus an "overdue" badge. Tapping a row opens a quick-log form for that project with today's date.
2. **Projects** (`#projects`): a list plus an add/edit form. A toggle between weekly and budget shows the right fields. Archive and delete actions. **Show a live preview** of this week's committed/free hours as you type, using `computeWeek` with the draft project included. This is how you answer "do I still have time for this?"
3. **Plan** (`#plan`): the week as 7 day cards. Weekly projects with `days` show as fixed blocks; `+` adds a task to a day; ✓ logs a task's hours and removes it. Below: "Still to schedule" per project (`required - planned`).
4. **Log** (`#log`): an add-entry form (project, date defaulting to today, hours, note) and the last 50 entries with delete.
5. **Settings** (`#settings`): the pensum.

## Build & run

1. **Tests**: `npm test` must pass the worked example and these cases: a weekly project outside its dates, a budget project before its start, an overdue budget project, and the deadline falling in the current week (weeksLeft = 1).
2. **Server**: port from `PORT` (default 8787), database path from `DB_PATH` (default `data/timetester.db`; the Docker image sets `/data/timetester.db`).
3. **Frontend**: `npm run dev` for hot reload, `npm run build` for `dist/`. It must work at 400px width.
4. **PWA**: manifest (`display: standalone`, icons, theme color) and sw.js. Check it in Chrome DevTools → Application. Bump `CACHE` in `sw.js` when you change its file list.
5. **Docker**: see `Dockerfile` (multi-stage; tests run during the build). Minimal local compose:
   ```yaml
   services:
     timetester:
       build: .
       restart: unless-stopped
       ports: ["127.0.0.1:8787:8787"]   # localhost only; Tailscale exposes it
       volumes: ["./data:/data"]
   ```
6. **Expose on the tailnet** (on the host): `tailscale serve --bg 8787`, then open `https://<host>.<tailnet>.ts.net` on the phone and choose "Add to Home screen".

### Alternative: Cloudflare Tunnel instead of Tailscale

The app has **no login**, so a public URL must sit behind Cloudflare Access. Do step 2 before step 3.

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → create a tunnel (Docker) and copy its token into `.env` as `TUNNEL_TOKEN=...` (`.env` is in `.dockerignore`, so it stays out of the image).
2. Zero Trust → Access → Applications → add a self-hosted app for `timetester.<your-domain>`, with a policy that allows only your email address (one-time PIN login; free for up to 50 users).
3. In the tunnel, add a public hostname `timetester.<your-domain>` pointing to the service `http://timetester:8787`.
4. `cd deploy && docker compose --profile tunnel up -d` (see `deploy/README.md`). Open the URL, log in once and add it to your home screen.

A PWA works through Access: the login is a cookie, and once it expires the app asks you to log in again.

## Deliberately skipped (add when needed)

- Queuing writes while offline: add if you often log hours without a connection.
- Different hours per weekday (today `days` splits evenly) or clock-time blocks: add if the Plan view isn't enough.
- Prorating partial weeks for weekly projects: add if the first and last weeks look wrong.
- A multi-week forecast view: `computeWeek` in a loop over the next N weeks, which is about 20 lines, if you want it.
- Backups: copy `./data/timetester.db` using the host's existing backup tool.
