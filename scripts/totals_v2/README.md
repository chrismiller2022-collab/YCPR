# Totals v2 — offline training (residual, team-level, point-in-time)

Run from the repo root with bun:

1. `bun scripts/totals_v2/pull.ts` — games, lines, per-game advanced stats (with plays/drives), play-level aggregates,
   preseason inputs, venues, team-total lines → `scripts/totals_v2/data/` (git-ignored; public read key).
2. `bun scripts/totals_v2/weather_meteostat.ts` — observed game-window weather from Meteostat's bulk station archive
   (no key, no quota). Live projections use Open-Meteo forecasts through `src/lib/weather.ts`.
3. `bun scripts/totals_v2/train.ts` — per-season walk-forward report. `--tune` grids the settings on 2023-24 only;
   `--export` writes `src/lib/totals2/frozen.ts` (fit on every finished season) and `last_report.txt`; `--coef`
   prints the fitted weights.
4. `VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… bun scripts/totals_v2/check_live.ts 2026` — runs the page's live
   pipeline outside the browser as a sanity check.

Retrain each offseason (step 1-3 with `--export`). Every season is only ever predicted by fits on earlier seasons.
