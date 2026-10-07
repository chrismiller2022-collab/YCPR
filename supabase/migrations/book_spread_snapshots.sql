-- Migration: book_spread_snapshots (applied to project uyxnmtsntiaxqqmwsteq).
-- One row per (game, book, snapshot time) of a sportsbook's home spread, pulled from The Odds API
-- (historical snapshots or a live pull). A book's "open" for a game is its EARLIEST snapshot with a line.
create table if not exists book_spread_snapshots (
  game_id text not null, book text not null, snapshot_at timestamptz not null,
  season int not null, week int not null,
  home_spread numeric not null, home_price int, away_price int,
  is_historical boolean not null default true,
  primary key (game_id, book, snapshot_at)
);
create index if not exists book_spread_snapshots_season_week on book_spread_snapshots (season, week);
alter table book_spread_snapshots enable row level security;
create policy "Public read access to book_spread_snapshots" on book_spread_snapshots for select using (true);

-- One row per Odds API call made, even when it returned nothing, so a re-run never re-spends credits on a snapshot already pulled.
create table if not exists book_snapshot_pulls (
  book text not null, target_at timestamptz not null, snapshot_at timestamptz,
  season int, week int, events int, matched int, saved int, credits_last text, credits_remaining text,
  pulled_at timestamptz not null default now(), primary key (book, target_at)
);
alter table book_snapshot_pulls enable row level security;
create policy "Public read access to book_snapshot_pulls" on book_snapshot_pulls for select using (true);
