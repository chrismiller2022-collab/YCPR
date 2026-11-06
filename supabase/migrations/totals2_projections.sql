-- Migration: totals2_projections (applied to project uyxnmtsntiaxqqmwsteq).
-- The current Totals v2 number for every game, written by the scheduled job (scripts/totals_v2/project.ts via
-- .github/workflows/totals-v2.yml). Pages read this instead of rebuilding ratings in the browser. A game's row stops
-- changing once it kicks off, so it doubles as the pre-kickoff record.
--   resid_total  = the close model's expected (actual − line); the site's projected total is the CURRENT line + this
--   proj_total   = line_total + resid_total, at compute time
--   move         = the line-move model's expected open → close move of the total; star = top-10% bet signal
create table if not exists totals2_projections (
  game_id text primary key,
  season int not null,
  week int not null,
  start_date timestamptz,
  home_team text not null,
  away_team text not null,
  model_version text,
  market_provider text,
  open_total numeric,
  open_spread numeric,
  line_total numeric,
  line_spread numeric,
  resid_total numeric,
  proj_total numeric,
  proj_home_pts numeric,
  proj_away_pts numeric,
  open_proj_total numeric,
  move numeric,
  star boolean,
  stats_home_pts numeric,
  stats_away_pts numeric,
  weather jsonb,
  computed_at timestamptz not null default now()
);
create index if not exists totals2_projections_season_week on totals2_projections (season, week);
alter table totals2_projections enable row level security;
create policy "Public read access to totals2_projections" on totals2_projections for select using (true);
