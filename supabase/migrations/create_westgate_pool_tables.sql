-- Westgate Supercontest: uploaded standings snapshots (from the contest's
-- own published leaderboard CSV) and per-season pool settings (entry
-- count/fee, used to scale last year's payout percentages onto this
-- year's smaller field).
create table if not exists westgate_standings (
  id bigserial primary key,
  season integer not null,
  place_rank integer not null,
  place_label text not null,
  alias text not null,
  record text,
  points numeric,
  cash_prize numeric,
  created_at timestamptz not null default now()
);
create index if not exists westgate_standings_season_idx on westgate_standings(season);

alter table westgate_standings enable row level security;
create policy "public read westgate_standings" on westgate_standings for select using (true);

create table if not exists westgate_pool_settings (
  season integer primary key,
  entries integer not null default 774,
  entry_fee numeric not null default 500
);

alter table westgate_pool_settings enable row level security;
create policy "public read westgate_pool_settings" on westgate_pool_settings for select using (true);
