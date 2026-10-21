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
  `open_interest_fp`, `close_time`, `occurrence_datetime` (≈ expected game **end**, not kickoff; use `games.start_date` for kickoff), `price_ranges` / `price_level_structure`.
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

## 13. Backtest results, 2026 weeks 2–7 (run 2026-10-20)

Full tables: `docs/kalshi-backtest-2026.md` (regenerate with `bot/backtest/run.ts`). 316 games whose YCPR projection
was frozen before kickoff (week 1 locks were written after the games and are excluded), 9,479 Kalshi spread rungs.

- **Kalshi's price is a better forecast than raw YCPR.** Log loss per rung: YCPR 0.513, Kalshi last pregame mid 0.500
  (gap −13.4 ×1000, 90% CI [−22.7, −4.0]); 24h out it is still −10.7. The distribution *shape* is fine: centered on the
  sportsbook close it scores 0.503, about the same as Kalshi. The gap is the projection itself. Widening σ makes it worse.
- **At the close, YCPR adds no information on top of Kalshi.** Logistic blend weight on YCPR −0.04 (CI [−0.45, 0.43]);
  leave-one-week-out the blend does worse than Kalshi alone.
- **The filters did not hold up in this sample.** 47 of 316 games flagged by Filtered/WFB/NWFB went 23–24 ATS vs the
  close (48.9%). Taking only in the filter's direction lost; the filtered bet placed on Kalshi 30 min before kickoff:
  −4.3¢/contract. 47 games is small: this does not disprove the filters' long-run record, but 2026 doesn't confirm it.
- **One lead worth testing further:** take the single most-mispriced rung per game vs YCPR, mostly at Kalshi market open
  (268 of 313 entries were >72h before kickoff): +4 to +5¢/contract after fees with positive CLV (+2 to +3¢), but the 90%
  intervals only just clear zero and it is the best of many cuts. Benchmarks: the same rule with the sportsbook *opening*
  line (no hindsight) ≈ 0 (−1.6 to +1.7¢); with the *closing* line (hindsight) +7 to +8¢. So Kalshi does lag the books
  early in the week, and YCPR may carry information the market only absorbs during the week. Taking every rung loses.
- **Implication for market making:** quoting around raw YCPR fair would be quoting around a worse price than the market
  mid, which is the definition of getting picked off. Any quoting should center on the market and use YCPR, at most, as a
  small early-week skew, and only if the lead above survives a second season.

**Next:** (1) rebuild 2025 pregame projections from weekly ratings (only if those ratings were stored before each week,
otherwise they leak results) and rerun, to test the early-week lead and the filters on a second season; (2) start the
read-only snapshot logger so Kalshi opening prices vs live YCPR are captured going forward.

### 13b. Bucket bets and early-week entry (added 2026-10-20)

- **Bet History data bug:** 300 of the 770 graded 2025 rows in `src/data/betHistory.data.ts` store the spread *and* the
  projection with the wrong sign (checked against `betting_lines` and final scores; 2024 is clean). That flips the
  recorded pick and the favorite/underdog label on those games. Corrected 2024–2026 ATS (closing line): every pick
  52.2%, underdog picks 53.3%, favorite picks 50.9%, underdogs +10 and up 55.1% (57 / 53 / 56% by season),
  underdog +2.5/+3 with 3+ off 33–21. Conclusions drawn from the uncorrected 2025 rows are overstated.
- **Kalshi timing:** CFB spread markets open ~6.5 days before kickoff (Sunday), but the first quotes are placeholders
  (median 41¢ wide). Median bid–ask: ~5¢ more than 4 days out, 2¢ from 2–4 days, 1¢ on game day.
- **Buckets on Kalshi 2026** (§3e of the report; pick from the opening line, rung nearest it, first tradeable quote, median
  144h out): underdog picks +6.5¢/contract (90% CI [0.4, 12.2]) but CLV ≈ 0; favorite picks ≈ 0 with CLV −1.5¢;
  underdogs +10 +9¢ (CI touches 0). Entering early vs 30 min before kickoff made almost no difference: on average the
  Kalshi line does not drift toward YCPR during the week, and it drifts against our favorite picks.

## 14. Trading approach Chris signed off on (2026-10-20)

Lean toward a side Chris picked, quote a ladder of numbers all week, and let the other side's fills pay.

**Worked example** (Team B at home; Chris has B −4.3, market B −6.5; fair from `bot/fairPrice`, σ 15.31):

| Team A | My fair | Market fair | Edge |
|---|---|---|---|
| +3.5 | 50.4¢ | 44.8¢ | 5.6¢ |
| +4.5 | 52.9¢ | 47.2¢ | 5.7¢ |
| +5.5 | 54.4¢ | 48.8¢ | 5.7¢ |
| +6.5 | 56.8¢ | 51.1¢ | 5.7¢ |
| +7.5 | 62.9¢ | 57.3¢ | 5.6¢ |
| +10.5 | 69.2¢ | 63.9¢ | 5.3¢ |

Rules that follow from it:
1. **"Team B −X" is the other side of "Team A +X"**, the same contract. Net exposure per number = A contracts − B contracts.
   Bid–ask profit = buy A +X at our bid, later sell it at our ask (= take B −X); the pair is locked whatever happens.
2. **The whole ladder is one bet on the final margin.** Track P&L for every possible final margin; cap the worst case per
   game, not contracts per number.
