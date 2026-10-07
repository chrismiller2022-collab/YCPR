-- Migration: team_win_total_lines (applied to project uyxnmtsntiaxqqmwsteq)
-- Preseason win-total markets (line + over/under prices) per team, pasted in from
-- the sheet; the Win Total PR table on the Monte Carlo > Win Totals tab devigs them.
create table if not exists team_win_total_lines (
  season integer not null,
  team text not null,
  line numeric not null,
  over_price numeric not null,
  under_price numeric not null,
  source text,
  updated_at timestamptz not null default now(),
  primary key (season, team)
);
alter table team_win_total_lines enable row level security;
create policy "Public read access to team_win_total_lines" on team_win_total_lines for select using (true);
