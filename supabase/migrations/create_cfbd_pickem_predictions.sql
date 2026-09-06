-- CFBD Pick'em previously saved nothing (pure paste-in/paste-out tool) —
-- this is the first persistence it gets, so its predictions can be
-- graded once games finish (SU record, ATS record against the actual
-- closing line, MAE/MSE of the predicted margin). One row per game
-- (game_id is globally unique across seasons already, so no separate
-- week column is needed — a game's week is read off the `games` table
-- itself whenever these are graded).
create table if not exists cfbd_pickem_predictions (
  game_id text primary key,
  season integer not null,
  predicted_margin numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists cfbd_pickem_predictions_season_idx on cfbd_pickem_predictions(season);

alter table cfbd_pickem_predictions enable row level security;
create policy "public read cfbd_pickem_predictions" on cfbd_pickem_predictions for select using (true);
