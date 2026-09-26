-- Migration: team_sos_blend_columns
-- Applied to Supabase project uyxnmtsntiaxqqmwsteq.
-- The admin SOS page's "Save to Site" now stores the normalized SOS Blend
-- score (per-division -10..+10 min-max, weighted) plus the two raw factors
-- that were never saved before, and the weights used.
alter table team_sos
  add column if not exists blend_score numeric,
  add column if not exists hypo_wins numeric,
  add column if not exists top7_avg_pr numeric,
  add column if not exists blend_weights jsonb;
