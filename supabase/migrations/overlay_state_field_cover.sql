-- Migration: overlay_state_field_cover (applied to project uyxnmtsntiaxqqmwsteq)
-- Toggles for the field-position bar and the live cover / over % on bets.
alter table overlay_state
  add column if not exists show_field boolean not null default true,
  add column if not exists show_cover_prob boolean not null default true;
