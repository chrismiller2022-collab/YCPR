-- Migration: drogba_tables (DROGBA spread model). Applied to project uyxnmtsntiaxqqmwsteq.
-- 1) Full per-game advanced stats on team_game_advanced (previously only success rate).
alter table team_game_advanced
  add column if not exists off_plays numeric, add column if not exists def_plays numeric,
  add column if not exists off_drives numeric, add column if not exists def_drives numeric,
  add column if not exists off_ppa numeric, add column if not exists def_ppa numeric,
  add column if not exists off_explosiveness numeric, add column if not exists def_explosiveness numeric,
  add column if not exists off_power_success numeric, add column if not exists def_power_success numeric,
  add column if not exists off_stuff_rate numeric, add column if not exists def_stuff_rate numeric,
  add column if not exists off_line_yards numeric, add column if not exists def_line_yards numeric,
  add column if not exists off_havoc_total numeric, add column if not exists def_havoc_total numeric,
  add column if not exists off_rush_ppa numeric, add column if not exists def_rush_ppa numeric,
  add column if not exists off_rush_success_rate numeric, add column if not exists def_rush_success_rate numeric,
  add column if not exists off_pass_ppa numeric, add column if not exists def_pass_ppa numeric,
  add column if not exists off_pass_success_rate numeric, add column if not exists def_pass_success_rate numeric,
  add column if not exists off_standard_downs_ppa numeric, add column if not exists def_standard_downs_ppa numeric,
  add column if not exists off_passing_downs_ppa numeric, add column if not exists def_passing_downs_ppa numeric;

-- 2) Preseason inputs per team-season: returning production, talent composite, recruiting class, transfer portal.
create table if not exists team_preseason_inputs (
  season int not null, team text not null,
  returning_ppa_pct numeric, returning_pass_ppa_pct numeric, returning_rush_ppa_pct numeric, returning_rec_ppa_pct numeric,
  returning_usage numeric, returning_total_ppa numeric,
  talent numeric,
  recruiting_rank int, recruiting_points numeric,
  portal_in_count int, portal_in_rating_sum numeric, portal_out_count int, portal_out_rating_sum numeric,
  updated_at timestamptz not null default now(), primary key (season, team)
);
alter table team_preseason_inputs enable row level security;
create policy "Public read access to team_preseason_inputs" on team_preseason_inputs for select using (true);

-- 3) DROGBA picks log (Phase 5): the number the model had when the line was open, graded later vs open and close.
create table if not exists drogba_picks (
  game_id text primary key, season int not null, week int not null,
  home_team text not null, away_team text not null,
  model_home_spread numeric not null,      -- DROGBA's number, home-relation (negative = home favored)
  open_spread numeric, open_provider text, -- the opening line it was compared with
  edge numeric,                            -- model_home_spread - open_spread (negative = home side)
  side text,                               -- 'home' | 'away' | null
  filtered boolean not null default false, -- passed the pick filters
  model_version text,
  created_at timestamptz not null default now()
);
alter table drogba_picks enable row level security;
create policy "Public read access to drogba_picks" on drogba_picks for select using (true);

-- Added with the power-vs-power split: which group a pick belongs to ('power' = both teams power-conference; 'other').
alter table drogba_picks add column if not exists tier text;
