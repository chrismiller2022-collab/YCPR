-- Migration: team_info_tables (applied to project uyxnmtsntiaxqqmwsteq)
-- Backs the admin Team Info page's CFBD pull: per-game net success rate and head coach tenure.
-- (PGWE is games.home/away_postgame_win_probability, already existing.)
create table if not exists team_game_advanced (
  game_id text not null, team text not null, season int not null, week int, season_type text, opponent text,
  off_success_rate numeric, def_success_rate numeric, net_success_rate numeric,
  updated_at timestamptz not null default now(), primary key (game_id, team)
);
create index if not exists team_game_advanced_season_week on team_game_advanced (season, week);
alter table team_game_advanced enable row level security;
create policy "Public read access to team_game_advanced" on team_game_advanced for select using (true);

create table if not exists team_coaches (
  season int not null, team text not null, coach_name text not null, hire_date text,
  tenure_seasons int, first_year_at_school int, latest_year_with_data int,
  updated_at timestamptz not null default now(), primary key (season, team)
);
alter table team_coaches enable row level security;
create policy "Public read access to team_coaches" on team_coaches for select using (true);
