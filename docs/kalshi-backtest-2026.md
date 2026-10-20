# Kalshi CFB spread backtest: 2026

Generated 2026-10-20T17:52:53.347Z by `bot/backtest/run.ts`. Read-only: no orders were placed.

## Coverage
- FBS-vs-FBS completed games: 388; with a projection frozen before kickoff: 316.
- Settled Kalshi KXNCAAFSPREAD events for 2026: 884; matched to an eligible game: 316.
- Rungs (markets) on matched games: 9479 (skipped 0 void/unmapped); with a two-sided quote at kickoff: 8958.
- Kalshi team names not mapped by matchTeamName: Anderson (SC), Concord, Glenville State College, Louisiana Christian, North Carolina St., Northwestern (IA), Ohio Dominican, South Dakota Mines, UVA Wise, Winona St..

## 1. Is our fair price closer to the result than Kalshi's?

Log loss per rung (lower is better). **Edge** = Kalshi log loss − ours, ×1000, mean [90% interval resampling whole games]. Positive = we forecast better than the market.
The last column prices the same rung with our distribution centered on the **sportsbook closing spread**: a check that the distribution shape agrees with Kalshi.

| Quote used | Rungs | Games | Ours | Kalshi mid | Edge ×1000 | Book-centered (Kalshi) |
|---|---|---|---|---|---|---|
| Last quote before kickoff, all | 8958 | 316 | 0.5133 | 0.4998 | -13.4 [-22.7, -4.0] | 0.5026 (vs 0.4998) |
| Last quote before kickoff, spread ≤ 4¢ | 8933 | 316 | 0.5134 | 0.5002 | -13.2 [-22.5, -3.7] | 0.5029 (vs 0.5002) |
| 24h before kickoff, all | 8958 | 316 | 0.5133 | 0.5026 | -10.7 [-19.4, -1.6] | 0.5026 (vs 0.5026) |
| 24h before kickoff, spread ≤ 4¢ | 8444 | 316 | 0.5177 | 0.5076 | -10.0 [-19.1, -0.5] | 0.5075 (vs 0.5076) |

## 2. Does YCPR add information the Kalshi price lacks?

Logistic fit on the last pre-kickoff quote: P(YES) = σ(-0.002 + 1.110·logit(Kalshi) + -0.044·logit(YCPR)).
- YCPR weight: **-0.044**, 90% interval [-0.453, 0.425] (games resampled). Above 0 = our number moves the forecast in the right direction even after the market price is known.
- Leave-one-week-out log loss: blend 0.5021 vs Kalshi alone 0.4998 (8958 rungs, 6 weeks).

## 3. Taking: buy below fair / sell above fair, one contract

At each hourly quote up to 30 min before kickoff, take the first ask that is below our fair by more than the taker fee + min edge (or bid above fair by that much). One trade per market. P&L is after the taker fee; CLV is the move to the last pre-kickoff mid, in cents. 90% intervals resample games.

