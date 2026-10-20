# Kalshi market-making bot: handoff

Written 2026-10-20 at the end of a long build session, so a new chat can start this project cold.
**Kalshi facts in §3, §6 and §7 were checked on 2026-10-20** against docs.kalshi.com and the live public API
(marked ✅). Anything still marked "Verify" is unchecked.

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
  are "wins by more than X.5", so **no pushes** on Kalshi. ✅ Kalshi confirmed (every `floor_strike` is X.5).
  ProphetX push rules: still Verify.

## 4. Fair price for every line (✅ built: `bot/fairPrice/`, see §12)

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

## 6. Kalshi specifics (✅ checked 2026-10-20)

- **Existing code:** ✅ `api/kalshi-markets.ts` already proxies Kalshi's **public, unauthenticated** market data
  (`https://external-api.kalshi.com/trade-api/v2`), series `KXNCAAFGAME` (game winners, two markets per event) and
  futures series (`KXNCAAF`, `KXNCAAFCONF`, `KXNCAAFPLAYOFF`, `KXNCAAFWINS`, …). Client side:
  `src/lib/api/kalshi.ts`; used on the Prediction Markets admin page (`src/pages/PmAdminPanel.tsx`) and odds pages.
  Kalshi team names already map through `src/lib/teamNameMatch.ts`.
- **Spread markets:** ✅ series **`KXNCAAFSPREAD`** ("College Football Spread"). One event per game
  (`KXNCAAFSPREAD-26OCT24COLOOKST`) holding a ladder of markets for **both** teams, e.g. ticker
  `…-OKST8`, `floor_strike` 7.5, `strike_type` "greater", `yes_sub_title` "Oklahoma St. wins by over 7.5 points".
  The Colorado–Oklahoma St. event had 31 markets (OKST over 1.5 … 35.5, COLO over 1.5 … 10.5); most had zero
  volume, a few had 1k–7k contracts traded. Team names are Kalshi's short forms ("Oklahoma St.") → resolve with
  `matchTeamName`. `no_sub_title` repeats the YES text; don't use it. Totals: `KXNCAAFTOTAL` exists.
- **Public market data:** ✅ no auth needed for `GET /markets`, `/series/{t}`, `/markets/{t}/orderbook`.
  Prices are dollar strings with 4 decimals (`"0.6200"`), sizes are fixed-point strings (`"1261.43"`; fractional
  contracts exist). Market objects carry `yes_bid_dollars`, `yes_ask_dollars`, `*_size_fp`, `volume_fp`,
  `open_interest_fp`, `close_time`, `occurrence_datetime` (kickoff), `price_ranges` / `price_level_structure`.
- **Base URLs:** ✅ production `https://external-api.kalshi.com/trade-api/v2` (recommended; `api.elections.kalshi.com`
  also works), demo `https://external-api.demo.kalshi.co/trade-api/v2` (`demo-api.kalshi.co` also works).
  WebSockets: `wss://external-api-ws.kalshi.com/trade-api/ws/v2` / `wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2`.
