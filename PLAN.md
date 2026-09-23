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
| Calendar | Read-only iCal link (Google "secret address", Outlook "publish"), fetched by the server, parsed by `ics.ts` | No OAuth app, no tokens, no sync job. Busy time is all the app needs |
| Reminders | Periodic Background Sync in the service worker; the in-app banner on Week shows the same alerts | No push server (VAPID keys, subscriptions). The browser decides the timing, about twice a day |
| Timer | Stored on the server (`settings.timer`) | Survives closing the app and shows on every device |

## Domain model

Types live in `src/types.ts`.

**Pensum**: the hours you can realistically work, set per weekday (`week_hours`, Mon..Sun; the usual week is their sum). Older databases only had a weekly total; it's spread evenly over 7 days.

**Day override**: a date with other hours than usual: `0` = day off (vacation, holiday), `4` = half day. Changes that week's pensum.

**Calendar event**: a busy block from the iCal link (date, start, hours, title). Optional: `ics_counts` decides whether meetings count as committed time. Turn it off when meetings are already part of a project's hours, e.g. Work.

**Project** has one of two kinds:

1. `weekly`: a fixed number of hours per week, with optional `start_date` and `end_date`.
   - "Work, 20h/week" → weekly, no dates.
   - "Code project, 10h/week from start to end" → weekly with dates.
2. `budget`: a total number of hours with a `deadline` and an optional `start_date`.
   - "Thesis, 100h, due 2026-12-20".

A weekly project may also have `days` (`'1,2,3'` = Mon–Wed). The Plan view then spreads `hours_per_week` evenly over those days.

**Log entry**: hours actually spent on a project on a given date.

**Task**: a planned block of hours on a given date, optionally tied to a project, with an optional note. Marking it done logs its hours to that project and deletes the task. A task with `repeat` (`daily`, `weekdays`, `weekly`) instead moves to its next date after today (`nextOccurrence`); its later occurrences show read-only in the Plan view. Deleting it deletes the series. Unfinished tasks from past days show on today ("rolled over"), without changing their stored date.

**Timer**: at most one running (`{ project_id, started_at }`). Stopping logs the elapsed hours on the start date, note "Timer". Over 8h asks first. Starting another project logs the running one.

### Rules for the weekly calculation (`planner.ts`)

Weeks run Monday to Sunday. Every date is a `'YYYY-MM-DD'` string in local time. **Never** use `new Date('YYYY-MM-DD')`, because that parses as UTC and the day shifts by timezone. Parse the parts and call `new Date(y, m-1, d)`.

For a week starting on Monday `W`:

