# Time Tester
## Goal
A simple web application that also can run native on android devices. 
I want to select a pensum of time lets say e.g 60hr a week is a managable time 
Then i want to set Projects and Time constraint. Like "Work" to 20hr/week or a code project 10hr from start date to end date. Or a project with 100hr and a deadline. 
And from this i can then determine how to proceed and plan my week. And check if i have still time left on my week load.

## Features
- **Week**: free hours vs this week's pensum, per-project required/logged/left, quick logging, a ▶ timer per project. Upcoming deadlines and overbooked weeks show at the top. When the week is overbooked, it suggests fixes (move a deadline, cut hours, archive) that you apply with one tap.
- **Plan**: the week day by day against each day's hours: calendar meetings, fixed weekday blocks, and tasks. Tasks can repeat (daily, weekdays, weekly) and have notes. Unfinished ones roll over to today. **Auto-plan** fills your free hours with what each project still needs.
- **Ahead**: a 12-week forecast that shows which weeks get overbooked, days off, and when deadlines land.
- **Stats**: planned vs logged per week and per project over 4 weeks to a year, the average compared with your pensum, and CSV export.
- **Projects**: weekly or total-budget projects, with a live "does this still fit?" preview. Deleting offers archiving instead.
- **Log**: add, edit and delete entries (with undo). Filter by project, dates or text; export CSV.
- **Settings** (⚙): hours per weekday, days off and vacations, a calendar link (Google/Outlook iCal), reminder notifications, JSON backup/restore.
- **Timer**: runs on the server, so it survives closing the app and shows on every device. A timer left running over 8h asks before logging.
- **Offline**: changes made without a connection are queued and synced when you're back online.
- **Home screen shortcuts** (long-press the app icon): Log, Plan, Ahead.

## Develop
TypeScript throughout. Needs Node 22.18+ (it runs `.ts` files directly and has built-in `node:sqlite`; Docker uses Node 24).

```bash
npm install
npm run server   # API on :8787, database in ./data/timetester.db
npm run dev      # UI with hot reload on :5173, /api is forwarded to :8787
npm run check    # type-check
npm test         # planner, calendar and API tests
```

Production: `npm run build` writes the UI and service worker to `dist/`, and `npm start` serves `dist/` plus the API on one port. The service worker only registers in production builds.

## Where things live
| Change | File |
|---|---|
| Calculations: week, forecast, day plan, auto-plan, fixes, alerts, repeats | `src/planner.ts` (pure, tested in `planner.test.ts`) |
| Data types | `src/types.ts` |
| A screen | `src/views/<Name>.tsx` |
| Add a screen / tab | the `VIEWS` line in `src/App.tsx` |
| Shared state, toasts, undo, save helpers | `src/App.tsx` (`useApp()`) |
| Timer bar | `src/Timer.tsx` |
| Styles | `src/style.css` |
| API, validation, database | `server.ts` (tested in `server.test.ts`) |
| Calendar (iCal) reading | `ics.ts` (tested in `ics.test.ts`) |
| Offline cache, write queue, reminders | `src/sw.ts` (bump `CACHE` when changing the shell list) |

Architecture and domain rules: [PLAN.md](PLAN.md). Deploying: [deploy/README.md](deploy/README.md).
