-- Migration: admin_passkeys + admin_passkey_challenges (applied to project uyxnmtsntiaxqqmwsteq)
-- Passkeys (WebAuthn) as an extra way into the admin site, one row per device. Only the PUBLIC half of
-- each key is stored. Written and read only by api/admin-save.ts through the service role: RLS is on with
-- no policies, so the public anon key can't see any of it.
create table if not exists admin_passkeys (
  id text primary key,                 -- credential id (base64url)
  public_key text not null,            -- COSE public key (base64url)
  counter bigint not null default 0,
  transports text[],
  name text not null,
  rp_id text not null,                 -- the web address it was created on; a passkey only works there
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table admin_passkeys enable row level security;

-- One-time challenges for the register / sign-in handshakes (deleted when used, expire after 5 minutes).
create table if not exists admin_passkey_challenges (
  challenge text primary key,
  kind text not null check (kind in ('register', 'login')),
  expires_at timestamptz not null
);
alter table admin_passkey_challenges enable row level security;
