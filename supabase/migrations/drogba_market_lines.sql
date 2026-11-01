-- Migration: drogba_market_lines. Applied to project uyxnmtsntiaxqqmwsteq.
-- 1) Each logged DROGBA pick keeps the prediction-market lines seen when DROGBA was run (Kalshi, Novig, ProphetX,
--    Polymarket), as home spreads (negative = home favored): {"kalshi": -11.5, ...}. Refreshed on every pre-kickoff rerun.
alter table drogba_picks add column if not exists market_lines jsonb;

-- 2) DROGBA reads each game's current market lines from the bot's per-game summary. Read-only access to that one table
--    (implied margins per venue); orders, fills and positions stay private.
create policy "Public read access to bot_mkt_games" on bot_mkt_games for select using (true);
