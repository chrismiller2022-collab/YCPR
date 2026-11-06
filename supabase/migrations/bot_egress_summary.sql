-- Migration: bot_egress_summary. Applied to project uyxnmtsntiaxqqmwsteq.
-- Adds up the egress the bot's jobs save in bot_runs.summary.egress (see bot/runner/io.ts) for a range of Eastern
-- dates, so the daily usage report gets a few hundred bytes back instead of downloading every run's summary.
create or replace function bot_egress_summary(p_from date, p_to date)
returns jsonb language sql stable set search_path = public as $$
  with r as (
    select mode, summary from bot_runs
    where (started_at at time zone 'America/New_York')::date between p_from and p_to and summary ? 'egress'
  ),
  jobs as (
    select mode as job, count(*) as runs, sum((summary->'egress'->>'bytes')::bigint) as bytes,
           sum((summary->'egress'->>'requests')::bigint) as requests
    from r group by mode
  ),
  tabs as (
    select t.key as tbl, sum((t.value->>'bytes')::bigint) as bytes
    from r, jsonb_each(r.summary->'egress'->'byTable') t group by t.key order by 2 desc limit 5
  )
  select jsonb_build_object(
    'bytes', coalesce((select sum(bytes) from jobs), 0),
    'jobs', coalesce((select jsonb_agg(jobs order by bytes desc) from jobs), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(tabs order by bytes desc) from tabs), '[]'::jsonb)
  );
$$;
-- Only the bot (service role) calls it.
revoke execute on function bot_egress_summary(date, date) from public, anon, authenticated;
grant execute on function bot_egress_summary(date, date) to service_role;
