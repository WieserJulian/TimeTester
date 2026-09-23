# Time Tester — Architecture & Build Plan

Build spec for the goal in `README.md`. Keep it small. Everything is TypeScript: the frontend is React (Vite build), and the server runs its `.ts` file directly on Node, with no npm dependencies.

## Decisions (fixed)

| Topic | Decision | Why |
|---|---|---|
| Hosting | One Docker container on a home system, reached over Tailscale | Syncs across devices without a cloud service |
| Auth | **None.** Only devices on the tailnet can reach it | Tailscale already controls who has access |
| HTTPS | `tailscale serve` on the host → `https://<host>.<tailnet>.ts.net` | A PWA's service worker and install only work over HTTPS |
| Android | Installable PWA (manifest + service worker) | One codebase, no app store |
| Language | TypeScript everywhere, `strict`. Node ≥ 22.18 runs `server.ts` and the tests by stripping types, so only *erasable* syntax (no `enum`, no parameter properties) and imports end in `.ts` | Type errors caught before runtime, with no compile step for the server |
| Backend | Node 24, `node:http` + built-in `node:sqlite` | **Zero npm dependencies** at runtime |
| Frontend | React 19 + Vite, CSS in one file. `vite build` → `dist/`, which `server.ts` serves | Components are easier to change than string templates. The build only runs in Docker's build stage; the runtime image has no `node_modules` |
| Storage | SQLite file in a Docker volume at `/data/timetester.db` (`./data/` when run locally) | A single file is easy to back up |
| Calculation | A pure module `src/planner.ts`, run in the browser | Easy to test. The data is small enough to load all of it |
| Offline | The service worker caches the app shell and the last `/api/state`. Writes made offline are queued and replayed in order when back online | Log hours on the go. Single user, so replaying in order is enough; no conflict handling |

## Domain model

Types live in `src/types.ts`.

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

### Rules for the weekly calculation (`planner.ts`)

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

Exports:

```ts
computeWeek({ pensum, projects, logs }, weekStart) → {
  weekStart, pensum, committed, free, loggedTotal, overbooked,
  rows: [{ project, required, logged, left: required - logged, overdue }]
}
forecast(data, weekStart, weeks) → computeWeek results for `weeks` weeks in a row
planWeek({ projects, tasks }, weekStart) → { days: [{ date, fixed, tasks, hours }], planned: { [project_id]: hours } }
mondayOf(dateStr), addDays(dateStr, n), today()
```

**Forecast rule**: it assumes you keep to the plan. After each week, every budget project's unlogged `left` is counted as logged in that week. Otherwise future weeks would pile up hours you haven't logged *yet*, because they're still in the future. So a budget project shows the same share every week up to its deadline, and 0 afterwards.

`planWeek` is for the Plan view: `required - planned` = still to schedule.

### Worked example (use this as a test case)

Pensum 60. The week starts on 2026-09-21 (a Monday).
- Work: weekly 20h → required 20.
- Code: weekly 10h, 2026-10-01 to 2026-12-31 → not active this week → 0.
- Thesis: budget 100h, deadline 2026-12-20, 30h logged before 09-21 → the deadline week is Monday 12-14, which is 84 days / 12 weeks later, so there are 13 weeks counting both ends → 70/13 = **5.38**.
- committed = 25.38, free = 34.62, overbooked = false.

## Database (`server.ts` creates this on startup)

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
| PUT | `/api/projects/:id` | any project fields; merged into the existing row → the updated row |
| DELETE | `/api/projects/:id` | cascades to its logs and tasks. The UI offers archiving (PUT `archived: 1`) first |
| POST | `/api/logs` | `{ project_id, date, hours, note? }` |
| PUT | `/api/logs/:id` | any log fields, merged |
| DELETE | `/api/logs/:id` | |
| POST | `/api/tasks` | `{ title, date, hours, project_id? }` |
| PUT | `/api/tasks/:id` | any task fields, merged (e.g. a new `date` moves it) |
| DELETE | `/api/tasks/:id` | |
| GET | `/api/export` | same body as `/api/state`, sent as a download (`timetester-YYYY-MM-DD.json`) |
| POST | `/api/import` | an export file. Replaces **all** data in one transaction and keeps ids. An invalid row rolls everything back with `400` |

Validate every request body on the server (types, `kind`, dates matching `^\d{4}-\d{2}-\d{2}$`, positive numbers) and return `400 { error }` if it's invalid. Rely on the SQL CHECKs as a second layer. Always use prepared statements. PUT runs the merged row through the same validation as POST.

## Offline (service worker, `src/sw.ts`)

- **App shell** (`/`, manifest, icons, hashed `/assets/*`): network first, cache as fallback.
- **`GET /api/state`**: first sends any queued writes, then network first; the last good response is cached for offline use.
- **Writes** (`POST`/`PUT`/`DELETE /api/*`, except `/api/import`): passed through. If the network fails, the request is stored in a queue (the Cache API, `timetester-queue`) and the page gets `202 { queued: true }`. When something is already queued, new writes queue behind it so the order is kept.
- **Replay**: on Background Sync (Chrome/Android), on the next `/api/state` load, and when the page fires `online`. It stops at a network error or 5xx and tries again later; a 4xx is dropped and reported.
- **Page ↔ SW messages** (`SwMessage` in `types.ts`): `queue` (current size, shown as the "waiting to sync" banner) and `synced` (the page reloads and shows a toast).
- Known limits: while offline, the numbers don't include queued changes. A write that reached the server but lost its response is replayed twice. A project created offline can't get logs until it has synced, because it has no id yet.

