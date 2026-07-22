# College Football Power Ratings

A Vite + React + TypeScript rebuild of the original single-file Claude artifact,
split into a normal project structure so it's easy to edit, review, and deploy.

## Structure

```
src/
  data/        # Typed data tables (teams, games, odds, logos, etc.) — one file per table
  lib/         # Pure logic: odds math, ranking, schedule/matchup calculations, nav config
  components/  # Small reusable UI pieces (TeamLogo, SortHeader, TeamPicker, ...)
  pages/       # One file per route/page (HomePage, TeamPage, BracketPage, ...)
  styles/      # global.css (pulled out of the old inline <style> block)
  App.tsx      # Routing shell (hand-rolled page-state switch, same behavior as before)
  main.tsx     # Entry point
```

This mirrors the original artifact's behavior exactly — no logic was rewritten,
only relocated into modules with imports/exports wired up. Component props are
typed loosely (`any`) in places rather than fully modeled, since the goal of this
pass was safe structural migration, not a full type-safety pass. Tightening
individual prop types later is straightforward and can be done file-by-file
without touching behavior.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build      # production build via Vite (outputs to dist/)
npm run typecheck   # tsc --noEmit, currently passes clean
```

## Deploying

### GitHub
```bash
git init
git add -A
git commit -m "Initial commit: modularized power ratings app"
git remote add origin <your-repo-url>
git push -u origin main
```

### Vercel
Import the GitHub repo in Vercel — it auto-detects Vite:
- Build command: `npm run build`
- Output directory: `dist`

No environment variables or server-side code are required; this is a fully
static single-page app.

## Editing data

Each data table lives in its own file under `src/data/`. To update ratings,
schedules, or odds, edit the corresponding file directly — e.g. `src/data/teams.ts`
for power ratings, `src/data/games.ts` for the schedule. Swapping a hardcoded
array for a live fetch later is a one-file change per table.
