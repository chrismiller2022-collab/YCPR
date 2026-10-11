-- Migration: overlay_state_sleeper (applied to project uyxnmtsntiaxqqmwsteq)
-- Sleeper fantasy on the score bug: whose leagues (Sleeper username, read-only
-- public API), which leagues to show (empty = all), the fantasy full screen,
-- and whether NFL game cards call out my players in that game.
alter table overlay_state
  add column if not exists sleeper_username text,
  add column if not exists sleeper_league_ids text[] not null default '{}',
  add column if not exists fantasy_full boolean not null default false,
  add column if not exists show_fantasy_players boolean not null default true;
