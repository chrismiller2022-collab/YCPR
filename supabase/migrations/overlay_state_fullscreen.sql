-- Migration: overlay_state_fullscreen (applied to project uyxnmtsntiaxqqmwsteq)
-- "Full scoreboard" toggle on /overlay/control: when on, the TV shows every
-- selected game in an opaque grid covering ~90% of the screen; off returns
-- to the corner bug / ticker.
alter table overlay_state add column if not exists fullscreen boolean not null default false;
