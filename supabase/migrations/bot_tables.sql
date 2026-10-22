-- Kalshi ladder bot (paper → demo → live). See docs/kalshi-bot-handoff.md §14.
-- RLS is ON with NO policies: only the service-role key (GitHub Actions
-- runner, ycpr-bot's server functions) can read or write. Never public.

create table if not exists bot_state (
  id int primary key default 1 check (id = 1),
  mode text not null default 'paper' check (mode in ('paper', 'demo', 'live')),
  kill_switch boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into bot_state (id) values (1) on conflict (id) do nothing;
alter table bot_state enable row level security;

create table if not exists bot_watchlist (
  id bigint generated always as identity primary key,
  game_id text not null,
  season int not null,
  week int,
  home_team text not null,
  away_team text not null,
  kickoff timestamptz,
  pick text not null check (pick in ('home', 'away')),
  -- Our number as a home margin (home − away). "Team B (home) by 4.3" = 4.3; "away by 3" = −3.
  my_home_margin numeric not null,
  max_worst_case_loss numeric not null default 5,
  per_rung_cap int not null default 1,
  order_size int not null default 1,
  pro_edge numeric not null default 0.02,
  anti_edge numeric not null default 0.04,
  take_edge numeric not null default 0.03,
  edge_step numeric not null default 0.01,
  profit_target numeric,
  stop_minutes_before int not null default 30,
  kalshi_event text,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (game_id)
);
alter table bot_watchlist enable row level security;

create table if not exists bot_orders (
  id bigint generated always as identity primary key,
  mode text not null,
  game_id text not null,
  ticker text not null,
  action text not null check (action in ('buy', 'sell')),
  price numeric not null,
  count int not null,
  kind text not null check (kind in ('quote', 'take')),
  direction text not null check (direction in ('pro', 'anti')),
  fair numeric,
  reason text,
  status text not null default 'resting' check (status in ('resting', 'filled', 'cancelled')),
  exchange_order_id text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists bot_orders_open on bot_orders (mode, status, game_id);
alter table bot_orders enable row level security;

create table if not exists bot_fills (
  id bigint generated always as identity primary key,
  mode text not null,
  order_id bigint references bot_orders (id),
  game_id text not null,
  ticker text not null,
  side text not null check (side in ('home', 'away')),
  strike numeric not null,
  action text not null check (action in ('buy', 'sell')),
  price numeric not null,
  count int not null,
  fee numeric not null,
  fair_at_fill numeric,
  mid_at_fill numeric,
  filled_at timestamptz not null default now(),
  -- Filled in after the fact for evaluation:
  close_mid numeric,
  result smallint -- 1 = market settled YES, 0 = NO
);
create index if not exists bot_fills_game on bot_fills (mode, game_id);
alter table bot_fills enable row level security;

-- Ladder state per game per cycle (only rungs whose quote or fair changed).
create table if not exists bot_snapshots (
  id bigint generated always as identity primary key,
  taken_at timestamptz not null default now(),
  game_id text not null,
  ticker text not null,
  bid numeric,
  ask numeric,
  fair numeric
);
create index if not exists bot_snapshots_game on bot_snapshots (game_id, ticker, taken_at desc);
alter table bot_snapshots enable row level security;

create table if not exists bot_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text,
  games int,
  orders_placed int,
  orders_cancelled int,
  fills int,
  summary jsonb,
  error text
);
alter table bot_runs enable row level security;

-- 2026-10-21: the bot reads YCPR projections itself; a typed line is an optional override.
alter table bot_watchlist alter column my_home_margin drop not null;
alter table bot_watchlist add column if not exists ycpr_home_margin numeric;
alter table bot_watchlist add column if not exists ycpr_updated_at timestamptz;
-- How much the fair price trusts our number vs the market: 1 = our number only.
alter table bot_watchlist add column if not exists ycpr_weight numeric not null default 1 check (ycpr_weight >= 0 and ycpr_weight <= 1);

-- 2026-10-21: trust default for all games; per-game ycpr_weight null = follow it.
alter table bot_state add column if not exists default_ycpr_weight numeric not null default 1 check (default_ycpr_weight >= 0 and default_ycpr_weight <= 1);
alter table bot_watchlist alter column ycpr_weight drop not null;
alter table bot_watchlist alter column ycpr_weight drop default;

-- 2026-10-21: Kalshi-implied home margin (margin distribution fit to the live ladder), refreshed each cycle.
alter table bot_watchlist add column if not exists kalshi_home_margin numeric;
alter table bot_watchlist add column if not exists kalshi_updated_at timestamptz;

-- 2026-10-21: Strategy lab. Parallel paper strategies run on every watchlist game against the same
-- Kalshi books, each with its own orders/fills. strategy_id null = the main Board.
create table if not exists bot_strategies (
  id bigint generated always as identity primary key,
  name text not null unique,
  enabled boolean not null default true,
  pro_edge numeric not null default 0.02,
  anti_edge numeric not null default 0.04,
  take_edge numeric not null default 0.03,
  edge_step numeric not null default 0.01,
  max_worst_case_loss numeric not null default 10,
  per_rung_cap int not null default 1,
  ycpr_weight numeric check (ycpr_weight is null or (ycpr_weight >= 0 and ycpr_weight <= 1)),
  stop_minutes_before int not null default 30,
  notes text,
  created_at timestamptz not null default now()
);
alter table bot_strategies enable row level security;
alter table bot_orders add column if not exists strategy_id bigint references bot_strategies (id);
alter table bot_fills add column if not exists strategy_id bigint references bot_strategies (id);
create index if not exists bot_orders_strategy on bot_orders (strategy_id, status, game_id);
create index if not exists bot_fills_strategy on bot_fills (strategy_id, game_id);
insert into bot_strategies (name, pro_edge, anti_edge, take_edge, edge_step, notes) values
  ('Aggressive', 0.01, 0.03, 0.03, 0.005, 'Quotes near the touch and takes anything 3¢+ under fair'),
  ('Default', 0.02, 0.04, 0.03, 0.01, 'Same edges as the Board defaults'),
  ('Patient', 0.02, 0.03, 0.08, 0.01, 'Rarely takes; rests quotes and sells back sooner')
on conflict (name) do nothing;

-- 2026-10-21: Multi-venue paper trading (Kalshi, Novig, ProphetX). Existing rows are Kalshi.
alter table bot_orders add column if not exists venue text not null default 'kalshi';
alter table bot_fills add column if not exists venue text not null default 'kalshi';
alter table bot_snapshots add column if not exists venue text not null default 'kalshi';
alter table bot_watchlist add column if not exists venues text[] not null default '{kalshi,novig,prophetx}';
alter table bot_watchlist add column if not exists venue_events jsonb not null default '{}'::jsonb;
alter table bot_watchlist add column if not exists venue_margins jsonb not null default '{}'::jsonb;
create index if not exists bot_orders_venue on bot_orders (venue, status, game_id);
create index if not exists bot_fills_venue on bot_fills (venue, game_id);

-- Snapshot rungs carry side/strike so Novig/ProphetX tickers (which don't encode the number) can be labeled.
alter table bot_snapshots add column if not exists side text, add column if not exists strike numeric;

-- Market recorder: every FBS game's ladders and trades on every venue, for Hypotheticals replay.
create table if not exists bot_mkt_games (
  game_id text primary key,
  season int, week int, kickoff timestamptz,
  home_team text not null, away_team text not null,
  ycpr_home_margin numeric, book_home_margin numeric,
  venue_events jsonb not null default '{}', venue_margins jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists bot_mkt_snaps (
  id bigserial primary key,
  game_id text not null, venue text not null, ticker text not null,
  side text not null, strike numeric not null, bid numeric, ask numeric,
  taken_at timestamptz not null default now()
);
create index if not exists bot_mkt_snaps_game on bot_mkt_snaps (game_id, venue, taken_at);
create table if not exists bot_mkt_trades (
  id bigserial primary key,
  game_id text not null, venue text not null, ticker text not null,
  t timestamptz not null, yes_price numeric not null
);
create index if not exists bot_mkt_trades_game on bot_mkt_trades (game_id, venue, t);
create table if not exists bot_mkt_last (
  venue text not null, ticker text not null,
  bid numeric, ask numeric, volume numeric, last_trade_t bigint,
  primary key (venue, ticker)
);
alter table bot_mkt_games enable row level security;
alter table bot_mkt_snaps enable row level security;
alter table bot_mkt_trades enable row level security;
alter table bot_mkt_last enable row level security;

-- Hypotheticals: incremental replay state + summary per game × method × venue set.
create table if not exists bot_hypo_results (
  game_id text not null,
  method text not null,
  venues text not null,
  hash text not null,
  state jsonb not null,
  summary jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, method, venues)
);
-- Implied home margin per venue after each recorder step (shared by every replay, incl. custom what-ifs).
create table if not exists bot_mkt_implied (
  game_id text not null,
  venue text not null,
  t timestamptz not null,
  margin numeric,
  primary key (game_id, venue, t)
);
-- Shared per-game replay position: the books after the last processed step (method-independent).
create table if not exists bot_hypo_games (
  game_id text primary key,
  t bigint not null default 0,
  books jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table bot_hypo_results enable row level security;
alter table bot_mkt_implied enable row level security;
alter table bot_hypo_games enable row level security;

-- 2026-10-22: which strategy filled a game's settings (a label: values are copied, later strategy edits don't follow).
alter table bot_watchlist add column if not exists strategy_preset bigint references bot_strategies (id) on delete set null;
