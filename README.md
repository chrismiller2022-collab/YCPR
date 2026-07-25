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

## Weekly data (Supabase)

Ratings, SOR, resume ratings, conference futures/odds, and natty odds now live
in a real database instead of hardcoded files, so nothing gets overwritten
week to week — each week is just new rows.

### One-time setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase SQL Editor, run `supabase/schema.sql`, then `supabase/seed_teams.sql`
   (seeds the `teams` table from the current static team list — safe to re-run).
3. In Supabase → Project Settings → API, copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this one secret — server only)
4. Copy `.env.example` to `.env` and fill in those three values, plus pick an
   `ADMIN_PASSWORD`.
5. In Vercel → Project Settings → Environment Variables, add the same four
   variables so the deployed site and its `/api` function can see them.

### Using the admin page

Visit `your-site.com/#admin`, enter your admin password, pick the week, and
paste that week's data (first row = column headers — the parser recognizes
common header names like Team, Rating, Rank, SOR/SOS, Resume Rank, Resume
Rating, Total Wins, Conf Proj Wins, Conf Line, Dif, Abs, Bet, Edge, Conf Win
Pct, Fair Price, Implied Pct, Odds, Value, Natty Odds). Preview the parsed
rows, then Save — this upserts into `weekly_team_stats` for that week without
touching any other week's data.

### Current migration status

`StrengthOfSchedulePage` is wired up as the working example: it reads live
from Supabase (`useWeeklyStats("latest")`) and falls back to the static
`src/data/sor.ts` snapshot for any team not yet saved to the database, so the
site keeps working during the transition.

The other data-driven pages (Home, Team, Resume Ratings, Conference Win
Totals/Odds, Bracket/Natty odds, Weekly Progression) still read from the
static `src/data/*.ts` files. Migrating each one follows the same pattern:

```tsx
import { useWeeklyStats } from "../lib/api/weeklyStats";

const { byTeam } = useWeeklyStats("latest");
const rating = byTeam[team.team]?.rating ?? STATIC_FALLBACK[team.team];
```

Once every page reads from `weekly_team_stats`, the Weekly Progression pages
can also be pointed at `fetchTeamHistory(team)` to chart a team's numbers
across every saved week instead of showing placeholder dashes.

## Editing data

Each data table lives in its own file under `src/data/`. To update ratings,
schedules, or odds, edit the corresponding file directly — e.g. `src/data/teams.ts`
for power ratings, `src/data/games.ts` for the schedule. Swapping a hardcoded
array for a live fetch later is a one-file change per table.