| Min edge | Mode | Trades | Games | Win % | P&L ¢/contract | CLV ¢ | Total P&L $ |
|---|---|---|---|---|---|---|---|
| 0¢ | every rung | 8436 | 316 | 47.0% | -1.88 [-4.33, 0.60] | -1.34 [-1.64, -1.05] | -158.24 |
| 0¢ | best rung per game | 316 | 316 | 50.6% | 4.35 [0.26, 8.29] | 1.83 [1.31, 2.31] | 13.74 |
| 2¢ | every rung | 6166 | 313 | 44.6% | -1.76 [-4.86, 1.29] | -1.02 [-1.36, -0.66] | -108.69 |
| 2¢ | best rung per game | 313 | 313 | 49.5% | 5.09 [1.03, 9.20] | 2.19 [1.71, 2.66] | 15.92 |
| 4¢ | every rung | 4189 | 281 | 42.9% | -1.50 [-5.37, 2.30] | -0.74 [-1.16, -0.31] | -62.98 |
| 4¢ | best rung per game | 281 | 281 | 49.5% | 5.07 [0.59, 9.71] | 2.70 [2.22, 3.19] | 14.25 |
| 6¢ | every rung | 2729 | 224 | 40.8% | -2.53 [-7.07, 2.08] | -0.54 [-1.06, -0.04] | -69.07 |
| 6¢ | best rung per game | 224 | 224 | 46.9% | 3.73 [-1.38, 8.81] | 2.81 [2.22, 3.35] | 8.36 |
| 8¢ | every rung | 1769 | 168 | 38.8% | -3.24 [-8.47, 2.11] | -0.41 [-0.96, 0.19] | -57.30 |
| 8¢ | best rung per game | 168 | 168 | 47.6% | 2.19 [-3.38, 8.24] | 3.11 [2.42, 3.83] | 3.68 |
| 10¢ | every rung | 1075 | 113 | 36.1% | -4.82 [-11.05, 1.40] | -0.30 [-0.96, 0.46] | -51.80 |
| 10¢ | best rung per game | 113 | 113 | 45.1% | 1.79 [-5.46, 8.93] | 2.84 [1.99, 3.78] | 2.02 |

### 3b. Same strategy, fair price from the sportsbook spread instead of YCPR

If this does as well as YCPR, the profit comes from Kalshi quotes lagging the sportsbooks, not from our model. The closing line wasn't known at entry, so it is an upper bound; the opening line was known, so it is a strategy a bot could really run.

| Fair from | Min edge | Mode | Trades | Win % | P&L ¢/contract | CLV ¢ |
|---|---|---|---|---|---|---|
| Closing line (hindsight) | 0¢ | every rung | 7761 | 40.8% | 1.28 [-1.00, 3.59] | 1.27 [1.11, 1.44] |
| Closing line (hindsight) | 0¢ | best rung per game | 316 | 52.8% | 8.00 [3.85, 11.99] | 4.44 [4.11, 4.80] |
| Closing line (hindsight) | 2¢ | every rung | 4054 | 42.8% | 3.48 [0.12, 6.76] | 2.83 [2.61, 3.07] |
| Closing line (hindsight) | 2¢ | best rung per game | 311 | 50.5% | 7.31 [3.06, 11.49] | 4.80 [4.46, 5.14] |
| Closing line (hindsight) | 4¢ | every rung | 1784 | 46.2% | 4.05 [-1.10, 9.71] | 4.78 [4.40, 5.13] |
| Closing line (hindsight) | 4¢ | best rung per game | 230 | 52.6% | 7.88 [3.00, 13.27] | 6.13 [5.72, 6.53] |
| **Opening line (no hindsight)** | 0¢ | every rung | 7931 | 39.3% | -3.86 [-6.10, -1.49] | -1.21 [-1.47, -0.95] |
| **Opening line (no hindsight)** | 0¢ | best rung per game | 316 | 44.0% | 1.68 [-2.15, 5.69] | 1.00 [0.59, 1.45] |
| **Opening line (no hindsight)** | 2¢ | every rung | 5061 | 37.8% | -4.14 [-7.47, -0.93] | -1.09 [-1.41, -0.76] |
| **Opening line (no hindsight)** | 2¢ | best rung per game | 311 | 39.5% | -1.55 [-5.33, 2.15] | 1.44 [1.06, 1.82] |
| **Opening line (no hindsight)** | 4¢ | every rung | 2985 | 36.3% | -5.62 [-9.98, -1.23] | -1.09 [-1.49, -0.68] |
| **Opening line (no hindsight)** | 4¢ | best rung per game | 241 | 42.7% | 0.62 [-4.04, 5.43] | 1.86 [1.42, 2.32] |

### 3c. When the YCPR best-rung-per-game trades (2¢ min edge) were entered

