-- Migration: bot_risk_settings. Applied to project uyxnmtsntiaxqqmwsteq.
-- The dashboard's Risk card: sizes as shares of the paper bankroll. game_pct is the "Normal" per-game size on Add games
-- (team_cap / conf_cap are written from it), open_pct writes portfolio_cap, and daily_loss_pct is the daily loss stop.
alter table bot_state
  add column if not exists game_pct numeric default 0.01,
  add column if not exists open_pct numeric default 0.10,
  add column if not exists daily_loss_pct numeric default 0.05;

-- Settled paper P&L (after fees) of every book on the games that kicked off on an Eastern date: what the daily loss stop
-- checks. Only graded fills count. Service role only.
create or replace function bot_daily_pnl(p_day date)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(
    (case
      when f.action = 'buy' then (case when f.result = 1 then 1 - f.price else -f.price end)
      else (case when f.result = 1 then -(1 - f.price) else f.price end)
    end) * f.count - coalesce(f.fee, 0)
  ), 0)
  from bot_fills f
  join games g on g.id::text = f.game_id
  where f.mode = 'paper' and f.result is not null
    and (g.start_date at time zone 'America/New_York')::date = p_day;
$$;
revoke execute on function bot_daily_pnl(date) from public, anon, authenticated;
grant execute on function bot_daily_pnl(date) to service_role;
