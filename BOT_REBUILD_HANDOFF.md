# Kalshi / Novig / ProphetX CFB spread bot: trading-methodology rebuild (handoff)

Paste this into a new chat that has the bot's code. The previous chat had NO access to the bot code, only the YCPR website repo (the model/data side). Everything under "Measured" comes from real data. Everything under "Design" was agreed in principle with the user but is not yet built. Treat the bot code as the source of truth for anything about current behavior.

## 1. Goal

Rebuild the **trading methodology** of an autonomous bot that trades college football spreads on Kalshi, Novig and ProphetX. Inputs: the user's projected line ("YC line"), the market line, and each venue's strike ladder/books. The prediction model is kept; the problem is how edge is turned into positions.

## 2. Symptoms the user reports

- Small wins/losses when the game lands near the market line; big wins when right and far; big losses when wrong and far.
- Often right directionally (final margin between the market line and YC's line) and still loses money. "Could just place a bet instead."
- Intended to take AND make (buy/sell at different points, take profit along the way). Feels unsophisticated.
- Big favorites: when the user likes the favorite there are not enough higher alt strikes to build the long tail, so risk is disproportionate to reward.
- Dashboard evidence: K-State @ Colorado: YC -4.8, reference -2.5, venues drifted to about +0.1; 44 fills, worst case about -$18, "Kalshi EV" -$1.58. Illinois, UTEP, Nevada similar in direction. The bot kept buying as the market moved away from the YC number.

## 3. Diagnosis (agreed)

1. **The symptom is mostly math, not a bug.** If the edge is "my mean differs from the market's mean," the efficient position over a full strike ladder is roughly linear in final margin. Breakeven sits at about the midpoint between market line and fair line, not at the market line. So: small P&L near the market, big tails, losses in the lower half of the gap. That is what a correctly built position looks like when fair value is wrong.
2. **The input is overconfident.** The bot uses the raw YC line as fair value. A 5-8 point disagreement with a liquid CFB market is mostly model error. Fair value must be shrunk toward the market (see 4.1).
3. **Adverse selection / chasing.** With a fixed fair value, a market that moves away makes every price look cheaper, so the bot keeps adding (K-State pileup). Fair value must move with the market, and there must be hard caps.
4. **Two-sided quoting probably loses money here.** Quoting both sides of CFB spread ladders against sharper flow is classic adverse selection. Avellaneda-Stoikov style market making assumes a neutral fair value and uninformed flow; this bot has a directional view and is quoting into a sharper market. Drop it for now; re-enable only where measured markouts are positive.

## 4. Measured (YCPR data, 1,504 games, 2024-25, vs the CLOSING line)

Script: `scripts/bot/calibrate-beta.ts` in the YCPR repo (run with `bun`). Source: `src/data/betHistory.data.ts`, which has closing spread, YC projection and final score for every game, not just bets placed.

- **beta (shrinkage) = 0.17, SE 0.11, bootstrap 95% CI [-0.06, 0.39].** 2024: 0.14 ±0.15; 2025: 0.21 ±0.18. Regression: (final margin - closing line) on (YC line - closing line), no intercept.
- **Residual sigma around the closing line = 15.2** (use ~15; not the SD of raw margins). YC MAE vs final margin 12.16 vs closing-line MAE 11.98.
- Mean |YC - close| = 2.65, SD 3.46.
- **Cumulative by gap size (ATS vs close, n):** >=3: 52.0% (525) · >=4: 53.8% (338) · >=5: 54.4% (211) · >=6: 58.5% (121) · >=8: 59.5% (43). Points captured per game at >=6: about 1.6 of a 7.8 average gap, i.e. beta about 0.2. Captured points do NOT clearly grow with gap size; too noisy to call.
- **Leads only (many cells examined; expect false positives):** beta about 0.59 when YC is MORE bullish on the favorite than the market (n=711) vs about 0.09 when more bullish on the dog (n=674). By closing-line size: |line| 7-14 beta 0.53 ±0.23 (n=414), but |line| 14-21 and 21+ are about -0.1 (n=444). **No demonstrated edge on big favorites**, which partly dissolves the "not enough alt strikes" problem: size there should be small anyway.
- Caveats: (a) closing line is the hardest benchmark. The bot enters earlier, so beta against its ACTUAL ENTRY lines (and CLV) should be higher; that must be measured from the bot's own fill logs, which this chat did not have. (b) 2025 weeks 10+ in the file have `spread` and `prediction` sign-flipped; the script un-flips both (verified by correlation with final margin). (c) Home side outperformed the close by about 0.7 pts on average (not significant, 1.7 SE).

Implication: at beta about 0.17-0.2 a 6-point gap is a ~1.0-1.2 point real edge. With sigma 15, the probability density at the market line is about 0.0266 per point, so a 1.2-pt shrunk edge is worth about +3.2% cover probability at the market strike. That is thin against a -110 breakeven of 52.4% or Kalshi fees. Fees and execution costs decide whether this trades at all, which is why they must be exact per venue.

### 4b. Measured 2026 (Supabase: `bot_fills`, `game_projection_locks`, `betting_lines`, `games`), added 2026-10-28

The bot's own logs ARE in the YCPR Supabase project (`bot_orders`, `bot_fills`, `bot_snapshots`, `bot_mkt_*`, `bot_strategies`, `bot_watchlist`). It runs in **paper mode** (fills from 2026-10-21 to 10-29, 1 contract each, 4 strategies: Aggressive, Default, Patient, Shaped).

**Bot fills, per contract (1,545 settled fills with a close, 14 games):**
- Edge the bot thought it had at fill (`fair_at_fill` vs price): **+7.8c**. Markout to close (`close_mid` vs price): **+0.6c**, about 7% of the claimed edge. Kalshi +0.9c, Novig +0.1c, ProphetX +0.4c; Shaped strategy -0.3c on a smaller claimed 4.6c. Buys +0.7c, sells +0.4c.
- Paper fills price 0.9c better than the mid on average, so paper results are flattered versus live.
- Realized paper P&L **-$385 (-25c per contract)**, fees $12.6. But 1,545 fills are only 14 games (100+ ladder fills each), so effectively 14 outcomes. Five games with YC far more bullish on a favorite than the book lost $41-68 each: Texas Tech -$68 (won by 13 vs book -11, so it covered the market and still lost because the ladder reached YC's -15.8), James Madison -$61, Louisiana -$54, Wyoming -$53, Kansas State -$41. Only two games won (+$28, +$13). This is exactly the "between market and my line, still lose" symptom, reproduced in the logs.

**2026 YC vs Bovada close (560 completed games, locks vs final score):**
- beta weeks 1-9 pooled **-0.10** (SE 0.12). Week 1 -0.45 and week 2 -0.32 (week 1 locks were all written after kickoff, old auto-lock era). Weeks 3-9 with pre-kickoff locks only: **beta 0.10, SE 0.15**, 71-62 (53.4%) ATS at gap 3+. Gap 6+ all weeks: 44-57. Residual SD 14.6; YC MAE 12.46 vs close 11.61.
- **YC model CLV, 2026 (558 completed games, YC lock vs Bovada open and close; CLV = points the line moved toward YC's side):** overall +0.14 pts (t 2.0), 55% of games moved toward YC, 3.8% of the open gap closed; ATS vs the open only 47.4%.
  | Gap vs open | n | CLV pts | t | moved toward YC | % of gap closed |
  |---|---|---|---|---|---|
  | 0-2 | 217 | +0.02 | 0.2 | 53% | 3% |
  | 2-4 | 158 | +0.26 | 2.1 | 58% | 9% |
  | 4-6 | 83 | +0.61 | 3.6 | 73% | 13% |
  | 6+ | 100 | -0.19 | -1.2 | 40% | -2% |
  By week: weeks 1-2 negative (week 1 locks were post-kickoff), weeks 3-8 mostly positive (week 6 +0.65, week 8 +0.43, week 7 flat, week 5 -0.09). CLV peaks at 4-6 point gaps and is gone or reversed beyond 6, so the edge looks hump-shaped, not linear: design implication is a ramp that rises to about a 5-point raw gap and then flattens or falls (treat 6+ as stale info or model error: skip or shrink hard). n=100 in the 6+ bucket, so confirm as weeks accumulate. Not yet run: CLV vs the FanDuel open.
- Caveat on section 4: the 2024-25 spreadsheet predictions (beta 0.17) may not have been strictly frozen pre-game. The 2026 lock table is the cleaner out-of-sample record, and it says beta is between 0 and 0.15. Start at **beta = 0.1**, not 0.2, until more weeks accumulate.

Three independent reads (2024-25 regression 0.17, 2026 regression ~0.10, market moving 4-7% toward YC) all say the bot's fair value overstates the edge by roughly 10x.

## 5. Design (agreed direction)

### 5.1 Fair value: shrunk, and it moves with the market
```
fair_mean = market + beta * (yc_line - market)     # market updates live; yc_line is the base
sigma     = ~15 (residual around closing line; prefer empirical distribution of (margin - close) over a normal: CFB clusters on 3 and 7)
P(cover s) = P(margin beyond strike s) under N(fair_mean, sigma) or the empirical residual distribution
```
- The "x std devs off market" trigger runs on the SHRUNK edge (`beta * gap`), not the raw gap.
- Use the sharpest line available as the "market" anchor (consensus or sharp book), not one of the venues being traded. Venue moves are information. Check what the bot's "Mkt" reference column actually is.
- Start with beta = 0.2 (a bit above the point estimate; the data cannot distinguish 0.1 from 0.35). Re-estimate against the bot's own entry lines and CLV once logs exist.

### 5.2 Target-position rebalancing (replaces "quote, fill, take profit at points")
Re-run on every market tick, model update, or fill:
```
for each strike s in the ladder:
    target[s] = fractional-Kelly size from shrunk edge (linear ramp in margin; slope ~ edge/sigma^2 * bankroll * kelly_frac)
apply caps: per strike, per game (max loss), per team/conference (correlation), portfolio
for each strike:
    gap = target[s] - current_position[s]        # current position SUMMED across Kalshi + Novig + ProphetX
    if gap > 0: buy; if gap < 0: sell (this IS the take-profit and the risk reduction)
    price = best net price after venue fees; take if edge_after_fees > take_threshold,
            else rest passive at fair - buffer, cancel when fair moves
```
- Taking profit is automatic: when the market moves toward the YC number the shrunk edge falls, target shrinks, bot sells. No arbitrary exit points.
- A market that moves away barely grows the target (fair value follows it), so no K-State-style pileup. Hard per-game caps as backstop.
- **Never push missing high-strike size down onto lower, more expensive strikes.** If strikes above the breakeven midpoint don't exist, hold less. Some favorites are not tradable at size; accept that.
- Sizing scale: shrunk edge 1.2 pts, sigma 15 -> full Kelly ~0.53% of bankroll per margin point; quarter Kelly ~0.13%/pt, so a 15-pt miss costs ~2%.

### 5.3 Trade every game, scaled by edge (user's question, answered)
Yes in the continuous form: size proportional to shrunk edge net of fees, capped, zero when edge is inside the fee/uncertainty dead zone. Do not use a hard select-games cutoff. With beta ~0.2 the dead zone naturally falls around raw gaps of ~2-3 pts. Track P&L by edge bucket in shadow mode; if captured points flatten at large gaps, switch the ramp from linear to concave (cap earlier).

### 5.4 Fill and markout logging (explained)
For every fill, log: fill_id, timestamp, venue, game, strike, side, qty, price, fee, order type (taker vs passive), the market line and the shrunk and raw fair at fill time, the YC line, time to kickoff. Then record the same market's mid (or the consensus line converted to a probability for that strike) at +1 min, +15 min, +60 min, and at close, plus the final settlement.
- **Markout = (later mid - fill price) x direction, net of fee.** Positive means the market moved your way after you traded (good price/CLV). Negative means you bought and the market then went against you.
- 1 min catches immediate adverse selection (stale quotes picked off). 15-60 min catches information being absorbed. To-close is CLV. Settlement is realized.
- Slice by order type, venue, edge bucket, time to kickoff, and whether the fill followed a market move. Passive fills with negative short markouts mean quote wider, update fair faster, or stop quoting. Taker fills with positive to-close markouts mean the edge is real.
- Why: markouts give thousands of per-fill observations, versus a few hundred game results per season. It is the fast, low-noise way to learn whether execution and the model have edge, in weeks instead of seasons.
- The existing "Kalshi EV" dashboard column is effectively a markout. Make it the headline live metric.

### 5.5 Venue and data rules
- Verify current fees from each venue's live docs; do not hardcode. Normalize everything to net probability per contract. Kalshi taker fee is roughly 0.07 x P x (1-P); Novig maker fee reportedly zero pre-game; ProphetX commission/maker-taker is account-configurable. All unverified.
- One shared risk/position book across all three venues. Verify spread orientation, convention, overtime rules and settlement per venue before treating contracts as equivalent.
- Reconcile exchange positions and open orders before placing; idempotent orders; stale-data detection; kill switch that cancels resting orders.

## 6. Build order

1. **Measure** (partly done, section 4): re-run the beta/sigma regression using the bot's own ENTRY lines, and compute CLV on existing fills. Check whether passive vs taker fills differ in markout using existing logs. If beta is near zero against entry lines, no execution logic saves the strategy.
2. Shrunk, market-updating fair value with exact per-venue fees (5.1).
3. Target-position rebalancing, take-only on large edges first, with caps (5.2). No two-sided quoting.
4. Fill + markout logging (5.4), hooked up before step 3 goes live.
5. Shadow mode alongside the current bot for a couple of weekends. Then small live limits. Add passive resting orders only where markouts support it.

## 7. Questions the new chat should answer from the bot code first

1. What exactly does it trade: Kalshi ladder binaries, Novig/ProphetX straight-spread contracts, alts? How does it map strikes across venues?
2. Current fill/quote logic: how fair value is computed today, how sizing works, why it kept buying K-State (re-entry rules, caps, inventory handling).
3. How does it exit: hold to settlement, take-profit points, or mix? Is it quoting both sides?
4. What does it log today (orders, fills, fair at fill, book snapshots)? Is there enough to compute markouts and entry-line beta?
5. Are fees included in the current "EV" figures, per venue?
6. Where does the "Mkt" reference line come from?

## 8. Pointers into the YCPR repo (model/data side, not the bot)

- YC projections: `game_projection_locks` table (2026 weeks 1-5 complete; week 1 locked after kickoff in the old auto-lock era; week 6 mostly unfrozen) and `src/data/betHistory.data.ts` (2024-25 static; 2025 wk10+ sign-flipped for spread and prediction). Join logic with the un-flip: `src/lib/drogba/agreement.ts` (`ycSpreadByGame`).
- Closing line convention in this data: Bovada's close (CFBD) is the site's default close; FanDuel opens are on file for about 62% of 2024-25 games.
- Past research findings relevant to trust in the model: independent DROGBA model beats the open only in power-vs-power games; agreement between DROGBA and YC helps only there. Details in the DROGBA notes in project memory, not required here.
- Placed-bet exports in the repo root (`placed-bets-*.csv`) have book, side, line, price, stake, result per bet, useful for entry-line analysis; they are bet-level, not fill-level.

## 9. Week workflow cleanup (user requirements, to build together with the methodology change)

One button on the bot's existing weekly page (not a new page or nav item; ask first, see section 12) that does, for the selected week:
1. **Add every game** for the week to the watchlist (`bot_watchlist`), including venue event mappings (Kalshi event, Novig, ProphetX, Polymarket once added). Skip games already present; report games with no mapped venue.
2. **Sync YC lines from the YC site**, as the existing sync already does (`ycpr_home_margin`, `ycpr_updated_at`). Keep the untouched original.
3. **Shrink toward the market live.** Trading line = `market + beta * (yc - market)`, recomputed on every market update, so the trading line moves as the market moves. beta is one editable global setting, default 0.1 (section 4b), plus the hump cap near 5-6 points of raw gap (section 4b). sigma default 15.
4. **Optimize the strategy for every game from its edge** instead of hand-picking a preset per game: derive size, per-strike targets, max worst-case loss and take threshold from the shrunk edge, fee dead zone and ladder depth. Games whose edge is inside the dead zone get zero size. Never push missing high-strike size onto lower strikes. Output an explainable per-game plan (why this size, what the P&L-by-margin looks like) before and after it is applied.
5. Re-run steps 2-4 whenever the YC line, market line or fills change, with the same caps. A visible on/off per game and a global kill switch stay.

Per game, the page must show side by side: **my original YC line, my trading (shrunk) line, the current market line on each venue, and everything the existing trading view already shows** (positions/inventory, open orders, fills, P&L by final margin, EV/markout column, status). Do not remove existing information; reorganize it.

## 10. Add Polymarket

Add Polymarket as another venue in the same adapter pattern as Kalshi/Novig/ProphetX (shared position book, fee-normalized prices, paper mode first, `venue = 'polymarket'` in `bot_mkt_*`, `bot_orders`, `bot_fills`, `bot_snapshots`).
- Research the current Polymarket sports API docs live before writing code: which product/endpoint applies to a US user (Polymarket US vs the international CLOB), authentication, order types, tick size, fee schedule, whether CFB spread markets exist and how strikes/ladders and settlement are defined, team orientation, overtime rules. Do not hardcode fees or assume spread semantics match the other venues.
- Verify with the user that their account and jurisdiction can trade these markets. This is the user's call; do not work around restrictions.
- Start read-only (market data into `bot_mkt_snaps`/`bot_mkt_implied`, shown on the page next to the other venues), then paper fills, then live only when the user says so.

## 11. Existing Supabase schema the bot uses (project uyxnmtsntiaxqqmwsteq)

- `bot_state` (mode, kill_switch, default_ycpr_weight), `bot_strategies` (4 presets: Aggressive, Default, Patient, Shaped; pro_edge, anti_edge, take_edge, edge_step, max_worst_case_loss, per_rung_cap, ycpr_weight, shape, market_floor, against_limit, blowout_margin), `bot_watchlist` (per game: pick, my_home_margin, ycpr_home_margin, kalshi_home_margin, venues, venue_events, venue_margins, strategy_preset, caps, order_size).
- `bot_orders` (kind, direction, fair, reason, status, strategy_id, venue), `bot_fills` (price, count, fee, fair_at_fill, mid_at_fill, close_mid, result, strategy_id, venue), `bot_snapshots` (bid, ask, fair), `bot_runs`.
- `bot_mkt_games` (ycpr_home_margin, book_home_margin, venue_margins), `bot_mkt_snaps` (bid/ask per ticker/strike), `bot_mkt_trades`, `bot_mkt_last`, `bot_mkt_implied` (implied margin per venue over time), `bot_hypo_games`, `bot_hypo_results`.
- Current fair value uses `ycpr_weight` (default 1 = pure YC, no shrink). That is the single biggest lever (section 3).
- Closing-line/markout fields exist only at fill level (`close_mid`); 1/15/60-minute markouts can be rebuilt from `bot_mkt_snaps` timestamps.

## 12. Working rules for whoever builds this

- The bot stays in **paper mode**. Never switch to live, change the kill switch behavior, or place real orders without the user's explicit go-ahead in chat.
- **Ask before adding any new page or nav item**; put new controls on existing pages. Suggest placements first.
- Schema changes go through Supabase migrations; list them to the user before applying. Do not drop or rewrite existing `bot_*` data (it is the evidence base for markouts).
- Validate against history before trusting: replay the new fair value/targets on the fills and snapshots already logged (shadow mode vs the current four strategies) and report CLV/markout and P&L-by-margin shape, not just "it runs".
- Typecheck with `bunx tsc --noEmit` where the repo supports it; do not commit `bun.lock` in the YCPR repo.
