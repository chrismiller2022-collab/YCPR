import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { buildRidgeTotalInput, resolveGameOdds } from "../lib/gameTotals";
import { TOTAL_BIAS_OFFSET, Z_CLIP, explainGameTotalRidge } from "../lib/totalModelRidge";
import { TOTAL_BET_THRESHOLD_STDDEV, type EnrichedGameRow } from "../lib/gameTotalsEngine";
import { computeTotalBreakdown, useSeasonPool } from "../lib/totalBreakdown";
import { BreakdownTable, LeaguePoolNote, TeamStatsLine } from "./TotalBreakdownView";

const CELL: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const NUM: CSSProperties = { ...CELL, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const P: CSSProperties = { fontSize: "0.85rem", lineHeight: 1.55, color: "var(--chalk)", margin: "0.4rem 0" };
const H: CSSProperties = { margin: "1.4rem 0 0.3rem", fontSize: "1rem" };

function f(v: number | null | undefined, d = 2): string {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(d);
}
function sgn(v: number, d = 2): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 style={H}>{title}</h3>
      {children}
    </>
  );
}

export function TotalsMethodologyTab({ rows, season }: { rows: EnrichedGameRow[]; season: number }) {
  const { teamInputs, league } = useSeasonPool(season);

  // Worked example: the first upcoming FBS-vs-FBS game that has a posted market total, so
  // every input is real and the market-total step isn't falling back to the training mean.
  const example = useMemo(() => {
    if (!league) return null;
    const candidates = rows
      .filter((r) => !r.game.completed && r.odds.vegasTotal != null && r.game.homeClassification === "fbs" && r.game.awayClassification === "fbs")
      .sort((a, b) => a.game.week - b.game.week || (a.game.startDate ?? "").localeCompare(b.game.startDate ?? ""));
    const row = candidates[0];
    if (!row) return null;
    const home = teamInputs[row.game.homeTeam];
    const away = teamInputs[row.game.awayTeam];
    if (!home || !away) return null;
    const ctx = { homeFlag: row.game.neutralSite ? 0.5 : 1.0, homeRestDays: 7, awayRestDays: 7 };
    return { row, home, away, ctx, breakdown: explainGameTotalRidge(buildRidgeTotalInput(home, away, league, row.odds, ctx)) };
  }, [rows, teamInputs, league]);

  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>Totals model methodology</h2>
      <p style={P}>
        One number comes out of this model per game: a projected combined score. Everything below is the full path from raw data to that number, the order
        the code runs it in. The model is a Ridge regression — a linear formula where each input is converted to a z-score, multiplied by a fixed weight
        (coefficient), and added up. There is no hidden second stage; the "Points" column in the worked example at the bottom adds up exactly to the
        projected total.
      </p>

      <Section title="1. The 12 inputs">
        <p style={P}>Eight are team-quality numbers from CFBD's advanced stats, one is the venue, two are rest, and one is the betting market.</p>
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li>
            <strong>Offense and defense PPA</strong> (predicted points added per play) for both teams. Offense PPA is how much value the offense adds per play;
            defense PPA is how much value it <em>allows</em> (lower = better defense). These are the strongest team inputs: about 2.3–2.9 points per SD each.
          </li>
          <li>
            <strong>Offense and defense explosiveness</strong> (how big the successful plays are) for both teams. Smaller weights: about 0.5–1.3 points per SD.
          </li>
          <li>
            <strong>Home flag</strong>: 1.0 for a true home game, 0.5 for a neutral site. Worth about +0.5 points per SD of the flag.
          </li>
          <li>
            <strong>Rest days</strong> before the game for each team (7 if it is the team's first tracked game). Effectively zero weight (+0.04 and −0.09 points
            per SD) — the model mostly ignores it.
          </li>
          <li>
            <strong>Market total</strong> (the Vegas closing total, or the opening total if no close is posted). The single largest weight: 2.32 points per SD, and one
            SD of the market is 7.54 points, so every 1 point of Vegas total moves the projection about 0.31 points. This is why the model sits close to Vegas
            — it is partly anchored to it by design. With no line posted it falls back to the training average (53.3).
          </li>
        </ul>
      </Section>

      <Section title="2. How the model was trained">
        <p style={P}>
          Trained once, offline, on 3,730 completed FBS-vs-FBS games from 2021–2025 (2020 excluded). For each game the target is the actual combined score; the inputs
          are the two teams' end-of-season CFBD advanced stats, venue, rest, and the market total. The method copies gmalbert/college-football-predictions: standardize
          every input (subtract the training mean, divide by the training SD), then fit Ridge regression with alpha = 10. Ridge shrinks the weights a little so correlated
          inputs (e.g. both teams' PPA) don't produce wild opposite-signed coefficients. The fitted intercept, means, SDs and coefficients are frozen as constants in the
          code; there is no live retraining. The run date was 2026-08-22.
        </p>
        <p style={P}>Accuracy in 5-fold cross-validation (games held out from the fit), as RMSE in points:</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={CELL}>Predictor</th>
                <th style={NUM}>RMSE</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={CELL}>This model</td><td style={NUM}>15.05</td></tr>
              <tr><td style={CELL}>Vegas closing total alone</td><td style={NUM}>15.74</td></tr>
              <tr><td style={CELL}>Always guess the average total</td><td style={NUM}>16.93</td></tr>
            </tbody>
          </table>
        </div>
        <p style={P}>
          So the edge over Vegas is real but modest: about 0.7 points of RMSE. Game totals are very noisy — even the best predictor misses by 15 points on a typical
          game — so any single projection is a lean, not a prediction you can count on. The value comes from betting only the games where the model and the market
          disagree by a lot (see step 6), and the sample behind that is still small.
        </p>
      </Section>

      <Section title="3. The prior-season blend (before the model ever sees a number)">
        <p style={P}>
          Early in a season a team has played one or two games, and CFBD's advanced stats from that tiny sample are mostly noise. So each team's four stats are first
          blended with last season's final numbers: weight = games played ÷ 4 on this season, the rest on last season. By a team's 4th game it is 100% current season. A
          team with no prior season (new FBS program) uses current numbers only; a team with no current data yet uses last season only.
        </p>
      </Section>

      <Section title="4. Re-standardizing within the season, then clipping">
        <p style={P}>
          The weights were fit on <em>full-season</em> stats from 2021–25. Early-season stats are shifted and more spread out: in 2026 the average defensive PPA was
          0.06 against a training mean of 0.16 (about 1.2 training SDs), and the spread was 0.12 against 0.08. Fed straight in, the model saw two elite defenses in
          nearly every game and projected totals about 3 points under Vegas, with absurd outliers (one game at 16.7).
        </p>
        <p style={P}>
          The fix: for each of the eight team-stat inputs, compute the z-score against <em>this season's</em> FBS pool (this season's mean and SD), clip it to ±{Z_CLIP} SD,
          and then re-express it on the training scale (training mean + z × training SD). That puts a typical 2026 team at a typical training-set value, and an elite 2026
          defense at an elite training-set value, no matter how early in the year it is. It removes the shift without pulling the projection toward Vegas. The re-standardization
          applies only to the eight team stats — venue, rest and the market total are used as given.
        </p>
      </Section>

      <Section title="5. The calculation and the calibration offset">
        <p style={P}>
          Projected total = intercept (53.73) + Σ over the 12 inputs of [ (value used − training mean) ÷ training SD × coefficient ], then {sgn(TOTAL_BIAS_OFFSET, 1)} points
          of calibration. A missing input is replaced by its training mean, which contributes zero points.
        </p>
        <p style={P}>
          <strong>Why the {sgn(TOTAL_BIAS_OFFSET, 1)} offset:</strong> after step 4, the 2026 backtest (271 finished FBS games through week 5) averaged 1.4 points over the
          Vegas close while the games themselves averaged only 0.5 over, so every unlocked game leaned Over. The offset is a plain constant shift of the output. It does not
          change which games the model likes more or less, or how far apart any two projections are. On the same games:
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={NUM}>Offset</th>
                <th style={NUM}>Avg model − Vegas</th>
                <th style={NUM}>Avg miss vs actual (MAE)</th>
                <th style={NUM}>Games projected Over Vegas</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={NUM}>0 (before)</td><td style={NUM}>+1.38</td><td style={NUM}>10.80</td><td style={NUM}>58%</td></tr>
              <tr><td style={NUM}>−1</td><td style={NUM}>+0.38</td><td style={NUM}>10.67</td><td style={NUM}>51%</td></tr>
              <tr style={{ fontWeight: 600 }}><td style={NUM}>−2 (used)</td><td style={NUM}>−0.62</td><td style={NUM}>10.62</td><td style={NUM}>46%</td></tr>
              <tr><td style={NUM}>−3</td><td style={NUM}>−1.62</td><td style={NUM}>10.62</td><td style={NUM}>40%</td></tr>
              <tr><td style={NUM}>−4</td><td style={NUM}>−2.62</td><td style={NUM}>10.69</td><td style={NUM}>31%</td></tr>
            </tbody>
          </table>
        </div>
        <p style={P}>
          Honest caveat: the offset was chosen on those same 271 games, from five weeks of one season, so it is calibrated in-sample. An offset of −1 would make the model
          unbiased against actual results; −2 deliberately leans Under. The accuracy table is nearly flat from −2 to −3, so there is no accuracy cost, but the right number
          should be re-checked every few weeks. Locked games keep the projection they were locked with and are not affected.
        </p>
      </Section>

      <Section title="6. From projection to a bet">
        <p style={P}>
          "Amount off" is my total − the Vegas total. A bet counts as <strong>filtered</strong> when |amount off| is at least {TOTAL_BET_THRESHOLD_STDDEV} standard
          deviations of all those amounts across the pool (the same bar in Totals History and the weekly report; 2020 is excluded). Over if my total is higher, Under if
          lower. Team totals are derived from the game total plus the spread: the favorite's score = (total − |spread|) ÷ 2 + |spread|, the underdog's = (total − |spread|) ÷ 2,
          each floored at 0, because the total model and the spread (power ratings) are computed independently and are not reconciled.
        </p>
      </Section>

      <Section title="7. Known limits">
        <ul style={{ ...P, paddingLeft: "1.2rem" }}>
          <li>Trained on end-of-season stats but applied to season-to-date stats. Re-standardizing fixes the average level, not the noise in a 4–5 game sample.</li>
          <li>Anchored to the market total by design (about 0.31 points per Vegas point). Where Vegas is wrong in a way the stats can't see — injuries, weather, a QB change — the model cannot see it either.</li>
          <li>No pace or tempo input, no weather, no injuries, no opponent adjustments beyond what CFBD's PPA already includes.</li>
          <li>RMSE edge over Vegas is about 0.7 points; treat the small disagreements as noise and only the filtered ones as leans.</li>
        </ul>
      </Section>

      <Section title="8. Worked example (live data)">
        {example && league ? (
          <>
            <p style={P}>
              Week {example.row.game.week}: <strong>{example.row.game.awayTeam}</strong> at <strong>{example.row.game.homeTeam}</strong>
              {example.row.game.neutralSite ? " (neutral site)" : ""}. Market total {f(example.row.odds.vegasTotal, 1)}. Rest days set to 7 each for this illustration.
            </p>
            <p style={{ ...P, color: "var(--chalk-dim)" }}>
              <TeamStatsLine label={example.row.game.homeTeam} t={example.home} />
              <TeamStatsLine label={example.row.game.awayTeam} t={example.away} />
            </p>
            <LeaguePoolNote league={league} />
            <BreakdownTable b={example.breakdown} withStats />
            <p style={P}>
              Projected total {f(example.breakdown.total, 1)} vs market {f(example.row.odds.vegasTotal, 1)} → amount off{" "}
              {sgn(example.breakdown.total - (example.row.odds.vegasTotal ?? 0), 1)}.
            </p>
          </>
        ) : (
          <p style={{ ...P, color: "var(--chalk-dim)" }}>Loading an upcoming game with a posted total…</p>
        )}
      </Section>
    </div>
  );
}

