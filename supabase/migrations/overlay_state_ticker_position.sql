-- Migration: overlay_state_ticker_position (applied to project uyxnmtsntiaxqqmwsteq)
-- Ticker layout can sit along the top or bottom edge of the TV.
alter table overlay_state add column if not exists ticker_position text not null default 'bottom' check (ticker_position in ('bottom', 'top'));
