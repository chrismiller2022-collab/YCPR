-- Migration: team_coach_seasons (applied to project uyxnmtsntiaxqqmwsteq)
-- One row per coach per team per season, from CFBD /coaches (the Team Info
-- pull's "Coaches" part). Powers the coach-history table on the admin team
-- overview. A mid-season change shows up as two coaches in the same year.
create table if not exists team_coach_seasons (
  team text not null,
  year integer not null,
  coach_id text not null,
  coach_name text not null,
  hire_date text,
  games integer,
  wins integer,
  losses integer,
  ties integer,
  srs numeric,
  sp_overall numeric,
  preseason_rank integer,
  postseason_rank integer,
  updated_at timestamptz not null default now(),
  primary key (team, year, coach_id)
);

alter table team_coach_seasons enable row level security;
create policy "Public read access to team_coach_seasons" on team_coach_seasons for select using (true);
