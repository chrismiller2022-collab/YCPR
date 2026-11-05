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

## Roadmap
1. Desk tab: power ratings → NFL playoff sim → fair share %, projected pot, max bid, value ratio, portfolio. Reads the same local auction doc.
2. Market model: expected prices from futures + per-attendee bidding history.
3. More formats: March Madness, CFB 24-team playoff, NFL and CFB regular season.
4. Read-only phone link for attendees (4-digit code → Stage view).
