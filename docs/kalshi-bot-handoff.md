# Kalshi market-making bot: handoff

Written 2026-10-20 at the end of a long build session, so a new chat can start this project cold. Everything below
"Verify" is a belief, not a checked fact: confirm it against current Kalshi docs before relying on it.

## 1. What we're building

An automated bot that **makes markets** on Kalshi college football spread (and possibly game-winner) markets:
it posts a bid below and an ask above our own fair price, earns the spread when both sides fill, and manages the
inventory it ends up holding. Fair price comes from this site's own model (YC power ratings), not from the market.

This is "way 3" of three ways an exchange pays. The other two are building blocks the bot also uses:

| Way | What it does | Where profit comes from |
|---|---|---|
| 1. Take and hold | Buy when the ask is below fair, hold to settlement | Model is right on average |
| 2. Take and flip | Buy below fair, sell when the bid reaches fair | Market moves toward our number before kickoff (closing line value) |
| **3. Make the market** | Rest a bid under fair and an ask over fair | The bid–ask spread, when both sides fill |

Market making is the goal. Ways 1 and 2 are how the bot gets out of (or deliberately keeps) inventory.

## 2. Decisions already made (by Chris)

From the planning round ("6a–e"):

- **Size:** 1 contract per trade.
- **Risk:** $5 stop loss (treat as the bot's total loss limit until raised).
- **Fair price:** YC power ratings (the site's model), not DROGBA, not the market.
- **Runs on:** GitHub Actions (scheduled), not Vercel.
- **Rollout:** paper trading → Kalshi demo → real money.
- Kalshi and DROGBA were "on hold" during the site build; Chris has now asked to start the Kalshi bot as its own chat.

## 3. Reading an order book (the ProphetX example that started this)

Prices are probabilities = cost of a contract that pays $1. Tennessee +3 vs South Carolina −3 on ProphetX:

- TENN +3 asks: 54.75% ($419), 54.95%, 55.56%… · SC −3 asks: 46.95% ($731), 47.17%, 47.39%…
- **Bid for one side = 100 − ask of the other side.** TENN +3: ask 54.75, bid 100 − 46.95 = **53.05**. Spread 1.7.
- 54.75 + 46.95 = 101.7 → the book's overround is 1.7 points (vs ~4.5 for −110/−110). De-vigged fair for TENN +3 ≈ 53.8%.
- 54.75% ≈ −121 American. A −110 bet is 52.38%.
- Outlier rows (77.27%, 75.31%) are stale orders: ignore when computing fair or depth.
- ProphetX shows whole-number lines (+3) that probably **push** (refund) on an exact margin of 3. Kalshi spread markets
  are "wins by more than X.5", so **no pushes** on Kalshi. Verify both.

## 4. Fair price for every line (the first thing to build)

The bot needs P(win), P(push), P(lose) for each alternate spread, not one number per game.

- **Mean:** our projected margin for the game = the YC spread. Use the same one Matchups uses: `computeRow` in
  `src/lib/matchupsCompute.ts` (week-accurate ratings, frozen lock if the game has one, no HFA at neutral sites).
- **Distribution:** a smooth normal undercounts key numbers (3, 7, 10, 14). Build an empirical college-football margin
  distribution around the projection (e.g. historical final margin minus closing spread, bucketed by spread size),
  or a normal with key-number bumps fit to history. The site already uses σ ≈ 15.7 as the game-outcome stddev
  (`DEFAULT_CUSTOM_PARAMS.sigmaDivisor` in `src/lib/betHistory.ts`).
- **Win % convention on the site:** Bill R method, `billRWinPctFromSpread(teamSpread)` in
  `src/lib/moneylineBetHistory.ts` (normal CDF of −spread/17). Fine for game-winner markets; spread markets need the
  key-number distribution above.
- **Why it matters (worked example, model SC by 1):** P(TENN covers +2.5) = P(SC margin ≤ 2) ≈ 53%, P(SC by exactly 3) ≈ 6%.
  TENN +3 at 54.75 with push refund: EV = 0.53 + 0.06×0.5475 − 0.5475 = **+$0.016/contract (~3%)**.
  TENN +2.5 at 53.5: EV = 0.53 − 0.535 = **−$0.005**. Same cover games; the +3 value is entirely the push.
- **HFA:** the site runs a flat 2.4 today. A per-team "Team HFA" blend exists (Teams → HFA, `hfa_settings` table,
  `teamHfa()` in `src/lib/hfaBacktest.ts`) but is not adopted; 2026 backtest says a flat ~3.0–3.8 fits better and no
  source clearly beats flat. Decide which HFA the bot uses and keep it consistent with what Matchups shows.

## 5. Market-making mechanics

For each market, every cycle:

1. **Fair:** p = our fair probability for YES (from section 4).
2. **Quote:** bid = p − h, ask = p + h, where half-spread h covers fees + adverse selection + a margin.
   Round to Kalshi's tick (1¢ on most markets; verify).
3. **Skew for inventory:** if long YES, lower both quotes (sell more readily, buy less); if short, raise them.
   Hard cap on net position per market (start: 1 contract) and per game (YES on one line + NO on an adjacent line
   is the same exposure; treat a game's lines as one position).
4. **Don't cross our own fair:** never bid above p or offer below p.
5. **Take when the book is wrong:** if the best ask < p − fees − min edge, buy it (way 1/2); if the best bid > p + fees + min edge, sell.
6. **Exit / flatten:** take profit when the bid reaches fair (way 2); stop out at the $5 loss limit;
   pull all quotes and decide hold-vs-flatten at T−30 min before kickoff.
7. **Re-quote** when our fair moves (new ratings, injury, weather) or the market moves past our quote.

**Risks specific to market making:**

- **Adverse selection / getting picked off:** fast traders hit stale quotes the moment news breaks (QB out). A bot
  polling every few minutes from GitHub Actions cannot react in seconds, so: quote only well before kickoff, keep
  size tiny, widen h, and cancel everything on any sign of news (big line move elsewhere, our fair jumping).
- **One-sided fills:** you end up holding inventory, not earning the spread. Inventory caps + skew handle this.
- **Fees** can eat the whole spread (section 7).
- **Thin books:** the ProphetX example had ~$419 at the top. Kalshi CFB spread books may be thinner.

**Honest expectation:** market making only beats the fees if our fair price is sharper than the market mid. Prove
that on paper first (section 9). If paper results show we're just getting picked off, fall back to ways 1–2.

## 6. Kalshi specifics (Verify all of this)

- **Existing code:** `api/kalshi-markets.ts` already proxies Kalshi's **public, unauthenticated** market data
  (`https://external-api.kalshi.com/trade-api/v2`), series `KXNCAAFGAME` (game winners, two markets per event) and
  futures series (`KXNCAAF`, `KXNCAAFCONF`, `KXNCAAFPLAYOFF`, `KXNCAAFWINS`, …). Client side:
  `src/lib/api/kalshi.ts`; used on the Prediction Markets admin page (`src/pages/PmAdminPanel.tsx`) and odds pages.
  Kalshi team names already map through `src/lib/teamNameMatch.ts`.
- **Spread markets:** find the CFB spread series ticker (likely a `KXNCAAFSPREAD`-style series; the existing
  `discoverKalshiNcaafSeries()` lists what exists). Each is probably "Team wins by more than X.5".
- **Trading API:** authenticated with an API key ID + RSA private key; each request signed
  (headers like `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE`). Endpoints for orders
  (create / cancel / amend), positions, fills, balance, and the order book (`/markets/{ticker}/orderbook`, which
  lists **YES bids and NO bids**; the YES ask = 100 − best NO bid, same mirror as ProphetX).
- **Demo environment:** separate base URL (demo-api) with fake money. Use it for the demo phase.
- **Fees:** roughly `ceil(0.07 × contracts × P × (1 − P))` dollars per trade for takers (max ~1.75¢/contract at 50¢);
  maker fees are lower or zero on some markets. Check the current schedule; it decides the minimum half-spread.
- **Order types:** limit orders with expiration; "post only"/maker-only flag if available (avoid accidentally taking).
- **Rate limits:** check the tier limits before choosing the polling interval.

## 7. Minimum spread math

Per round trip (buy at bid b, sell at ask a, 1 contract): profit = (a − b) − maker fee(b) − maker fee(a).
With taker-like fees near 50¢ (~1.75¢ each side) a 2¢ spread loses money; maker-fee-free it earns 2¢.
Start with h ≥ fees + 1–2¢ and tune from paper data.

## 8. Architecture (proposed)

- **Runner:** a Node/TypeScript script under e.g. `bot/` run by a GitHub Actions workflow on a schedule
  (every 5–15 min on game weeks; Actions' minimum is ~5 min and not guaranteed punctual). Not a Vercel function:
  `api/` is at the Hobby plan's **12-function cap** (adding a file there breaks deploys).
- **Secrets:** Kalshi API key ID + private key, Supabase service role key, in GitHub Actions secrets. Never in the repo.
- **Inputs from Supabase** (project `uyxnmtsntiaxqqmwsteq`): `games`, `betting_lines` (Vegas lines incl. the
  `market_median` provider row), `season_weekly_ratings` / `weekly_team_stats` (ratings), `game_projection_locks`
  (frozen pregame projections), `team_hfa` / `hfa_settings` if per-team HFA is adopted.
- **Outputs:** new tables, e.g.
  - `bot_quotes` (market, side, price, size, placed_at, cancelled_at, reason)
  - `bot_fills` (market, side, price, size, fee, filled_at, fair_at_fill)
  - `bot_positions` / daily P&L, and a `bot_state` row (kill switch, mode = paper|demo|live, limits).
  Fills should also land in `placed_bets` (book "Kalshi") so Bet History and the Overview grade them. Note
  `placed_bets` already has placeholder handling (book "placeholder"); keep bot rows distinct.
- **Paper mode:** same loop, reads the real order book, simulates fills (a resting quote "fills" if the market
  trades through it), writes to the same tables with mode = paper. No orders sent.
- **Admin page:** a Bot panel in the admin (Betting section): mode, kill switch, limits, open quotes, inventory,
  P&L, fills vs fair, and closing-line value. Reuse the existing admin shell and `/api/admin-bets-save` pattern for writes.
- **Shared code:** the fair-price engine (section 4) should live in `src/lib/` so the admin site can show "fair price
  for every alternate line" in Matchups even without the bot.

## 9. Rollout plan

1. **Fair-price engine** for every line, with key numbers. Validate on 2024–2026 history: calibration of P(cover)
   by line, and how often each exact margin occurs.
2. **CLV check:** using `betting_lines` history, measure whether our fair beats the closing line. If not, stop here:
   market making on a model that doesn't beat the close just donates to sharper traders.
3. **Paper bot** for 2–3 weeks: quotes, simulated fills, P&L, how often we'd have been picked off.
4. **Demo** environment with real API calls, fake money.
5. **Live** at 1 contract, $5 total stop, kill switch tested.
6. Only then consider more size or adding ProphetX (whole-number lines with pushes; API access unknown).

## 10. Open questions for Chris

- Spread markets only, or game winners (moneyline) too? Totals?
- Which HFA: flat 2.4 (site today), a raised flat (backtest says ~3), or the Team HFA blend?
- Run window: how many days before kickoff to quote, and the cut-off (T−30 min proposed)?
- Is $5 a total stop for the bot, per day, or per game? Per-market position cap?
- ProphetX in scope later? (Need to confirm it has a public trading API.)
- Where to be alerted (email, push) on fills, stop-outs, and errors?

## 11. Repo conventions the new chat should know

- Stack: React + Vite + TypeScript (`src/`), Vercel serverless functions (`api/`, max 12 files), Supabase.
- Admin writes go through `api/*` functions authenticated with the admin password or a passkey session
  (`isAdmin()` copy in each api file; api files can't share imports).
- Team names: always resolve through `matchTeamName` / `matchTeamRows` in `src/lib/teamNameMatch.ts`.
- Lines: `pickVegasLine` / `LINE_PROVIDER_ORDER` in `src/lib/linePick.ts` (market_median → consensus → books).
- Spreads are away-perspective in `computeRow` (negative = away favored); `betting_lines.spread` is home-relation.
- Workflow agreed with Chris: develop on the session branch, then open a PR and merge to main without asking,
  unless he asks to review first.
- Type-check: `npx tsc --noEmit -p .` (two known pre-existing errors: `oddsHistorical.ts(170)`,
  `BetHistoryPage.tsx(460)`); build: `npx vite build`.