- **Auth / signing:** ✅ headers `KALSHI-ACCESS-KEY` (key ID), `KALSHI-ACCESS-TIMESTAMP` (**milliseconds**),
  `KALSHI-ACCESS-SIGNATURE` (base64). Signed string = `timestamp + METHOD + path`, path **without the query string**
  (`/trade-api/v2/portfolio/orders?limit=5` signs as `/trade-api/v2/portfolio/orders`). Key types: RSA-2048 →
  RSA-PSS, SHA-256, MGF1-SHA-256, salt length 32; or **Ed25519 (Kalshi's recommendation)**. Kalshi picks the
  algorithm from the registered key, so sign with whatever type the key is.
- **Demo environment:** ✅ fake money, **separate account and separate API keys** (demo keys don't work on prod).
- **Order book:** ✅ `GET /markets/{ticker}/orderbook?depth=N` → `{"orderbook_fp":{"yes_dollars":[[price,size],…],
  "no_dollars":[…]}}`. **Bids only**, both sides. Live response is sorted **ascending (best bid last)**; the docs only
  say "best to worst", so take the max rather than trusting order. YES ask = 1 − best NO bid.
  Live sample: YES bids …0.62, NO bids …0.37 → YES 0.62 / 0.63.
- **Orders:** ✅ use **`POST /portfolio/events/orders`** (Create Order V2). The old `/portfolio/orders` is slated for
  deprecation ("no earlier than May 6, 2026"). V2 body: `ticker`, `side` (`bid` = buy YES, `ask` = sell YES; YES leg
  only, so "buy NO at 0.37" = sell YES at 0.63), `count` and `price` as strings (`"1"`, `"0.56"`),
  `time_in_force` (`good_till_canceled` | `immediate_or_cancel` | `fill_or_kill`), optional `expiration_time`
  (unix seconds, with GTC), `post_only`, `reduce_only` (IOC only), `client_order_id`,
  `self_trade_prevention_type` (**required**: `taker_at_cross` | `maker`), `cancel_order_on_pause`.
  Cancel / amend have V2 endpoints too. Portfolio: `GET /portfolio/positions`, `/portfolio/fills`, `/portfolio/balance`.
- **Tick:** ✅ CFB spread markets are `price_level_structure: "linear_cent"`, `price_ranges` step 0.01 over 0–1.
  Read the field per market; some other markets use finer ticks.
- **Fees:** ✅ the CFB series (`KXNCAAFSPREAD`, `KXNCAAFGAME`, `KXNCAAFTOTAL`) are `fee_type:
  "quadratic_with_maker_fees"`, `fee_multiplier: 1` (from `GET /series/{ticker}`). Fee = rate × contracts × P × (1 − P)
  × multiplier, **taker rate 0.07** (1.75¢ at 50¢), **maker rate 0.0175** (≈0.44¢ at 50¢), per Kalshi's fee schedule.
  Rounding (docs "fee rounding"): computed per fill, rounded up to 6 decimals; non-direct members' balances move in
  whole cents and the rounding overpayment is tracked per order and rebated, so long-run cost ≈ the formula.
  Implemented as `kalshiFee()` in `bot/fairPrice/kalshi.ts`. Watch `GET /series/fee_changes` for schedule changes.
- **Rate limits:** ✅ token buckets, most requests cost 10 tokens. Basic tier: 200 read / 100 write tokens per second
  (≈20 reads/s, 10 writes/s). Writes = order create / amend / cancel, order groups, RFQ. `GET /portfolio/balance`
  has its own bucket (1/s on Basic). Not a constraint for a bot polling every few minutes.

## 7. Minimum spread math

Per round trip (buy at bid b, sell at ask a, 1 contract): profit = (a − b) − maker fee(b) − maker fee(a).
✅ CFB spread markets charge **maker** fees: ≈0.44¢ per side at 50¢, so a 2¢ round trip nets ≈1.1¢; a 1¢ spread
nets ≈0.1¢ (basically nothing). Taking costs 1.75¢ at 50¢, so a "take when the book is wrong" trade needs ≥2¢ of edge
just to break even. Start with h ≥ 1.5–2¢ and tune from paper data.

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
- **Shared code:** the fair-price engine lives in `bot/fairPrice/` (pure TypeScript, imports `computeRow` from
  `src/lib`). If the admin site wants "fair price for every alternate line" in Matchups, import it from there
  (or move it to `src/lib/` then).

## 9. Rollout plan

1. ✅ **Fair-price engine** for every line, with key numbers (§12). Exact-margin frequencies fit and validated on a
   held-out season. Still to do: calibration of P(cover) when centered on **our** projection instead of the market.
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

## 12. Fair-price engine (built 2026-10-20)

Code: `bot/fairPrice/` (tests: `npm test`). No trading code yet.

- `marginDistribution.ts`: P(home margin = m) for every whole m. A normal (σ = `DEFAULT_SIGMA`) cut into whole-point
  bins, 0 removed (CFB has overtime, so no ties), then each |m| multiplied by a key-number weight and re-centered so
  the mean equals the projection exactly. `fitKeyWeights()` fits the weights by iterative proportional fitting with a
  20-game prior toward 1.
- `keyWeights.fitted.ts`: **generated** by `bot/scripts/fitKeyWeights.ts`, centered on the closing market spread
  (market_median → consensus → any book). Fit on 3,730 FBS-vs-FBS games, 2021–2025: **σ = 15.31**. Weights:
  3 → 2.7×, 7 → 2.4×, 10 → 1.4×, 14 → 1.4×, 17 → 1.4×, 21 → 1.7×, 24 → 1.4×, 28 → 1.8×. Dead numbers sit
  well below 1 (9 → 0.4, 16 → 0.35, 5 → 0.65). Held-out 2026 (388 games): log-likelihood per game improves from
  −4.076 (plain normal) to −3.933. Refit each offseason:
  `SUPABASE_URL=… SUPABASE_ANON_KEY=… npx tsx bot/scripts/fitKeyWeights.ts 2021 2025 2026`.
- `lines.ts`: `spreadOutcome(pmf, side, line)` → {win, push, lose} for any line (pushes only on whole numbers),
  `kalshiSpreadYesProb(pmf, side, floorStrike)`, `winProb`, `evPerContract` (push refunds the stake), `fairPrice`
  (break-even price), `americanFromProb`.
- `kalshi.ts`: `kalshiFee()`, `parseKalshiSpreadTitle()`, `bestYesQuotes()` for the bids-only book.
- `projection.ts`: `projectedHomeMargin(game, liveByTeam, {hfaMode, lock})` calls **`computeRow`** (same numbers as
  Matchups; default `hfaMode: "team"` like Matchups) and returns its `projAwaySpread`, which is numerically the home
  margin (ratings are lower = better). `gameMarginPmf()` = the pmf around it.
- Sanity check against the live Colorado @ Oklahoma St. ladder (pmf centered on the market's ~OKST −12): every rung
  was within ~2¢ of Kalshi's mid, with the same drops at 3 and 7.

**Next:** the CLV check (§9 step 2). Center the pmf on our projection for 2024–2026 games, price the closing
line and the alternate lines, and measure whether we beat the close. σ may need to be wider around our projection
than around the market (our number is noisier); fit it from that same data.
