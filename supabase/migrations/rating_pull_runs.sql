-- Migration: rating_pull_runs (applied to project uyxnmtsntiaxqqmwsteq)
-- One row per scheduled pull attempt (scripts/pull-ratings.ts, run hourly by the
-- GitHub Actions workflow). Pulls only ever write rating_pulls (the live
-- "current" ratings); this table is the run log shown on the Rating Systems page.
create table if not exists rating_pull_runs (
  id bigint generated always as identity primary key,
  source text not null,
  ran_at timestamptz not null default now(),
  trigger text not null default 'schedule',
  ok boolean not null,
  error text,
  fetched integer,
  matched integer,
  saved integer,
  changed integer,
  unchanged integer,
  new_teams integer,
  unmatched jsonb,
  label text,
  detail jsonb
);
create index if not exists rating_pull_runs_source_ran_at on rating_pull_runs (source, ran_at desc);
alter table rating_pull_runs enable row level security;
create policy "Public read access to rating_pull_runs" on rating_pull_runs for select using (true);