- **pensum** for the week = Σ over its 7 days of (the day's override, else `week_hours[weekday]`). Callers that pass only `pensum` (no `week_hours`/overrides) get that number unchanged.
- **weekly project**: it is active if the range [start, end] overlaps the week. `required = hours_per_week`. A partial first or last week still counts as a full week. If it has `days`, each of those days that is a day off (override 0) removes its share: `hours_per_week × (days not off / days)`.
- **budget project**:
  - `remaining = total_hours - sum(logs dated before W)`. Leave out this week's logs so the target doesn't move while you log hours during the week.
  - `firstWeek = max(W, monday(start_date))`. If W is before firstWeek, then `required = 0`.
  - `weeksLeft = number of weeks from W to monday(deadline), counting both ends` (at least 1).
  - `required = max(0, remaining) / weeksLeft`
  - It is **overdue** if W is after the deadline's week and `remaining > 0`. Then `required = remaining`. Show this as an alert.
- `logged` = sum of this project's logs within W to W+6.
- `calendar` = the week's event hours if `ics_counts`, else 0.
- Totals: `committed = Σ required + calendar`, `free = pensum - committed`, `loggedTotal = Σ logged`, and `overbooked = committed > pensum`.

Exports:

```ts
computeWeek(data, weekStart) → {
  weekStart, pensum, committed, free, loggedTotal, overbooked, calendar, daysOff,
  rows: [{ project, required, logged, left: required - logged, overdue }]
}
forecast(data, weekStart, weeks) → computeWeek results for `weeks` weeks in a row
planWeek(data, weekStart, today) → { days: [{ date, capacity, off, hours, fixed, tasks, events }], planned: { [project_id]: hours } }
autoPlan(data, weekStart, today) → [{ project_id, date, hours }]   // tasks to create
suggestFixes(data, weekStart) → [{ project, kind: 'deadline' | 'hours' | 'archive', … }]
alerts(data, today) → [{ key, text, bad }]
nextOccurrence(task, today), capacity(data, date), pensumFor(data, weekStart)
mondayOf(dateStr), addDays(dateStr, n), today(), dateOf(ms)
```

**Forecast rule**: it assumes you keep to the plan. After each week, every budget project's unlogged `left` is counted as logged in that week. Otherwise future weeks would pile up hours you haven't logged *yet*, because they're still in the future. So a budget project shows the same share every week up to its deadline, and 0 afterwards.

**Plan**: a day's `hours` = fixed weekday blocks + tasks + calendar events, shown against its `capacity`. Still to schedule = `required - logged - planned` (planned = all fixed blocks and tasks of the week, past ones included).

**Auto-plan**: puts "still to schedule" hours into the free capacity (`capacity - hours`) from today to Sunday, in quarter hours. Projects take turns in chunks of up to 2h per day, earliest deadline first in each round, so when time is short every project gets some. Weekly projects with `days` are already scheduled by their blocks.

**Fixes** (when overbooked): each suggestion alone makes the week fit. Budget: move the deadline by the fewest whole weeks that lower this week's share enough. Weekly: cut `hours_per_week` (rounded down to a quarter hour), or archive, if that project alone covers the overage.

**Alerts**: budget projects due within 14 days (or overdue) with hours left, and overbooked weeks in the next 4. The Week view shows them for the current week; reminders send them as notifications, plus "nothing logged today" after 18:00.

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
  hours REAL NOT NULL CHECK (hours > 0),
  note TEXT,                    -- added by migration
  repeat TEXT CHECK (repeat IN ('daily','weekdays','weekly'))  -- added by migration
);
CREATE TABLE IF NOT EXISTS day_overrides (
  date TEXT PRIMARY KEY,
  hours REAL NOT NULL CHECK (hours >= 0 AND hours <= 24),  -- 0 = day off
  note TEXT
);
PRAGMA foreign_keys = ON;
```

`settings` keys (JSON values): `week_hours` (7 numbers), `timer`, `ics_url`, `ics_counts`. The legacy `pensum` key is only read when `week_hours` is missing; the default is 60 spread over 7 days.

New columns are added on startup by `addColumn()` in `server.ts`, so an existing database upgrades itself.

## API (JSON; the server also serves the built `dist/` as static files)

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/state` | Everything in `State` (`src/types.ts`): settings, overrides, timer, calendar events (+ `ics_error`), projects, logs, tasks. The frontend loads everything with this one call |
| PUT | `/api/settings` | any of `{ week_hours, ics_url, ics_counts }`. `{ pensum }` alone (older clients) spreads it over 7 days |
| PUT | `/api/timer` | `{ project_id, started_at }` (ms, not in the future) |
| DELETE | `/api/timer` | clears it (the app logs the hours first) |
| POST | `/api/overrides` | `{ from, to?, hours, note? }`. One row per day in the range (max a year), replacing existing ones |
| DELETE | `/api/overrides/:date` | |
| POST | `/api/projects` | project fields → the created row |
| PUT | `/api/projects/:id` | any project fields; merged into the existing row → the updated row |
| DELETE | `/api/projects/:id` | cascades to its logs and tasks. The UI offers archiving (PUT `archived: 1`) first |
| POST | `/api/logs` | `{ project_id, date, hours, note? }` |
| PUT | `/api/logs/:id` | any log fields, merged |
| DELETE | `/api/logs/:id` | |
| POST | `/api/tasks` | `{ title, date, hours, project_id?, note?, repeat? }` |
| PUT | `/api/tasks/:id` | any task fields, merged (e.g. a new `date` moves it) |
| DELETE | `/api/tasks/:id` | |
| GET | `/api/export` | all stored data (settings, overrides, projects, logs, tasks; not the timer or calendar events), sent as a download (`timetester-YYYY-MM-DD.json`) |
| POST | `/api/import` | an export file. Replaces **all** data in one transaction and keeps ids. An invalid row rolls everything back with `400`. Backups from older versions (only `pensum`) still restore |

