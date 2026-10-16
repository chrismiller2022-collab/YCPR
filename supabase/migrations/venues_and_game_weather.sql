-- Migration: venues_and_game_weather (applied to project uyxnmtsntiaxqqmwsteq)
-- Stadium coordinates for the admin Weather page (Open-Meteo forecasts per game).
--  - venues: every CFBD venue (/venues), so neutral-site games resolve to their real location.
--  - team_venues: each team's home stadium (/teams location), self-contained so any page can read a team's
--    coordinates without a join.
--  - games.venue_id / venue / start_time_tbd: the venue CFBD lists for the game itself, and whether the kickoff
--    time is still TBD (start_date is then just the date).
create table if not exists venues (
  id int primary key,
  name text,
  city text,
  state text,
  zip text,
  country_code text,
  timezone text,
  latitude numeric,
  longitude numeric,
  elevation numeric,
  capacity int,
  construction_year int,
  grass boolean,
  dome boolean,
  updated_at timestamptz not null default now()
);
alter table venues enable row level security;
create policy "Public read access to venues" on venues for select using (true);

create table if not exists team_venues (
  team text primary key,
  venue_id int,
  venue_name text,
  city text,
  state text,
  timezone text,
  latitude numeric,
  longitude numeric,
  elevation numeric,
  capacity int,
  grass boolean,
  dome boolean,
  updated_at timestamptz not null default now()
);
alter table team_venues enable row level security;
create policy "Public read access to team_venues" on team_venues for select using (true);

alter table games add column if not exists venue_id int;
alter table games add column if not exists venue text;
alter table games add column if not exists start_time_tbd boolean;
