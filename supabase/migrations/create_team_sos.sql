-- Migration: create_team_sos
-- Applied to Supabase project uyxnmtsntiaxqqmwsteq.
-- Backs the admin Strength of Schedule page's "Save to Site" button and
-- the Conference Previews "In-Conference SOS" column.

create table if not exists team_sos (
  id bigint generated always as identity primary key,
  season int not null,
  team text not null,
  updated_at timestamptz not null default now(),
  avg_opp_pr_total numeric,
  avg_opp_pr_conference numeric,
  sos_srs_total numeric,
  sos_srs_conference numeric,
  num_srs_runs int,
  best_win_pr_total numeric,
  best_win_pr_total_opp text,
  best_win_pr_conference numeric,
  best_win_pr_conference_opp text,
  best_loss_pr_total numeric,
  best_loss_pr_total_opp text,
  best_loss_pr_conference numeric,
  best_loss_pr_conference_opp text,
  worst_loss_pr_total numeric,
  worst_loss_pr_total_opp text,
  worst_loss_pr_conference numeric,
  worst_loss_pr_conference_opp text,
  unique (season, team)
);

alter table team_sos enable row level security;

create policy "Public read access to team_sos"
  on team_sos for select
  using (true);
