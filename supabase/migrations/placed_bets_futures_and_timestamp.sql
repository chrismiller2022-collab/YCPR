-- Migration: placed_bets_futures_and_timestamp (applied to project uyxnmtsntiaxqqmwsteq)
-- Futures/season-long bets aren't tied to one scheduled game (no game_id,
-- home_team or week) — relax those to nullable. placed_at is the actual
-- moment the bet was placed (separate from the CSV's "date", which only
-- narrows which season to search); market holds a futures bet's free-text
-- question ("Will Baylor win at least 6 games?").
alter table placed_bets
  alter column game_id drop not null,
  alter column home_team drop not null,
  alter column week drop not null,
  add column if not exists placed_at timestamptz,
  add column if not exists market text;
