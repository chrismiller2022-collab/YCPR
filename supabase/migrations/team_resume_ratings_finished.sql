-- Migration: team_resume_ratings_finished (applied to project uyxnmtsntiaxqqmwsteq)
-- Snapshots of the Resume Rating computed with "completed games only" (no
-- rest-of-season projection). Same shape as team_resume_ratings; not yet read
-- by any public page or the weekly report.
create table if not exists team_resume_ratings_finished (
  id bigint generated always as identity primary key,
  season integer not null,
  week integer not null,
  team text not null,
  score numeric,
  act_wins numeric,
  losses numeric,
  updated_at timestamptz not null default now(),
  unique (season, week, team)
);
alter table team_resume_ratings_finished enable row level security;
create policy "Public read access to team_resume_ratings_finished" on team_resume_ratings_finished for select using (true);
