-- Placed Bets originally only logged what Admin Matchups' Bet checkbox
-- captures (book/type/side/line/price) — no stake, no outcome, so there
-- was no way to compute win/loss record or ROI, only Closing Line Value.
-- Needed to support bets placed outside the site too (Novig, Kalshi,
-- Bovada, BetOnline via CSV import), which always have a real stake and
-- (once settled) a real result.
alter table placed_bets
  add column if not exists stake numeric,
  add column if not exists to_win numeric,
  add column if not exists result text check (result in ('win','loss','push','pending')) default 'pending';