3. **Edge is about equal on every number** when our number is a shift of the market's (~5.5¢ here). +7.5 costs ~6¢ more
   than +6.5 because B wins by exactly 7 ~6% of the time. Prefer numbers where the market's price step between neighbors
   is wrong vs our fair step (key-number mispricing), and numbers with liquidity.
4. **Middles are welcome:** long A +7.5 and short A +4.5 (= B −4.5) wins both on B by 5–7 (~10% here, 7 inside).

Per-game parameters:
- **Lean:** target exposure on the picked side, as a worst-case dollar loss.
- **Picked-side bids:** tight (fair − small edge) so they fill. **Picked-side asks:** wide, only sell back when paid well.
- **Caps:** per number and per game (worst case across margins).
- **Stops:** stop adding when the edge is gone (and sell back if the bid exceeds fair + fees); when the line moves
  against us, add only against the blended fair (YCPR leaning toward market as kickoff nears), only if sportsbooks
  didn't move the same way, with more edge required per extra contract and a hard cap; stop the game once realized +
  open P&L hits its profit target.
- **Fair price:** blend of Kalshi-implied (margin distribution fit to the Kalshi ladder, weighted by depth/tightness),
  sportsbook lines, and YCPR as a tilt where history supports it (underdogs, +10 dogs, early week).
- **Venues:** Kalshi (API, liquidity, exit/hedge); ProphetX if trading API access is granted (whole-number lines,
  pushes, ~2% of net winnings); Novig manual unless API access is granted.
- **Expectations:** at 54% on ~50 selected games, ≈3–4.5¢ per contract per game from the directional edge; bid–ask
  adds ≈0.3–1¢ per round trip. Over 50 games a true 54% bettor still finishes down ~30% of the time.

## 15. Paper bot + dashboard (built 2026-10-21)

- **Tables** (YCPR Supabase, migration `supabase/migrations/bot_tables.sql`): `bot_state` (mode, kill switch),
  `bot_watchlist` (game, pick, Chris's number as a home margin, caps/edges/target), `bot_orders`, `bot_fills`
  (with `close_mid` and `result` filled in after kickoff for CLV and P&L), `bot_snapshots` (rungs whose quote or fair
  changed), `bot_runs`. RLS on, **no policies**: the publishable key can't read or write them (verified).
- **Runner** `bot/runner/paper.ts`, scheduled by `.github/workflows/bot-paper.yml` every ~10 min (repo is public, so
  Actions minutes are free; logs are public too, so the runner logs counts only). Per watched game: match the open
  Kalshi event, simulate fills on resting quotes (only if the market traded *through* our price or the book moved
  through it; `bot/runner/paperFills.ts`), stop quoting `stop_minutes_before` kickoff, blend fair (Kalshi-implied +
  sportsbook + our number fading to kickoff), run `ladderOrders`, keep identical resting quotes, cancel the rest, place
  new ones; after kickoff record results and closing mids. Only paper mode is implemented; demo/live do nothing yet.
- **Engine change:** the loss budget is spent on rungs nearest 50¢ first, not the tails.
- **Dashboard** `hub/` = the **ycpr-bot** Vercel project (Root Directory `hub`): `hub/api/data.js` and
  `hub/api/admin.js` hold the service key server-side behind `BOT_ADMIN_PASSWORD`; `hub/index.html` + `app.js` show
  the kill switch, each game's lean / worst-best / P&L-by-final-margin chart / ladder with our orders, fills with CLV
  and P&L, recent runs, and an add-game form (enter your line for the home team, e.g. −4.3).
- **Setup Chris does once:** GitHub repo secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; ycpr-bot Vercel env vars
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_ADMIN_PASSWORD`; redeploy ycpr-bot.
- **2026-10-21 fixes:** (1) The add-game form asked for the *home* team's line; all three first entries were the
  *pick's* line, so the bot thought Chris's number opposed his pick (quotes sat 3–7¢ behind the touch, no fills). Rows
  corrected; the form now asks for "your line for <picked team>" and confirms before saving a number that isn't better
  for the pick than the market; the runner won't add exposure when the blended number doesn't favor the pick (cancels
  its quotes, counts `noEdge`). (2) GitHub ran the */10 schedule only 3 times in 11 hours, so the primary trigger is now
  ycpr-bot's `/api/cycle` (bundled from `bot/runner/paper.ts` at deploy, `Authorization: Bearer $CRON_SECRET`) called
  every 5 min by cron-job.org; the GitHub workflow is an hourly backup and cycles skip if one is already running.
  (3) Resting quotes within 1¢ on the safer side are kept instead of cancel/replace (queue priority).
- **2026-10-21 (later):** (1) The bot computes YCPR's number itself (`bot/runner/ycpr.ts`, same resolution as Admin
  Matchups: saved week if "Saved As Week", else latest live label ≤ week, then `computeRow`); verified 219/220 weeks 6–7
  locks to 0.05. `bot_watchlist.my_home_margin` is now an optional override; `ycpr_home_margin` is refreshed each cycle.
  (2) The fair price now trusts our number per game (`ycpr_weight`, default 1 = our number only, no fade to kickoff).
  The old default (≤35% fading to 0) made the fair ≈ Kalshi near kickoff, which is why NMSU/JMU showed no edge.
  (3) The dashboard is away-oriented like the site: YC line and market as away spreads, pick auto-selected to the side YC
  favors vs the market, optional override, trust selector. (4) Kalshi-implied margin fits rungs between 15¢ and 85¢
  (tails skew it).
