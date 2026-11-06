-- Migration: totals2_picks (applied to project uyxnmtsntiaxqqmwsteq).
-- Totals v2 log: what the residual totals model said for each game, frozen when saved, with the market it was priced
-- against. First save wins; an overwrite only replaces games that have not kicked off. This is the honest record the
-- Model v2 page grades (game totals, and team totals split three ways: the model's own team numbers, its total split
-- by the market spread, its total split by the YCPR spread).
create table if not exists totals2_picks (
  game_id text primary key,
  season int not null,
  week int not null,
  home_team text not null,
  away_team text not null,
  model_version text,
  market_total numeric,          -- the line the projection was priced against (current line when saved)
  market_home_spread numeric,    -- negative = home favored
  market_provider text,
  proj_total numeric,            -- market_total + both sides' residuals
  proj_home_pts numeric,         -- model's own team totals (implied + residual)
  proj_away_pts numeric,
  stats_home_pts numeric,        -- layer 1 (market-blind) points, for reference
  stats_away_pts numeric,
  yc_home_spread numeric,        -- YCPR spread at save time (negative = home favored)
  weather jsonb,
  created_at timestamptz not null default now()
);
create index if not exists totals2_picks_season_week on totals2_picks (season, week);
alter table totals2_picks enable row level security;
create policy "Public read access to totals2_picks" on totals2_picks for select using (true);
