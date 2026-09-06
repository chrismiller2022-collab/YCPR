-- Flat cost/winnings line items for pools that don't otherwise track
-- their own finances (Brit already does, via brit_entries/
-- brit_season_bonus — this table is for everything else: Peay's one-time
-- buy-in, Splash Survivor's 3 entries, Kelly Splash pickem, and the
-- Claude/data subscription costs, plus a hypothetical Westgate line used
-- only on the Balance Sheet's "Hypothetical" tab).
create table if not exists pool_ledger_entries (
  id bigserial primary key,
  season integer not null,
  pool_key text not null,
  label text not null,
  cost numeric not null default 0,
  winnings numeric not null default 0,
  is_hypothetical boolean not null default false,
  note text,
  unique (season, pool_key, is_hypothetical)
);

alter table pool_ledger_entries enable row level security;
create policy "public read pool_ledger_entries" on pool_ledger_entries for select using (true);
