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