**Calendar fetch**: `/api/state` refreshes the iCal link at most every 15 minutes (8s timeout). Events from about 400 days back to 200 days ahead are kept in memory. If a fetch fails, the last good events stay and `ics_error` says why. `webcal://` is fetched as `https://`. Times given in UTC are converted to the server's zone, so set `TZ` in `compose.yaml`.

Validate every request body on the server (types, `kind`, dates matching `^\d{4}-\d{2}-\d{2}$`, positive numbers) and return `400 { error }` if it's invalid. Rely on the SQL CHECKs as a second layer. Always use prepared statements. PUT runs the merged row through the same validation as POST.

## Offline (service worker, `src/sw.ts`)

- **App shell** (`/`, manifest, icons, hashed `/assets/*`): network first, cache as fallback.
- **`GET /api/state`**: first sends any queued writes, then network first; the last good response is cached for offline use.
- **Writes** (`POST`/`PUT`/`DELETE /api/*`, except `/api/import`): passed through. If the network fails, the request is stored in a queue (the Cache API, `timetester-queue`) and the page gets `202 { queued: true }`. When something is already queued, new writes queue behind it so the order is kept.
- **Replay**: on Background Sync (Chrome/Android), on the next `/api/state` load, and when the page fires `online`. It stops at a network error or 5xx and tries again later; a 4xx is dropped and reported.
- **Page ↔ SW messages** (`SwMessage` in `types.ts`): `queue` (current size, shown as the "waiting to sync" banner) and `synced` (the page reloads and shows a toast).
- Known limits: while offline, the numbers don't include queued changes. A write that reached the server but lost its response is replayed twice. A project created offline can't get logs until it has synced, because it has no id yet.
- **Reminders**: Settings registers a `periodicsync` tag `reminders` (min. every 12h). The service worker loads `/api/state`, runs `alerts()` and shows a notification per new alert: each alert once per day, "overbooked week" alerts only once. Needs the installed app on Chrome/Android with notifications allowed. "Check now" in Settings runs it immediately.

Bump `CACHE` in `sw.ts` when you change the shell list. Never rename `QUEUE_CACHE` (it also stores which reminders were sent), or queued writes are lost.

The service worker is built by `vite.sw.config.ts` into one self-contained `dist/sw.js` (it imports `planner.ts` for the alerts). A classic service worker can't load shared chunks, so it must stay a separate build.

## Files

```
server.ts                 # static files from dist/ + API + schema + calendar fetch. No npm deps. Exports server/db for tests
ics.ts                    # iCal reader (recurring events, exceptions); used by server.ts
server.test.ts            # API tests: validation, edit/cascade, backup, week hours, days off, timer, calendar link
planner.test.ts           # calculation tests: worked example, forecast, days off, calendar, repeats, auto-plan, fixes, alerts
ics.test.ts               # calendar parsing tests
index.html                # Vite entry, mounts src/main.tsx
vite.config.ts            # app build: React plugin; /api proxy for dev
vite.sw.config.ts         # service worker build: src/sw.ts → dist/sw.js (one file)
tsconfig.json             # app + server + tests (DOM + Node types)
tsconfig.sw.json          # service worker only (WebWorker types)
src/types.ts              # data types + service worker messages
src/main.tsx              # mounts <App>, registers the service worker (production only)
src/App.tsx               # the tab list (VIEWS), #hash routing, shared state via useApp(), toasts/undo, SW messages
src/Timer.tsx             # running-timer bar + startTimer()
src/views/*.tsx           # Week, Plan, Forecast ("Ahead"), Reports ("Stats"), Projects, Log, Settings
src/planner.ts            # pure calculation (see above)
src/sw.ts                 # service worker (see Offline)
src/api.ts, src/format.ts # fetch wrapper + CSV download; hour/date formatting
src/react-css.d.ts        # allows style={{ '--c': color }}
src/style.css             # mobile-first
public/                   # copied as-is into dist/: manifest, icons
Dockerfile                # build stage (npm ci, check, test, vite build) → slim runtime stage
deploy/compose.yaml, .env.example, README.md   # server deploy (Watchtower + GHCR image)
```

### Frontend conventions

