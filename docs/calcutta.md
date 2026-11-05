# Calcutta tool

Admin → Pools → **Calcutta**. Set the auction up there, then **Open Stage window** and share *that window* (not the whole screen) on Zoom. The model/Desk will be a separate tab on the other monitor and never renders on the Stage.

## How it stores data
- One JSON doc per auction (settings, attendees, field, lots, every bid, ownership splits, results).
- Saved to this browser's localStorage on every action, so the Stage and admin tabs stay in sync instantly and a crashed tab loses nothing.
- Mirrored to Supabase `calcutta_auctions` (via `/api/pool-save`, `pool: "calcutta"`) about 1.5s after the last change. Run `supabase/migrations/create_calcutta_auctions.sql` once to enable it; until then the badge reads "Saved on this computer only".
- Undone bids are kept (flagged `voided`), so the bid log is a full history per attendee.

## Stage keys
| Key | Action |
|---|---|
| attendee's letter | bid for them: next minimum, or the typed amount |
| 0–9 | type a jump amount, then press the bidder's letter |
| Esc / Backspace | clear / edit the typed amount |
| Space | start / pause / resume the clock |
| Enter | open next lot · confirm SOLD at 0:00 · pass a no-bid lot |
| Ctrl/⌘ + Z | undo last bid |
| + | add 10 seconds |
| / | owners board |
| ` | hide / show controls |

Each bid puts the clock back up to at least the "reset" time. At 0:00 the default is a **SOLD?** prompt you confirm with Enter (a late Zoom bid still counts); auto-sell is a setting.

## NFL Playoffs default payouts
Wins pay 75%: Wild Card win 3% (×6), Divisional win 5% (×4), conference title 10% (×2), Super Bowl 17%. The #1 seeds' bye is **not** paid as a win (toggle).
Side prizes pay 25%: biggest upset by seed 7%, worst margin of defeat 6%, Cinderella (furthest 5–7 seed) 6%, best ATS record 6%. Ties split.

Why (from `scripts/calcutta/nfl_payout_sim.py`, 100k simulated playoffs with typical ratings by seed), each team's expected share of the pot by seed:

| Structure | #1 | #2 | #3 | #4 | #5 | #6 | #7 | #1 ÷ #7 |
|---|---|---|---|---|---|---|---|---|
| 40% Super Bowl, bye paid (old default) | 19.8 | 9.1 | 6.5 | 3.8 | 5.0 | 3.5 | 2.4 | 8.4× |
| Unabated/BTP 3.5/6.5/10/13 + 20% props | 13.1 | 9.1 | 7.1 | 5.0 | 6.0 | 5.0 | 4.8 | 2.7× |
| 3/5/10/17 + upset, worst loss, turnovers, ATS | 13.2 | 8.8 | 6.9 | 4.8 | 5.9 | 5.2 | 5.3 | 2.5× |
| **3/5/10/17 + upset, worst loss, Cinderella, ATS (default)** | 12.7 | 8.1 | 6.3 | 4.5 | 6.6 | 5.9 | 6.0 | 2.1× |

"Most turnovers" over the whole playoffs mostly goes to teams that play the most games (#1/#2 seeds), so it doesn't help long shots; Cinderella replaces it. Biggest upset by seed lands on a 6 or 7 seed ~40% of the time.

## Partners and buybacks
Owners & Results → Partners & buybacks records a share of a sold team moving between two people for a price. The winning bidder still owes the full price to the pot; the share price is paid person-to-person, and payouts split by ownership %.

## Desk (private model window)
Calcutta page → **Open Desk ↗** (admin sign-in required; keep it on the monitor you don't share). It follows the Stage live.

- **Ratings:** paste one team per line in Model inputs — the composite table format (`1 Los Angeles Rams 5.5 1.1`, first number = rating vs an average team, second = sources' std dev), `LAR 5.5`, or full table rows. For a screenshot, "Copy screenshot prompt for Claude", paste the image + prompt into any Claude chat, paste the reply back. Starts with the Week 9 composite.
- **Sim:** 20k playoffs by default (`src/lib/calcutta/nflPlayoffSim.ts`): margin ~ Normal(rating diff + HFA 1.5, SD 13.5), per-sim rating noise 1.5 pts (optionally + source SD), reseeded bracket, all four side prizes. Results entered on Owners & Results are locked in.
- **Fair** = team's expected share of the net pot × projected pot. **Max** = fair less your required edge. **Projected pot** starts at your expected pot and shifts to the room's pace as value sells.
- **Room expects** = fair × the room's paid-to-fair ratio for that tier (favorites / middle / long shots), shrunk toward 1 until a few lots per tier sell.
- **Portfolio** = your holdings after splits, with EV, P(profit) and 10th/50th/90th percentile payouts from the same sims.
- Desk settings and ratings stay in this browser only — never in the (public-readable) auction doc.

## Formats
| Format | Field entry | Bracket (sim) | Default payouts |
|---|---|---|---|
| NFL Playoffs | AFC/NFC seeds 1–7 | 2v7/3v6/4v5, 1 seed hosts lowest left, Super Bowl neutral | 3/5/10/17 per win + 25% side prizes |
| March Madness | paste "Region" then "seed team" lines (two on one seed line = First Four pair, sold as one lot); Final Four region order | First Four, fixed 1v16 … 2v15 regions, all neutral | Each team's total by how far it goes: win 1 game 0.75%, lose in S16 2.25%, E8 5%, F4 9%, title game 12.5%, champion 17.5% (stored per win: 0.75/1.5/2.75/4/3.5/5 = 98%) + biggest blowout victim, biggest upset, lowest Final Four seed at 0.67% each |
| CFB 12-team | seeds 1–12 (or fill from the latest Monte Carlo projection) | byes 1–4, first round on campus, then neutral bowls, fixed bracket | 4/6/10/15 per win + 25% (Cinderella = 9–12) |
| CFB 24-team | seeds 1–24 (or fill from projection) | byes 1–8, 9v24 … 16v17 on campus, reseeded each round, higher seed hosts, neutral title | 2/3/5/6/8 per win + 20% (Cinderella = 17–24) |

Byes don't pay as a win by default (toggle). Rules & Payouts shows each team's running total by round.

**Minimum buy-in** (Rules & Payouts, 0 = off): everyone owes at least this; spend less and the difference goes into the pot. The pot starts at attendees × minimum; owners, the Stage and payouts include top-ups. The Desk treats your unused buy-in as free money (your max bid rises by it), and bots spend theirs as lots run out. "Bundle long shots" groups every team at or below a seed into one lot per region (or per seed line in March Madness).

Desk ratings: NFL paste (composite format); CFB uses the site's latest power ratings and each team's home field (or a paste); March Madness paste — one "Team rating" per line, KenPom/Torvik rows work (records are skipped; tick "per 100 possessions" to scale AdjEM × 0.68).

Auto-scoring works for every format from the Games card, and **Sync from ESPN** works for all of them: NFL playoff weeks; every College Football Playoff game (ESPN's postseason "week 999"); every NCAA tournament game (one request per game day from the First Four Tuesday — guessed as the Tuesday between March 15–21, or set it). Teams match by ESPN id (CFB ids come from the site's logos), then name; rounds come from ESPN's game notes ("Sweet 16", "Quarterfinal"), else from each team's earlier games. March Madness also has **Fill bracket from ESPN** on Field & Lots once the bracket is out (seeds, regions, First Four pairs, logos and the Final Four pairing).

CFB Desk ratings come from the site: the latest saved week's power rating (`weekly_team_stats.rating`, lower = better, flipped) and the site's Team HFA blend from `team_hfa` (same as the Conferences page; `weekly_team_stats.hfa` is empty). Practice bots use the same numbers.

## Practice mode (bots)
Any auction → **Practice** tab → "Create practice auction with N bots" makes a separate copy (same rules, payouts, field, lots; just you + bots, a 15s/8s clock). Practice auctions never go to the cloud or into bidding history.

- Each bot values teams from your Desk ratings (CFB: site power ratings; none → typical by seed) plus its own noise, so bots disagree. Personalities: Steady Eddie (≈fair), Big Spender (overpays favorites, jumps bids), Bargain Bill (discounts only, bids late), Homer Hank (two pet teams), Longshot Lou (low seeds/bundles), Budget Betty (hard cap). Each guesses the pot ±25% around "room size" and half-follows the room's pace; non-budget bots cool off past their share of the room.
- On the Stage, press Enter once; bots bid by themselves (one at a time, 0.6–3s reactions, faster near 0:00) and auto-advance starts the clock, sells at 0:00 and opens the next lot. Space pauses. The Desk works as normal.
- Practice tab: replay with the same bots, new bots, peek at bot secrets, and a report (spent vs fair, EV, P(profit), and "play out the tournament" for one simulated result).

## Roadmap
1. NFL and CFB regular-season formats.
2. Postponed: futures-based market prior, read-only phone link (4-digit code), per-bidder price model from attendee history.
