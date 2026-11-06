-- Calcutta live room: attendees bid from their own devices.
--
-- calcutta_room_members  who claimed which attendee + their PIN (hashed).
--                        Server-only (no public read): written and checked
--                        by /api/pool-save (pool "calcutta-room").
-- calcutta_bid_requests  every bid / bow-out sent from the room, in order.
--                        The host's Stage reads these and decides what
--                        counts (min raise, max teams, …). Public read.
-- calcutta_live          compact live state the Stage publishes on every
--                        change; room pages subscribe to it. Public read.
create table if not exists calcutta_room_members (
  auction_id text not null,
  participant_id text not null,
  pin_salt text not null,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  claimed_at timestamptz not null default now(),
  primary key (auction_id, participant_id)
);
alter table calcutta_room_members enable row level security;

create table if not exists calcutta_bid_requests (
  id bigserial primary key,
  auction_id text not null,
  participant_id text not null,
  lot_id text,
  kind text not null default 'bid',
  amount numeric,
  created_at timestamptz not null default now()
);
create index if not exists calcutta_bid_requests_auction_idx on calcutta_bid_requests(auction_id, id);
alter table calcutta_bid_requests enable row level security;
create policy "public read calcutta_bid_requests" on calcutta_bid_requests for select using (true);

create table if not exists calcutta_live (
  auction_id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table calcutta_live enable row level security;
create policy "public read calcutta_live" on calcutta_live for select using (true);

alter publication supabase_realtime add table calcutta_live;
alter publication supabase_realtime add table calcutta_bid_requests;
