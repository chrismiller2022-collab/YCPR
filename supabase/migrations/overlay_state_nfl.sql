-- Migration: overlay_state_nfl (applied to project uyxnmtsntiaxqqmwsteq)
-- NFL mode for the score bug: which league the TV shows, the NFL games
-- picked (ESPN event ids, kept separate from the college picks so switching
-- doesn't lose either), and an optional NFL week (null = ESPN's current week).
alter table overlay_state
  add column if not exists league text not null default 'cfb' check (league in ('cfb', 'nfl')),
  add column if not exists nfl_game_ids text[] not null default '{}',
  add column if not exists nfl_week integer;
