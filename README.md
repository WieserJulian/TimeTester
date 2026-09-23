# Time Tester
## Goal
A simple web application that also can run native on android devices. 
I want to select a pensum of time lets say e.g 60hr a week is a managable time 
Then i want to set Projects and Time constraint. Like "Work" to 20hr/week or a code project 10hr from start date to end date. Or a project with 100hr and a deadline. 
And from this i can then determine how to proceed and plan my week. And check if i have still time left on my week load.

## Develop
Needs Node 22.13+ (for built-in `node:sqlite`; Docker uses Node 24).

```bash
npm install
npm run server   # API on :8787, database in ./data/timetester.db
npm run dev      # UI with hot reload on :5173, /api is forwarded to :8787
npm test         # planner calculation tests
```

Production: `npm run build` writes the UI to `dist/`, and `npm start` serves `dist/` plus the API on one port.

## Where things live
| Change | File |
|---|---|
| Weekly/daily calculation | `src/planner.js` (pure, tested in `planner.test.js`) |
| A screen | `src/views/<Name>.jsx` |
| Add a screen / tab | the `VIEWS` line in `src/App.jsx` |
| Shared state, toasts, save helpers | `src/App.jsx` (`useApp()`) |
| Styles | `src/style.css` |
| API, validation, database | `server.js` |
| PWA shell cache | `public/sw.js` (bump `CACHE` when changing it) |

Architecture and domain rules: [PLAN.md](PLAN.md). Deploying: [deploy/README.md](deploy/README.md).
