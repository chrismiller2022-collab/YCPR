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
        DROGBA (Data Ridge on Games By Agent) is an independent stats model in the family of JP+, SP+ and McIllece: it rates every FBS team from play-by-play-derived efficiency, turns the ratings into a point spread, and compares that spread with the <strong>opening</strong> line.
        It is built to be available Sunday morning from CFBD data alone, so it uses no betting lines while rating teams and no one else's ratings or projections — not the site's consensus, not your own. (It can be added to the consensus later as one more system.)
      </p>

      <S title="1. Where it stands (Oct 2026, walk-forward on 2023–26, vs Bovada's open)">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li><strong>Accuracy is JP+-class but not better than the market.</strong> Its margin predictions miss by 12.5 points a game against 12.1 for the opening line (JP+ publishes 12.8 for itself). It is clearly worse than the open in weeks 1–3 (12.8 vs 12.0) and slightly better than the open from week 9 on (12.3 vs 12.4).</li>
          <li><strong>It finds information the open doesn't have, but less in recent seasons.</strong> The bigger its disagreement with the open, the further the line later moves toward it. Over 2023–26 the average closing-line value is +0.39 points on all games, +0.78 at 5+ point edges and +1.16 at 7+ — but 2023 was far stronger than the rest. In 2024–26 alone it is +0.24, +0.38 and +0.48, and no longer grows much with edge size.</li>
          <li><strong>That has not become a clear ATS winner.</strong> 50.4% on all games, 51.8% at 5+ and 53.2% at 7+ (241 bets) over 2023–26 (break-even is 52.4%); 49–51% in 2024–26 alone. JP+ publishes 56–58% at 5+ point edges. A closing-line gain of 0.4–0.8 points is worth roughly 1–2 points of win rate, which a few hundred bets cannot show.</li>
          <li><strong>One slice looks different:</strong> from week 9 on, 5+ point edges went 78–58 (57.4%, 139 bets) with +1.41 points of closing-line value. Weeks 4–8 at 5+ went 47.1% (197 bets). With samples this size the pattern may be noise; it is the first thing to watch as more games come in.</li>
          <li>The first version also used your consensus as an input; that is gone. The consensus carried the early-season results that version showed, and DROGBA on its own does not reproduce them.</li>
        </ul>
      </S>

      <S title="2. What was tried to improve it (bake-off, tuned only on 2022–23 and confirmed on 2024–26)">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li><strong>Tuning (adopted):</strong> more regularization on the margin model (alpha 30 → 300), weaker in-season shrinkage and longer memory of last season in the ratings. Held-out MAE 12.61 → 12.50 and line-move slope 0.052 → 0.063. Small, but it held up.</li>
          <li><strong>Confidence filter (not adopted):</strong> ranking edges by edge ÷ rating standard error (the McIllece idea) helped on 2022–23 and did nothing on 2024–26. Requiring the scoreboard rating to agree on the side also failed to hold up.</li>
          <li><strong>Better preseason prior (not adopted):</strong> a model predicting a team's full-season strength from last year's rating, returning production, talent, portal, recruiting (and the new-coach flag, once coach history is loaded) beat the old carry-over by about 0.3–0.4 points per team every year. Tried two ways: as extra game-model features (early-season misses got worse), and as each team's starting rating in the walk-forward engines the way SP+/JP+ do. The second does carry the preseason information into the ratings (weeks 1–3 miss 13.4 instead of 13.8 when the preseason features are removed), but with the preseason features already in the game model it adds nothing (12.57 vs 12.47 average miss, same closing-line value), so the default stays carry-over + features. It is built (engine option) and worth re-testing once play-level priors and coaching data exist.</li>
          <li><strong>Play-level data and special teams (kept, add almost nothing):</strong> with garbage-time-filtered success rate, isolated explosiveness and a special-teams rating pulled from CFBD's play data for 2021–26, the walk-forward average miss goes 12.47 → 12.45 and closing-line value +0.39 → +0.41; ATS at 6+ point edges is 53.4% before and 54.0–54.2% after on about 360 bets, well inside the noise. Richer versions (rush/pass splits, explosive-play and turnover rates, separate offense and defense weights, everything at once) land at 12.43–12.47 and +0.37–0.43. CFBD's per-game success rate and PPA already contain what the plays add, so stats-based team quality looks saturated at about a 12.45 miss.</li>
          <li><strong>Schedule spots (not usable):</strong> rest days, byes, short weeks, road trips, night games and last game's margin do not predict covers (every |t| under 1.7 across 3,995 games); the market already prices them. Last week's margin does predict how the line moves afterwards (winners get bet up), but not who covers.</li>
          <li><strong>Where the weakness is:</strong> weeks 1–3, where it misses by about 12.9 against the open's 12.1. The market's preseason view (priors, portal, coaching changes) is stronger than anything built here so far.</li>
        </ul>
      </S>

      <S title="3. Data and its limits">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li>Games, scores and lines for 2021–26. "The open" is one book's number. The default is <strong>FanDuel's</strong> (it opens early and makes the market; other books copy it later in the day), pulled as Sunday 6, 8, 10 and 11am ET snapshots from The Odds API; a game's FanDuel open is its earliest snapshot from the Sunday of its week on. Where FanDuel has no snapshot the model falls back to Bovada's open, or drops the game if you choose "FanDuel only". The closing line is Bovada's from CFBD, which exists for every game. FanDuel coverage is thin before 2024, so most results above are against Bovada's open.</li>
          <li>Per-game advanced stats from CFBD (success rate, explosiveness, PPA per game). These are game-level aggregates: no garbage-time filter, no play-level adjustment, no special teams — the main gaps compared with JP+.</li>
          <li>Preseason inputs: returning production, talent composite, recruiting class, transfer portal net rating. Coaching changes are not in yet (the coach-history table is empty).</li>
        </ul>
      </S>

      <S title="4. Walk-forward rule">
        <p style={P}>
          Every rating used for a game in week W is built only from games in weeks before W of that season, plus last season's final ratings as a prior. Models are graded on seasons they were not fit on. Nothing uses a closing line, a score, or a stat from the game being predicted or any later game.
        </p>
      </S>

      <S title="5. Efficiency ratings">
        <p style={P}>
          For each per-play metric (success rate, explosiveness, PPA) every team gets an offense effect and a defense effect from a ridge regression on that metric's per-game values: metric(team's offense vs opponent) = league average + team's offense effect + opponent's defense effect + a small home term. That adjusts for opponent strength.
          FCS opponents are pooled into one team. The ridge penalty shrinks each effect toward 85% of last season's final effect (not toward zero), so week 1 is mostly last season and the prior is replaced by this season's games as they accumulate. Only each team's own offensive numbers are used, since a game's offense stat for A is the same plays as B's defense stat.
          A separate scoreboard-margin rating (final margins, capped at 28, opponent-adjusted the same way) is built alongside.
        </p>
        <p style={P}>
          <strong>Play-level metrics (in the model; they switch on automatically once the play-level pull has run for two seasons).</strong> From CFBD's play data, each team-game gets a garbage-time-filtered success rate (1st down gains ≥50% of the distance, 2nd ≥70%, 3rd/4th ≥100%, touchdowns count, turnovers never do; plays with the scoring margin beyond 43/37/27/22 points by quarter are dropped) and an isolated explosiveness (the average PPA of the successful plays only, so turnovers and failures can't dilute it). These go through the same opponent-adjusted ridge as the other metrics, weighted by the number of plays behind each game.
          <strong> Special teams:</strong> each team-game's special-teams value is its field goals against what an average kicker makes from those distances, plus the PPA CFBD attaches to its punts and kickoffs when it supplies one; a pairwise rating (home minus away, like the scoreboard rating) turns that into a per-team special-teams rating in points.
        </p>
      </S>

      <S title="6. Margin model">
        <p style={P}>
          A ridge regression, fit on earlier seasons, maps the home-minus-away difference in net efficiency (success rate, explosiveness, PPA), the scoreboard rating difference, the home-field flag and the preseason differences (talent, returning production, portal, recruiting — faded out as the season goes on: weight 3/(3 + weeks played)) to the actual home margin.
          It never sees a betting line, so any disagreement with the market is the model's own view.
        </p>
      </S>

      <S title="7. From a spread to a pick">
        <p style={P}>
          Edge = the model's home margin + the opening spread: the points by which the model says the home side beats the number (capped at ±8 — bigger gaps are rare and more often a stale rating or news than a real mispricing). A pick is a game whose |edge| clears the threshold you set (default 5, JP+'s). The "expected line move" and "expected cover" columns are the shrunk, historical response per point of edge, separately for weeks 1–3 and week 4+; they are deliberately small because most of a disagreement with the market is noise.
        </p>
      </S>

      <S title="8. Tracking">
        <p style={P}>
          The This week tab saves every game's DROGBA number, the open it was compared with, and the pick to the Picks log; the first save for a game is kept so the log is a true record of what the model said while the line was open. The log grades each pick against the open and the close and shows closing-line value.
        </p>
      </S>

      <S title="9. What is not built">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li><strong>Different information, not more of the same:</strong> more team-quality statistics have stopped helping. What could still beat the open is information the market prices late or badly: player-level availability and roster changes (QB, injuries, portal quality — McIllece's player ratings), and how books differ at the open.</li>
          <li>A win-probability ("game control") rating like McIllece's π; injury, QB and weather information; opponent adjustment at the individual-play level (the play pull stores per-game sums, not every play).</li>
        </ul>
        <p style={DIM}>JP+ for reference: 52.4% ATS on all games against the open, 56–58% at a 5+ point edge, 61.6% on a heavily filtered ~19% of games (weakest blind season 53.7%). Those are their figures and I cannot verify them.</p>
      </S>
    </div>
  );
}
