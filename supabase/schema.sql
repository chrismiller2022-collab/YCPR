-- Run this once in the Supabase SQL Editor (or via `supabase db push`) to set up
-- the tables. This replaces the static SOS_BY_TEAM / RESUME_BY_TEAM / CONF_FUTURES /
-- NATTY_BY_TEAM / TEAMS-rating-and-rank objects with one week-aware table.

create table if not exists teams (
  team text primary key,
  div text not null check (div in ('FBS', 'FCS')),
  conf text not null
);

-- One row per team, per week. "week" is a plain label: 'preseason', 'week1' ... 'week16'.
-- Nothing is ever overwritten — a new week is just new rows with a new week value,
-- so history is preserved automatically and Weekly Progression pages have real data
-- to read instead of placeholder dashes.
create table if not exists weekly_team_stats (
  id bigint generated always as identity primary key,
  team text not null references teams(team) on delete cascade,
  week text not null,

  -- power rating
  rating numeric,
  rank int,

  -- strength of resume / schedule
  sor numeric,

  -- resume ratings
  resume_rank int,
  resume_rating numeric,

  -- conference win totals / futures
  total_wins numeric,
  conf_proj_wins numeric,
  conf_line numeric,
  dif numeric,
  abs_dif numeric,
  bet text,
  edge numeric,

  -- conference win odds
  conf_win_pct numeric,
  fair_price numeric,
  implied_pct numeric,
  odds numeric,
  value numeric,

  -- national championship odds
  natty_odds numeric,

  inserted_at timestamptz not null default now(),

  unique (team, week)
);

create index if not exists weekly_team_stats_week_idx on weekly_team_stats (week);
create index if not exists weekly_team_stats_team_idx on weekly_team_stats (team);

-- Row Level Security: public read-only access. All writes go through the
-- admin API route using the service role key, which bypasses RLS entirely,
-- so no "write" policy is defined here on purpose.
alter table teams enable row level security;
alter table weekly_team_stats enable row level security;

create policy "Public read access to teams"
  on teams for select
  using (true);

create policy "Public read access to weekly_team_stats"
  on weekly_team_stats for select
  using (true);
