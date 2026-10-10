-- Migration: overlay_state_detail_options (applied to project uyxnmtsntiaxqqmwsteq)
-- Per-screen toggles on /overlay/control: extra live detail from ESPN's
-- scoreboard (last play, timeouts, win probability, TV network), a compact
-- score-and-clock-only mode, and a flash when one of my bets flips between
-- covering and not.
alter table overlay_state
  add column if not exists show_last_play boolean not null default true,
  add column if not exists show_timeouts boolean not null default true,
  add column if not exists show_win_prob boolean not null default true,
  add column if not exists show_network boolean not null default true,
  add column if not exists compact boolean not null default false,
  add column if not exists flash_swings boolean not null default true;
