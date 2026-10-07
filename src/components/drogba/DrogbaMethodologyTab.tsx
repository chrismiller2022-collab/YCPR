import type { ReactNode } from "react";
import { DIM, H3, P } from "./shared";

function S({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 style={H3}>{title}</h3>
      {children}
    </>
  );
}

export default function DrogbaMethodologyTab() {
  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>DROGBA methodology</h2>
      <p style={P}>
        DROGBA (Data Ridge on Games By Agent) is a spread model built to find games where the <strong>opening</strong> line is wrong, not to produce another power rating. The opening line is the market's first guess; the closing line
        is a better guess (it has MAE 12.08 against final margins vs 12.18 for the open, 2021–26), and a bet at the open that the line later moves toward is a bet on information the open didn't have. The model is built around that.
      </p>

      <S title="1. What the data says before any modeling (as of Oct 2026)">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li>
            <strong>A scoreboard-only rating doesn't beat the open.</strong> A walk-forward ridge rating on final margins (carried over from last season with mean reversion) misses by 13.46 points on average vs 12.07 for the opening line (2022–26) and
            goes 51–53% against the open. Parameters tuned on 2022–23 showed 53–55% and then 48–51% in 2024–26, i.e. noise.
          </li>
          <li>
            <strong>No simple structural edge.</strong> Home teams, big favorites, big home dogs, early weeks, small spreads: every split is 49–53% against the open.
          </li>
          <li>
            <strong>Your consensus has real information the open doesn't — mostly early and in line movement.</strong> On 1,750 FBS games from 2024–26: in weeks 1–3, picks with a consensus edge of 4+ points vs the open went 58.6% (116 bets), 5+ went
            60.3% (73), 6+ went 66.7% (45). From week 4 on, ATS is only ~51–52% at every edge size, but the line does move toward your number (about 0.09 points per point of edge, t≈5) — you would have had closing-line value, just not enough of it to win
            more than ~52% against the number.
          </li>
          <li>
            <strong>Sample sizes are small.</strong> 116 bets at 58.6% has a standard error of about 4.6 points; the break-even rate at −110 is 52.4%. Treat anything here as a lead, not a result.
          </li>
        </ul>
      </S>

      <S title="2. Data and its limits">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li>Games, scores and lines for 2021–26. "The open" is one book's number. The default is <strong>FanDuel's</strong> (it opens early and makes the market; other books copy it later in the day after it has taken action), pulled as snapshots from The Odds API: a game's FanDuel open is its earliest snapshot from the Sunday of its week on (looks at 6, 8, 10 and 11am ET; most lines are up by about 11am), the closing line is Bovada's from CFBD for every game, and where FanDuel has no snapshot the model falls back to Bovada's open (or drops the game, if you choose "FanDuel only"). Bovada is the only book in CFBD with an open on ~99% of FBS games every year and differs from other books' opens by about 1.5 points on average, so an edge against one book's open may not exist at another. All of the Phase 0 numbers above were measured against Bovada's open and need re-running against FanDuel's once it is pulled.</li>
          <li>Per-game advanced stats (success rate, explosiveness, PPA) from CFBD, backfilled by the Data & sync tab. Only each team's own offensive numbers are used (a game's offense stat for A is the same plays as B's defense stat).</li>
          <li>Preseason inputs: returning production, talent composite, recruiting class, transfer portal net rating.</li>
          <li>Your own projections: 2024–25 from Bet History, 2026 from the Freeze Week locks. <strong>Data fix:</strong> in Bet History, 2025 weeks 10+ store the spread and prediction with the opposite sign from every other week (checked against Bovada's closing line: 100% of weeks 10–16 flipped, 0% of the earlier ones). DROGBA un-flips those rows for its own use; Bet History itself is unchanged. Worth checking those weeks' records there.</li>
        </ul>
      </S>

      <S title="3. Walk-forward rule">
        <p style={P}>
          Every rating used for a game in week W is built only from games in weeks before W of that season, plus last season's final ratings as a prior. Models are graded on seasons they were not fit on. Nothing uses a closing line, a score, or a stat from the game being predicted
          or any later game. (This is the same discipline that keeps JP+ honest and is the reason the totals model's end-of-season training caused trouble — it was fit on full-season stats but applied to partial seasons.)
        </p>
      </S>

      <S title="4. Efficiency ratings (the core, JP+-style)">
        <p style={P}>
          For each per-play metric (success rate, explosiveness, PPA) every team gets an offense effect and a defense effect from a ridge regression on that metric's per-game values: metric(team's offense vs opponent) = league average + team's offense effect +
          opponent's defense effect + a small home term. That adjusts for opponent strength — a 55% success rate against a top-20 defense counts for more than one against a bottom-20 defense. FCS opponents are pooled into one team. The ridge penalty shrinks each
          effect toward last season's final effect times 0.6 (not toward zero), so week 1 is mostly last season, and the prior is replaced by this season's games as they accumulate. Net efficiency = offense effect − defense effect allowed.
        </p>
      </S>

      <S title="5. Layer 1: market-blind margin prediction">
        <p style={P}>
          A ridge regression, trained on earlier seasons, maps the home-minus-away difference in net efficiency (success rate, explosiveness, PPA), the scoreboard rating difference, the home-field flag and the preseason differences (talent, returning production,
          portal, recruiting — faded out as the season goes on: weight 3/(3 + weeks played)) to the actual home margin. It never sees a betting line, so any disagreement with the market is the model's own view.
        </p>
      </S>

      <S title="6. Layer 2: disagreement with the open → expected cover">
        <p style={P}>
          The second ridge predicts how many points the home side covers the opening spread by, from how far each signal (the Layer-1 margin, and your consensus where available) sits from the open: edge = signal's home margin + open spread. Each signal gets separate weights for
          weeks 1–3 and week 4+. The ridge is deliberately heavy: the fitted weights are the honest answer to "how much of a disagreement with the market is real" — currently about 0.3 points of cover per point of consensus edge from week 4 on — and predictions are
          small numbers (an expected cover of 1.0 is roughly a 53% bet; 2.0 is about 56%). Disagreements are capped at 8 points before weighting: there are only ~26 games with a bigger gap in 2024–26 and they covered no better than smaller ones, and a gap that large is more often a stale rating or news the ratings can't see than a real mispricing.
        </p>
        <p style={P}>
          Win probability on the This week tab is Φ(|expected cover| / 13), where 13 points is the standard deviation of spread results; EV is shown at −110. Both are approximations and assume the model is calibrated, which only the Backtest and the Picks log can show.
        </p>
      </S>

      <S title="7. Picks and tracking">
        <p style={P}>
          A pick is a game where |expected cover| clears the threshold you set (default 1.0). The This week tab saves every game's DROGBA number, the open it was compared with, and the pick to the Picks log; the first save for a game is kept so the log is a true
          record of what the model said while the line was open. The log grades each pick against the open and the close, and shows closing-line value (how far the line moved toward the pick) — the faster-converging check on whether the model is finding real mispricing.
        </p>
      </S>

      <S title="8. What is and isn't done">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li>Built and tested on available data: scoreboard rating, consensus layer, walk-forward harness, picks log, sync endpoints.</li>
          <li>Built but untested on real data until the backfill runs: efficiency ratings, Layer 1, preseason features. The code path was exercised end to end on synthetic data only to check it runs; its results mean nothing.</li>
          <li>Not built: injury / QB-change adjustments (not in any data source here), pace or weather, an uncertainty ("sigma") model like JP+'s, and flag-style sizing. JP+'s published flag records were tuned on the same four seasons they're reported on, so I'd test a small number of pre-chosen ones rather than adopt them.</li>
        </ul>
        <p style={DIM}>Reference point: JP+ publishes 52.4% ATS on all games against the open (same as a coin flip), 56–58% at a 5+ point edge, and 61.6% on a heavily filtered ~19% of games, whose weakest blind season was 53.7%.</p>
      </S>
    </div>
  );
}
