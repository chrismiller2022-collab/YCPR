-- Real market team-total lines (The Odds API's team_totals market, e.g.
-- Tennessee TT 30.5 / Auburn TT 29 for a Tennessee @ Auburn game total of
-- 59.5) — separate from the synthetic "game total split by spread" this
-- site derives on its own, which has no real market backing. One row per
-- (game, team); `provider` is whichever book actually carried the line
-- (currently only seen via FanDuel for NCAAF — Bovada/BetOnline/Novig,
-- this site's usual three books, don't carry it). Not every game has one
-- — additional markets aren't universal for college football yet.
create table if not exists team_total_lines (
  game_id text not null references games(id),
  season int not null,
  week int not null,
  team text not null,
  provider text,
  point numeric,
  over_price numeric,
  under_price numeric,
  pulled_at timestamptz not null default now(),
  primary key (game_id, team)
);

alter table team_total_lines enable row level security;

create policy "team_total_lines public read" on team_total_lines
  for select using (true);

create index if not exists team_total_lines_season_week_idx on team_total_lines (season, week);
