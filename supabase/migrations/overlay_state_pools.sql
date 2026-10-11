-- Migration: overlay_state_pools (applied to project uyxnmtsntiaxqqmwsteq)
-- Pool picks on the score bug: which chips the bug shows (my bets, my pool
-- picks, or both), which pools to include (empty = all), and the pools full
-- screen (live record + every pick per pool).
alter table overlay_state
  add column if not exists pick_source text not null default 'bets' check (pick_source in ('bets', 'pools', 'both')),
  add column if not exists pool_keys text[] not null default '{}',
  add column if not exists pools_full boolean not null default false;