- `useApp()` gives every view `{ state, weekStart, setWeekStart, toast, run, submit, undoable }`.
- Writes go through `run(fn, okMsg?)`: it calls the API, reloads `/api/state`, and shows errors as a toast. No per-view caching; reloading everything is fine at this data size. The app also reloads when it comes back to the foreground.
- Deletes of logs, tasks, days off and the timer use `undoable(what, del, restore)`: the toast offers Undo for 7s, which re-creates the row (with a new id). Deleting a project has no undo; it asks first and offers Archive instead.
- Simple forms are uncontrolled: `onSubmit={submit((formData) => api(...), afterSuccess)}`. The same form component handles "new" and "edit" (`LogForm`, `TaskForm`). The project form is controlled because it drives the live preview.
- Local UI state (which form is open) lives in the view; switching tabs remounts the view and closes it.
- Project pickers (`ProjectOptions`) hide archived projects but keep the one being edited.

## Views

The running timer bar (project, elapsed time, Stop, discard) sits above every view.

1. **Week** (`#week`, the default): a week picker (◀ this week ▶), alerts (current week only), a bar comparing committed and logged hours against this week's pensum (noting days off and calendar hours), the free hours, and a red banner if overbooked, with one-tap **fixes**. Each project gets a row with color, name, required, logged and left, an "overdue" badge, and ▶ to start its timer. Tapping a row opens a quick-log form for that project with today's date.
2. **Plan** (`#plan`): the week as 7 day cards, each showing planned hours of its capacity (red when over) or "day off". Calendar events (dashed), weekly projects with `days` as fixed blocks, then tasks: ↻ marks repeating ones, rolled-over tasks say "from Mon", and later occurrences of repeating tasks are dimmed and read-only. `+` adds a task; tapping one edits it (including moving it to another day or changing its repeat); ✓ logs its hours. Below: "Still to schedule" per project and **Auto-plan into free time**.
3. **Ahead** (`#forecast`): the next 12 weeks from the selected week. One stacked bar per week (a segment per project, in its color, plus hatched calendar hours), a dashed line at that week's pensum, free/over hours, days off, and a ⚑ on the week a budget project is due. Tapping a week opens it in Week.
4. **Stats** (`#reports`): 4 weeks / 12 weeks / 6 months / 1 year back, starting no earlier than your first log entry. Average logged per week vs pensum and vs committed (with a hint when the pensum looks unrealistic), committed vs logged per week, logged vs planned per project, and CSV export.
5. **Projects** (`#projects`): a list plus an add/edit form. A toggle between weekly and budget shows the right fields. **Show a live preview** of this week's committed/free hours as you type, using `computeWeek` with the draft project included. This is how you answer "do I still have time for this?" Delete asks first and offers **Archive instead**, because deleting also removes the logged hours.
6. **Log** (`#log`): an add-entry form (project, date defaulting to today, hours, note), filters (project, from/to, text), the total of what matches, CSV export, and the matching entries (first 100, then "Show all") with edit and delete.
7. **Settings** (`#settings`, ⚙ in the nav): hours per weekday; days off (single day or range, 0 hours or a half day); the calendar link and whether meetings count as committed; reminders (on/off, check now); backup download/restore.

Manifest shortcuts (long-press the app icon): Log, Plan, Ahead.

## Build & run

1. **Checks**: `npm run check` (TypeScript, both configs) and `npm test` (planner, calendar, API). The Docker build runs both and fails if either does.
2. **Server**: port from `PORT` (default 8787), database path from `DB_PATH` (default `data/timetester.db`; the Docker image sets `/data/timetester.db`), time zone from `TZ` (compose default `Europe/Vienna`; used for calendar times).
3. **Frontend**: `npm run dev` for hot reload, `npm run build` for `dist/` (app, then service worker). It must work at 400px width.
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
- Clock-time blocks (9:00–11:00) for tasks, or a project's hours differing per weekday (today `days` splits evenly): add if the Plan view isn't enough.
- Prorating partial weeks for weekly projects: add if the first and last weeks look wrong.
- Spreading budget projects by each week's capacity (today: evenly, so a vacation week gets the same share): add if vacation weeks look overbooked.
- Real web push (server-sent, exact times) instead of Periodic Background Sync: needs VAPID keys and a push library. Add if reminders arrive too late.
- Two-way calendar sync, time zones per event (`TZID`) and "2nd Tuesday"-style monthly rules: add a calendar library if the iCal link isn't enough.
- Tags across projects, a daily planning ritual, subtasks: not built; add if the need shows up.
- Scheduled backups: `/api/export` is manual; for automatic backups copy `./data/timetester.db` with the host's backup tool.
