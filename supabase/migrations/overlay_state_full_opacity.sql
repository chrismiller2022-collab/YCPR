-- Migration: overlay_state_full_opacity (applied to project uyxnmtsntiaxqqmwsteq)
-- Background opacity of the full-scoreboard panel (text stays solid), set
-- by a slider on /overlay/control. 1 = solid, 0.3 = mostly see-through.
alter table overlay_state add column if not exists full_opacity numeric not null default 1 check (full_opacity >= 0.3 and full_opacity <= 1);
