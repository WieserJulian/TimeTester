# Time Tester
## Goal
A simple web application that also can run native on android devices. 
I want to select a pensum of time lets say e.g 60hr a week is a managable time 
Then i want to set Projects and Time constraint. Like "Work" to 20hr/week or a code project 10hr from start date to end date. Or a project with 100hr and a deadline. 
And from this i can then determine how to proceed and plan my week. And check if i have still time left on my week load.

## Features
- **Week**: free hours vs your pensum, per-project required/logged/left, quick logging.
- **Plan**: the week day by day, with fixed weekday blocks and tasks you can add, edit, move and tick off.
- **Ahead**: a 12-week forecast that shows which weeks get overbooked and when deadlines land.
- **Projects**: weekly or total-budget projects, with a live "does this still fit?" preview. Deleting offers archiving instead.
- **Log**: add, edit and delete time entries.
- **Settings**: the pensum, and JSON backup download/restore.
- **Offline**: changes made without a connection are queued and synced when you're back online.

## Develop
TypeScript throughout. Needs Node 22.18+ (it runs `.ts` files directly and has built-in `node:sqlite`; Docker uses Node 24).

```bash
npm install
npm run server   # API on :8787, database in ./data/timetester.db
npm run dev      # UI with hot reload on :5173, /api is forwarded to :8787
npm run check    # type-check
npm test         # planner + API tests
```

Production: `npm run build` writes the UI and service worker to `dist/`, and `npm start` serves `dist/` plus the API on one port. The service worker only registers in production builds.

## Where things live
| Change | File |
|---|---|
| Weekly/daily/forecast calculation | `src/planner.ts` (pure, tested in `planner.test.ts`) |
| Data types | `src/types.ts` |
| A screen | `src/views/<Name>.tsx` |
| Add a screen / tab | the `VIEWS` line in `src/App.tsx` |
| Shared state, toasts, save helpers | `src/App.tsx` (`useApp()`) |
| Styles | `src/style.css` |
| API, validation, database | `server.ts` (tested in `server.test.ts`) |
| Offline cache and write queue | `src/sw.ts` (bump `CACHE` when changing the shell list) |

Architecture and domain rules: [PLAN.md](PLAN.md). Deploying: [deploy/README.md](deploy/README.md).
