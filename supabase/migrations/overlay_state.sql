-- Migration: overlay_state (applied to project uyxnmtsntiaxqqmwsteq)
-- Settings for the TV score bug (/overlay), written from /overlay/control through
-- admin-bets-save's saveOverlayState action. One row per screen; the TV reads
-- id 'default' unless its URL says ?screen=<id>. Public read + Realtime so the
-- TV picks up a change within a second without polling.
create table if not exists overlay_state (
  id text primary key,
  game_ids text[] not null default '{}',
  visible boolean not null default true,
  layout text not null default 'corner' check (layout in ('corner', 'ticker')),
  position text not null default 'tr' check (position in ('tl', 'tr', 'bl', 'br')),
  scale numeric not null default 1,
  delay_seconds integer not null default 0,
  rotate_seconds integer not null default 12,
  show_lines boolean not null default true,
  show_bets boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table overlay_state enable row level security;
create policy "Public read access to overlay_state" on overlay_state for select using (true);
insert into overlay_state (id) values ('default') on conflict (id) do nothing;
alter publication supabase_realtime add table overlay_state;