export function HypotheticalTotalTab({ season }: { season: number }) {
  const { teamInputs, league, loading } = useSeasonPool(season);
  const teams = useMemo(
    () =>
      Object.values(teamInputs)
        .filter((t) => t.games > 0 || t.offPpa != null)
        .map((t) => t.team)
        .sort((a, b) => a.localeCompare(b)),
    [teamInputs]
  );
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [site, setSite] = useState<"home" | "neutral">("home");
  const [market, setMarket] = useState("");
  const [homeRest, setHomeRest] = useState("7");
  const [awayRest, setAwayRest] = useState("7");

  const result = useMemo(() => {
    const m = market.trim() === "" ? null : Number(market);
    const r = computeTotalBreakdown(teamInputs, league, {
      home: homeTeam,
      away: awayTeam,
      marketTotal: m != null && Number.isFinite(m) ? m : null,
      neutral: site === "neutral",
      homeRest: Number(homeRest) || 7,
      awayRest: Number(awayRest) || 7,
    });
    return r ? { ...r, marketTotal: market.trim() === "" || !Number.isFinite(Number(market)) ? null : Number(market) } : null;
  }, [teamInputs, league, homeTeam, awayTeam, site, market, homeRest, awayRest]);

  const sel: CSSProperties = { marginRight: "0.6rem", marginBottom: "0.6rem" };
  return (
    <div style={{ maxWidth: 1000 }}>
      <h2 style={{ marginTop: 0 }}>Hypothetical matchup total</h2>
      <p style={P}>
        Pick any two teams and project a total from their current {season} stats (blended with last season while a team has fewer than 4 games), using exactly the same
        model, re-standardization and offset as the real projections. Leave the market total blank if there is no line — the model then uses its training-average
        market (53.3), which pulls a hypothetical toward the middle; entering a realistic line gives a more meaningful number.
      </p>
      {loading ? (
        <p style={{ ...P, color: "var(--chalk-dim)" }}>Loading team stats…</p>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
            <select className="filter" value={awayTeam} onChange={(e) => setAwayTeam(e.target.value)} style={sel}>
              <option value="">Away team…</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span style={{ ...sel, color: "var(--chalk-dim)" }}>at</span>
            <select className="filter" value={homeTeam} onChange={(e) => setHomeTeam(e.target.value)} style={sel}>
              <option value="">Home team…</option>
              {teams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select className="filter" value={site} onChange={(e) => setSite(e.target.value as "home" | "neutral")} style={sel}>
              <option value="home">True home game</option>
              <option value="neutral">Neutral site</option>
            </select>
            <input className="filter" placeholder="Market total (optional)" value={market} onChange={(e) => setMarket(e.target.value)} style={{ ...sel, width: "11rem" }} />
            <input className="filter" title="Home rest days" placeholder="Home rest" value={homeRest} onChange={(e) => setHomeRest(e.target.value)} style={{ ...sel, width: "6rem" }} />
            <input className="filter" title="Away rest days" placeholder="Away rest" value={awayRest} onChange={(e) => setAwayRest(e.target.value)} style={{ ...sel, width: "6rem" }} />
          </div>
          {homeTeam && awayTeam && homeTeam === awayTeam && <p style={{ ...P, color: "crimson" }}>Pick two different teams.</p>}
          {result && league && (
            <>
              <p style={{ ...P, fontSize: "1.1rem" }}>
                Projected total: <strong>{f(result.breakdown.total, 1)}</strong>
                {result.marketTotal != null && (
                  <span style={{ color: "var(--chalk-dim)" }}>
                    {" "}
                    (market {f(result.marketTotal, 1)}, amount off {sgn(result.breakdown.total - result.marketTotal, 1)})
                  </span>
                )}
              </p>
              {result.marketTotal != null && (
                <p style={{ ...P, color: "var(--chalk-dim)" }}>
                  With no market total entered, the same stats give {f(result.noMarket.total, 1)}.
                </p>
              )}
              <p style={{ ...P, color: "var(--chalk-dim)" }}>
                <TeamStatsLine label={homeTeam} t={result.home} />
                <TeamStatsLine label={awayTeam} t={result.away} />
              </p>
              <BreakdownTable b={result.breakdown} withStats />
              <LeaguePoolNote league={league} />
            </>
          )}
        </>
      )}
    </div>
  );
}
