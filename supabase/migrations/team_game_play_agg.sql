-- Migration: team_game_play_agg (applied to project uyxnmtsntiaxqqmwsteq).
-- Per team-game aggregates from CFBD /plays for the DROGBA model: garbage-time-filtered success rate and isolated
-- explosiveness (rush / pass splits), turnovers, and special-teams value (field goals vs expected, punt and kickoff PPA).
-- Definitions live in api/_playsAggregate.ts.
create table if not exists team_game_play_agg (
  game_id text not null, team text not null, season int not null, week int,
  f_plays int, f_success int, f_ppa_success_sum numeric, f_ppa_success_n int, f_explosive int,
  r_plays int, r_success int, r_ppa_success_sum numeric,
  p_plays int, p_success int, p_ppa_success_sum numeric,
  garbage_plays int, turnovers int,
  st_fg_att int, st_fg_made int, st_fg_pts_over numeric,
  st_punt_n int, st_punt_yds numeric, st_punt_ppa numeric,
  st_ko_n int, st_ko_yds numeric, st_ko_ppa numeric,
  st_ppa_sum numeric, st_n int,
  updated_at timestamptz not null default now(),
  primary key (game_id, team)
);
create index if not exists team_game_play_agg_season_week on team_game_play_agg (season, week);
alter table team_game_play_agg enable row level security;
create policy "Public read access to team_game_play_agg" on team_game_play_agg for select using (true);

-- Added after the first real test pull: punt/kickoff yardage from CFBD isn't kick distance, so special-teams kicks are
-- measured by the field position the receiving offense starts from (net of where the kick was taken).
alter table team_game_play_agg
  add column if not exists st_punt_net_yds numeric, add column if not exists st_punt_net_n int,
  add column if not exists st_ko_net_yds numeric, add column if not exists st_ko_net_n int;