Bump `CACHE` in `sw.ts` when you change the shell list. Never rename `QUEUE_CACHE`, or queued writes are lost.

## Files

```
server.ts                 # static files from dist/ + API + schema. No npm deps. Exports server/db for tests
server.test.ts            # API tests: validation, edit/cascade, export/import round trip
planner.test.ts           # calculation tests, includes the worked example and the forecast
index.html                # Vite entry, mounts src/main.tsx
vite.config.ts            # React plugin; /api proxy for dev; builds src/sw.ts to /sw.js
tsconfig.json             # app + server + tests (DOM + Node types)
tsconfig.sw.json          # service worker only (WebWorker types)
src/types.ts              # row types + service worker messages
src/main.tsx              # mounts <App>, registers the service worker (production only)
src/App.tsx               # the tab list (VIEWS), #hash routing, shared state via useApp(), SW messages
src/views/*.tsx           # Week, Plan, Forecast ("Ahead"), Projects, Log, Settings
src/planner.ts            # pure calculation (see above)
src/sw.ts                 # service worker (see Offline)
src/api.ts, src/format.ts # fetch wrapper; hour/date formatting
src/react-css.d.ts        # allows style={{ '--c': color }}
src/style.css             # mobile-first
public/                   # copied as-is into dist/: manifest, icons
Dockerfile                # build stage (npm ci, check, test, vite build) → slim runtime stage
deploy/compose.yaml, .env.example, README.md   # server deploy (Watchtower + GHCR image)
```

### Frontend conventions

- `useApp()` gives every view `{ state, weekStart, setWeekStart, run, submit }`.
- Writes go through `run(fn, okMsg?)`: it calls the API, reloads `/api/state`, and shows errors as a toast. No per-view caching; reloading everything is fine at this data size.
- Simple forms are uncontrolled: `onSubmit={submit((formData) => api(...), afterSuccess)}`. The same form component handles "new" and "edit" (`LogForm`, `TaskForm`). The project form is controlled because it drives the live preview.
- Local UI state (which form is open) lives in the view; switching tabs remounts the view and closes it.
- Project pickers (`ProjectOptions`) hide archived projects but keep the one being edited.

## Views

1. **Week** (`#week`, the default): a week picker (◀ this week ▶), a bar comparing committed and logged hours against the pensum, the free hours, and a red banner if overbooked. Each project gets a row with color, name, required, logged and left, plus an "overdue" badge. Tapping a row opens a quick-log form for that project with today's date.
2. **Plan** (`#plan`): the week as 7 day cards. Weekly projects with `days` show as fixed blocks; `+` adds a task to a day; tapping a task edits it (including moving it to another day); ✓ logs its hours and removes it. Below: "Still to schedule" per project (`required - planned`).
3. **Ahead** (`#forecast`): the next 12 weeks from the selected week. One stacked bar per week (a segment per project, in its color), a dashed line at the pensum, free/over hours, and a ⚑ on the week a budget project is due. Tapping a week opens it in Week.
4. **Projects** (`#projects`): a list plus an add/edit form. A toggle between weekly and budget shows the right fields. **Show a live preview** of this week's committed/free hours as you type, using `computeWeek` with the draft project included. This is how you answer "do I still have time for this?" Delete asks first and offers **Archive instead**, because deleting also removes the logged hours.
5. **Log** (`#log`): an add-entry form (project, date defaulting to today, hours, note) and the last 50 entries with edit and delete.
6. **Settings** (`#settings`): the pensum, plus Backup: download a JSON backup, or restore from one (asks before replacing everything).

## Build & run

1. **Checks**: `npm run check` (TypeScript, both configs) and `npm test` (planner + API). The Docker build runs both and fails if either does.
2. **Server**: port from `PORT` (default 8787), database path from `DB_PATH` (default `data/timetester.db`; the Docker image sets `/data/timetester.db`).
3. **Frontend**: `npm run dev` for hot reload, `npm run build` for `dist/`. It must work at 400px width.
4. **PWA**: manifest (`display: standalone`, icons, theme color) and the service worker. Check it in Chrome DevTools → Application. To test offline, stop the server (the DevTools "Offline" box also works).
5. **Docker**: see `Dockerfile` (multi-stage). Minimal local compose:
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

- Showing queued offline changes in the numbers before they sync: add if the "waiting to sync" banner isn't enough.
- Request ids so a replayed offline write can't be applied twice: add if duplicate entries ever show up.
- Different hours per weekday (today `days` splits evenly) or clock-time blocks: add if the Plan view isn't enough.
- Prorating partial weeks for weekly projects: add if the first and last weeks look wrong.
- Scheduled backups: `/api/export` is manual; for automatic backups copy `./data/timetester.db` with the host's backup tool.