| Hours before kickoff | Trades | P&L ¢/contract | CLV ¢ |
|---|---|---|---|
| 0–6 | 14 | 3.82 [-14.48, 22.20] | -0.46 [-1.04, 0.14] |
| 6–24 | 8 | 25.70 [-3.14, 53.11] | 0.06 [-0.94, 1.00] |
| 24–72 | 23 | 5.77 [-9.23, 21.38] | -0.35 [-1.02, 0.37] |
| 72–∞ | 268 | 4.48 [0.04, 8.96] | 2.61 [2.07, 3.12] |

## 3d. Only games your filters flag (computeRow betTeam vs the closing line)

- Games flagged: 47 of 316. ATS vs the closing line: 23-24 (48.9%; break-even at −110 is 52.4%).
- Forecast edge on these games' rungs (Kalshi log loss − ours, ×1000): -42.4 [-84.2, -1.2] over 1320 rungs.

Taking only in the direction your filter picked:

| Min edge | Mode | Trades | Win % | P&L ¢/contract | CLV ¢ |
|---|---|---|---|---|---|
| 0¢ | every rung | 1279 | 48.1% | -6.35 [-13.70, 1.09] | -4.97 [-5.88, -4.12] |
| 0¢ | best rung per game | 47 | 44.7% | -1.95 [-12.29, 8.41] | -1.66 [-3.03, -0.29] |
| 2¢ | every rung | 1212 | 46.9% | -5.57 [-13.25, 1.99] | -4.13 [-4.99, -3.28] |
| 2¢ | best rung per game | 47 | 42.6% | -3.10 [-13.86, 7.74] | -1.28 [-2.64, 0.11] |
| 4¢ | every rung | 1065 | 43.3% | -5.92 [-14.01, 2.73] | -3.57 [-4.40, -2.69] |
| 4¢ | best rung per game | 46 | 37.0% | -4.05 [-14.37, 6.38] | -0.64 [-1.83, 0.68] |

Your filtered bet placed on Kalshi (rung nearest the closing spread, taken 30 min before kickoff, 1 contract): 47 bets, win 48.9%, P&L -4.30 [-15.59, 6.83] ¢/contract, total $-2.02.

## 4. Sensitivity: σ around our projection

σ = 15.31 was fit around the market's line. Our projection is noisier, so a wider σ may price better. (Same last-quote rungs.)

| σ | Ours | Kalshi mid | Edge ×1000 |
|---|---|---|---|
| 15.31 | 0.5133 | 0.4998 | -13.4 [-22.7, -4.0] |
| 17 | 0.5160 | 0.4998 | -16.1 [-24.8, -7.5] |
| 19 | 0.5212 | 0.4998 | -21.3 [-29.7, -12.4] |
| 21 | 0.5273 | 0.4998 | -27.5 [-36.1, -18.3] |

## 5. Calibration of our fair (last pre-kickoff rungs)

| Our fair | Rungs | Avg fair | Settled YES | Avg Kalshi mid |
|---|---|---|---|---|
| 0.0%–10.0% | 1076 | 6.8% | 7.2% | 7.9% |
| 10.0%–20.0% | 1890 | 14.9% | 12.4% | 14.5% |
| 20.0%–30.0% | 1505 | 24.8% | 23.5% | 23.7% |
| 30.0%–40.0% | 1198 | 34.8% | 32.6% | 33.6% |
| 40.0%–50.0% | 955 | 44.9% | 43.4% | 43.9% |
| 50.0%–60.0% | 782 | 54.9% | 54.2% | 54.3% |
| 60.0%–70.0% | 610 | 64.8% | 64.4% | 63.7% |
| 70.0%–80.0% | 491 | 74.6% | 74.5% | 74.1% |
| 80.0%–90.0% | 383 | 84.5% | 85.1% | 83.6% |
| 90.0%–100.0% | 68 | 92.5% | 91.2% | 90.1% |
