-- Migration: overlay_state_expand (applied to project uyxnmtsntiaxqqmwsteq)
-- "Expand" on /overlay/control: the game (games.id) whose matchup pop-up the
-- TV shows over the screen. Null = closed.
alter table overlay_state add column if not exists expand_game_id text;
