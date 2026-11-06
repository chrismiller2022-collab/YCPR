-- Calcutta auctions (Admin → Pools → Calcutta). One row per auction; the
-- whole auction — settings, attendees, field, lots, every bid (undone bids
-- kept, flagged voided), ownership splits, results — lives in `doc`.
-- Written only through /api/pool-save (service role). Public read so a
-- future read-only phone view of the Stage can load it; nothing from the
-- private model/Desk side is ever stored here.
create table if not exists calcutta_auctions (
  id text primary key,
  name text not null,
  format text not null,
  status text not null default 'setup',
  doc jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calcutta_auctions_updated_idx on calcutta_auctions(updated_at desc);

alter table calcutta_auctions enable row level security;
create policy "public read calcutta_auctions" on calcutta_auctions for select using (true);
