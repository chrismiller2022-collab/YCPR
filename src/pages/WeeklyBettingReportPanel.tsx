import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameTotalsEngine, poolStdDevForTotal, buildTeamSplitBetRows, type TeamSplitBetRow } from "../lib/gameTotalsEngine";
import { filterRowsByDivision } from "./GameTotalsAdminPanel";
import { formatProjectedScore } from "../lib/gameTotals";
import { buildMlRowsFromLiveRatingsBillR, type MlGameRow } from "../lib/moneylineBetHistory";
import { DEFAULT_CUSTOM_PARAMS } from "../lib/betHistory";

// ---------------------------------------------------------------------
// Weekly Betting Report — admin-only consolidation of every bet signal
// already computed elsewhere on the site (Matchups' spread bets, the
// Totals page's own std-dev flagging, Bill R moneyline EV) into one
// page: "here's everything I actually have a bet on this week," plus a
// "To Watch" list of games close enough to a threshold that a small
// line move would trigger one. See chat for the full reasoning — this
// is a pure aggregation layer, not a new bet-detection system; every
// threshold here is either read directly from existing code
// (DEFAULT_CUSTOM_PARAMS for spreads, computeRow's own betTeam/
// betCategory/betSizePct) or Chris's own explicitly-stated number
// (1.0 std dev for totals — the exact rule already wired into the
// Weekly Image Dump's Matchup cards, not whatever filterThresholdMultiplier
// the Totals admin page happens to be configured to).
//
// Team Totals bets use the same 1.0 std dev threshold as game totals,
// per Chris's explicit instruction once he'd settled on a number.
// Moneyline bets use computeMlRow's "Every Game" rule (any positive EV side, via Bill R) since that's the only moneyline
// bet definition that exists anywhere in this codebase — Chris didn't
// specify a different one, so this is flagged as an assumption in chat
// rather than silently treated as definitely correct.
// ---------------------------------------------------------------------

const FILTER_THRESHOLD = DEFAULT_CUSTOM_PARAMS.filterThreshold; // 6 points
const SIGMA_THRESHOLD = DEFAULT_CUSTOM_PARAMS.sigmaThreshold; // 0.4
const SIGMA_DIVISOR = DEFAULT_CUSTOM_PARAMS.sigmaDivisor; // 15.7
const NWFB_POINTS_THRESHOLD = SIGMA_THRESHOLD * SIGMA_DIVISOR; // ~6.28 points, for display/reverse-math
const SPREAD_WATCH_MARGIN_POINTS = 2; // "within 2 points of being 6 off"
const SPREAD_WATCH_MARGIN_SIGMA = 0.1; // "within 0.1 of being above 0.4 sigma"
const TOTAL_BET_THRESHOLD_STDDEV = 1.0; // Chris's explicit number, twice now
const TOTAL_WATCH_MARGIN_STDDEV = 0.5; // "within 0.5 of being 1 std dev off"

function classOf(g: GameWithLines, side: "home" | "away"): "fbs" | "fcs" | "other" {
  const v = (side === "home" ? g.home_classification : g.away_classification)?.toLowerCase();
  return v === "fbs" ? "fbs" : v === "fcs" ? "fcs" : "other";
}

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  if (v === 0) return "PK";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

function fmtTotal(v: number | null): string {
  return v == null ? "–" : v.toFixed(1);
}

function fmtMoneyline(v: number | null): string {
  if (v == null) return "–";
  return v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`;
}

const cellStyle: CSSProperties = { padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--hash)" };

interface SpreadBetRow {
  game: GameWithLines;
  vegasAwaySpread: number;
  myAwaySpread: number;
  myProjScore: string | null;
  betTeam: "away" | "home";
  betCategory: string;
  betSizePct: number | null;
}

interface SpreadWatchRow {
  game: GameWithLines;
  vegasAwaySpread: number;
  myAwaySpread: number;
  myProjScore: string | null;
  nearFiltered: boolean;
  nearNwfb: boolean;
  vegasLineNeededFiltered: number | null;
  vegasLineNeededNwfb: number | null;
}

interface TotalBetRow {
  game: GameWithLines;
  vegasTotal: number;
  myTotal: number;
  myProjScore: string | null;
  stdDevOff: number;
  call: "Over" | "Under";
}

interface TotalWatchRow {
  game: GameWithLines;
  vegasTotal: number;
  myTotal: number;
  myProjScore: string | null;
  stdDevOff: number;
  vegasTotalNeeded: number;
}

interface MoneylineBetRow {
  row: MlGameRow;
  myProjScore: string | null;
}

export default function WeeklyBettingReportPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGamesWithLines(season, week)
      .then((rows) => {
        if (!cancelled) setGames(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, [week], season);
  const ratings = ratingsByWeek[week] ?? {};

  const { rows: totalsEngineRows } = useGameTotalsEngine(season);
  const projTotalByGame = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsEngineRows) {
      if (r.projection?.projectedTotal != null) {
        map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
      }
    }
    return map;
  }, [totalsEngineRows]);
  const fbsTotalPoolStd = useMemo(() => poolStdDevForTotal(filterRowsByDivision(totalsEngineRows, "FBS")), [totalsEngineRows]);
  const fcsTotalPoolStd = useMemo(() => poolStdDevForTotal(filterRowsByDivision(totalsEngineRows, "FCS")), [totalsEngineRows]);

  // --- Spreads (Filtered / WFB / NWFB — computeRow's own combined betTeam) ---
  const computedGames = useMemo(
    () => games.map((g) => ({ game: g, computed: computeRow(g, ratings) })).filter((r) => r.computed.vegasAwaySpread != null),
    [games, ratings]
  );

  const spreadBets: SpreadBetRow[] = useMemo(
    () =>
      computedGames
        .filter((r) => r.computed.betTeam != null)
        .map((r) => {
          const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
          return {
            game: r.game,
            vegasAwaySpread: r.computed.vegasAwaySpread!,
            myAwaySpread: r.computed.projAwaySpread!,
            myProjScore: formatProjectedScore(myTotal, r.computed.projAwaySpread != null ? -r.computed.projAwaySpread : null, r.game.away_team, r.game.home_team),
            betTeam: r.computed.betTeam!,
            betCategory: r.computed.betCategory ?? "–",
            betSizePct: r.computed.betSizePct,
          };
        }),
    [computedGames, projTotalByGame, week]
  );

  const spreadWatch: SpreadWatchRow[] = useMemo(
    () =>
      computedGames
        .filter((r) => r.computed.betTeam == null && r.computed.absAmountOff != null)
        .map((r) => {
          const absOff = r.computed.absAmountOff!;
          const sigmaOff = r.computed.sigmaOff;
          const nearFiltered = absOff >= FILTER_THRESHOLD - SPREAD_WATCH_MARGIN_POINTS && absOff < FILTER_THRESHOLD;
          const nearNwfb = sigmaOff != null && sigmaOff >= SIGMA_THRESHOLD - SPREAD_WATCH_MARGIN_SIGMA && sigmaOff < SIGMA_THRESHOLD;
          if (!nearFiltered && !nearNwfb) return null;
          const myLine = r.computed.projAwaySpread!;
          const vegasLine = r.computed.vegasAwaySpread!;
          const dir = Math.sign(myLine - vegasLine) || 1;
          const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
          return {
            game: r.game,
            vegasAwaySpread: vegasLine,
            myAwaySpread: myLine,
            myProjScore: formatProjectedScore(myTotal, -myLine, r.game.away_team, r.game.home_team),
            nearFiltered,
            nearNwfb,
            vegasLineNeededFiltered: nearFiltered ? myLine - dir * FILTER_THRESHOLD : null,
            vegasLineNeededNwfb: nearNwfb ? myLine - dir * NWFB_POINTS_THRESHOLD : null,
          };
        })
        .filter((r): r is SpreadWatchRow => r != null),
    [computedGames, projTotalByGame, week]
  );

  // --- Totals (1+ std dev off Vegas, per-division pool) ---
  const totalGames = useMemo(() => {
    return games
      .map((g) => {
        const vegasTotal = totalsEngineRows.find((r) => r.game.week === week && r.game.homeTeam === g.home_team && r.game.awayTeam === g.away_team)?.odds
          .vegasTotal;
        const myTotal = projTotalByGame.get(`${week}|${g.home_team}|${g.away_team}`) ?? null;
        const isFbs = classOf(g, "home") === "fbs" && classOf(g, "away") === "fbs";
        const isFcs = classOf(g, "home") === "fcs" && classOf(g, "away") === "fcs";
        const poolStd = isFcs ? fcsTotalPoolStd : fbsTotalPoolStd; // cross-divisional uses the FBS pool, matching the Image Dump's own precedent
        const stdDevOff = myTotal != null && vegasTotal != null && poolStd !== 0 ? (myTotal - vegasTotal) / poolStd : null;
        return { game: g, vegasTotal: vegasTotal ?? null, myTotal, stdDevOff, isFbs, isFcs };
      })
      .filter((r) => r.vegasTotal != null && r.myTotal != null && r.stdDevOff != null);
  }, [games, totalsEngineRows, projTotalByGame, week, fbsTotalPoolStd, fcsTotalPoolStd]);

  const totalBets: TotalBetRow[] = useMemo(
    () =>
      totalGames
        .filter((r) => Math.abs(r.stdDevOff!) >= TOTAL_BET_THRESHOLD_STDDEV)
        .map((r) => ({
          game: r.game,
          vegasTotal: r.vegasTotal!,
          myTotal: r.myTotal!,
          myProjScore: formatProjectedScore(
            r.myTotal,
            computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread != null
              ? -computedGames.find((c) => c.game.id === r.game.id)!.computed.projAwaySpread!
              : null,
            r.game.away_team,
            r.game.home_team
          ),
          stdDevOff: r.stdDevOff!,
          call: r.stdDevOff! > 0 ? "Over" : "Under",
        })),
    [totalGames, computedGames]
  );

  const totalWatch: TotalWatchRow[] = useMemo(
    () =>
      totalGames
        .filter((r) => Math.abs(r.stdDevOff!) >= TOTAL_WATCH_MARGIN_STDDEV && Math.abs(r.stdDevOff!) < TOTAL_BET_THRESHOLD_STDDEV)
        .map((r) => {
          const isFcs = r.isFcs;
          const poolStd = isFcs ? fcsTotalPoolStd : fbsTotalPoolStd;
          const dir = Math.sign(r.stdDevOff!) || 1;
          return {
            game: r.game,
            vegasTotal: r.vegasTotal!,
            myTotal: r.myTotal!,
            myProjScore: formatProjectedScore(
              r.myTotal,
              computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread != null
                ? -computedGames.find((c) => c.game.id === r.game.id)!.computed.projAwaySpread!
                : null,
              r.game.away_team,
              r.game.home_team
            ),
            stdDevOff: r.stdDevOff!,
            vegasTotalNeeded: r.myTotal! - dir * TOTAL_BET_THRESHOLD_STDDEV * poolStd,
          };
        }),
    [totalGames, fbsTotalPoolStd, fcsTotalPoolStd, computedGames]
  );

  // --- Team Totals (1+ std dev off Vegas, per-team split) ---
  // Same 1.0 std dev threshold as game totals — Chris's own explicit
  // instruction ("use 1 std dev for team totals as well") once he'd
  // settled on a number, unblocking what was previously left out here
  // entirely. buildTeamSplitBetRows computes its own pool std dev from
  // whatever rows are passed in, so the full season's division-filtered
  // rows go in (for a stable pool), then the result is filtered down to
  // this week for display — same two-step pattern as the game-level
  // totals above. Cross-divisional games are excluded here, same as the
  // Totals admin page's own Team Totals tab (filterRowsByDivision
  // requires both teams match one division) — not a new gap introduced
  // by this report.
  const fbsTeamTotalBetRows = useMemo(() => buildTeamSplitBetRows(filterRowsByDivision(totalsEngineRows, "FBS"), TOTAL_BET_THRESHOLD_STDDEV), [totalsEngineRows]);
  const fcsTeamTotalBetRows = useMemo(() => buildTeamSplitBetRows(filterRowsByDivision(totalsEngineRows, "FCS"), TOTAL_BET_THRESHOLD_STDDEV), [totalsEngineRows]);
  const teamTotalBets: (TeamSplitBetRow & { myProjScore: string | null })[] = useMemo(() => {
    return [...fbsTeamTotalBetRows, ...fcsTeamTotalBetRows]
      .filter((r) => r.row.game.week === week && r.isFiltered)
      .map((r) => {
        const spread = computedGames.find((c) => c.game.away_team === r.row.game.awayTeam && c.game.home_team === r.row.game.homeTeam)?.computed
          .projAwaySpread;
        return {
          ...r,
          myProjScore: formatProjectedScore(r.myTeamTotal, spread != null ? -spread : null, r.row.game.awayTeam, r.row.game.homeTeam),
        };
      });
  }, [fbsTeamTotalBetRows, fcsTeamTotalBetRows, week, computedGames]);

  // --- Moneyline (Bill R Method, any positive-EV side — see file header) ---
  const moneylineBets: MoneylineBetRow[] = useMemo(() => {
    const mlRows = buildMlRowsFromLiveRatingsBillR(games, ratingsByWeek);
    return mlRows
      .filter((r) => r.betSide != null)
      .map((r) => {
        const myTotal = projTotalByGame.get(`${week}|${r.game.home_team}|${r.game.away_team}`) ?? null;
        const spread = computedGames.find((c) => c.game.id === r.game.id)?.computed.projAwaySpread ?? null;
        return { row: r, myProjScore: formatProjectedScore(myTotal, spread != null ? -spread : null, r.game.away_team, r.game.home_team) };
      });
  }, [games, ratingsByWeek, projTotalByGame, week, computedGames]);

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Weekly Betting Report</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Run this after syncing this week's games/lines and pushing live ratings. Pulls together every bet already
        flagged elsewhere on the site (Spreads, Totals, Moneyline) plus games close enough to a threshold to watch as
        lines move.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10))} style={{ width: 80 }} />
        </label>
        <label>
          Week <input type="number" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10))} style={{ width: 60 }} min={0} />
        </label>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className="section-label">Spread Bets ({spreadBets.length})</div>
          {spreadBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No spread bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Line</th>
                  <th className="th th-right">My Line</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Bet</th>
                  <th className="th">Category</th>
                  <th className="th th-right">Bet Size</th>
                </tr>
              </thead>
              <tbody>
                {spreadBets.map((r) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtSpread(r.vegasAwaySpread)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtSpread(r.myAwaySpread)}
                    </td>
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={cellStyle}>
                      <TeamLogo team={r.betTeam === "away" ? r.game.away_team : r.game.home_team} size={16} />
                    </td>
                    <td style={cellStyle}>{r.betCategory}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.betSizePct != null ? `${(r.betSizePct * 100).toFixed(1)}%` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">Total Bets ({totalBets.length})</div>
          {totalBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No total bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Total</th>
                  <th className="th th-right">My Total</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Call</th>
                  <th className="th th-right">Std Dev Off</th>
                </tr>
              </thead>
              <tbody>
                {totalBets.map((r) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtTotal(r.vegasTotal)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtTotal(r.myTotal)}
                    </td>
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={cellStyle}>{r.call}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.stdDevOff.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">Team Total Bets ({teamTotalBets.length})</div>
          {teamTotalBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No team total bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Team</th>
                  <th className="th">Opponent</th>
                  <th className="th th-right">Vegas TT</th>
                  <th className="th th-right">My TT</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Call</th>
                  <th className="th th-right">Std Dev Off</th>
                </tr>
              </thead>
              <tbody>
                {teamTotalBets.map((r) => (
                  <tr key={`${r.row.game.id}-${r.team}`}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.team} size={16} /> {r.team}
                    </td>
                    <td style={cellStyle}>{r.isHome ? r.row.game.awayTeam : r.row.game.homeTeam}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.vegasTeamTotal)}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{fmtTotal(r.myTeamTotal)}</td>
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={cellStyle}>{r.call}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>{r.stdDevOff?.toFixed(2) ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">Moneyline Bets ({moneylineBets.length})</div>
          {moneylineBets.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>No moneyline bets flagged this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas ML</th>
                  <th className="th th-right">My ML</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Bet</th>
                  <th className="th th-right">EV</th>
                </tr>
              </thead>
              <tbody>
                {moneylineBets.map(({ row: r, myProjScore }) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtMoneyline(r.vegasAwayMoneyline)} / {fmtMoneyline(r.vegasHomeMoneyline)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtMoneyline(r.myAwayMoneyline)} / {fmtMoneyline(r.myHomeMoneyline)}
                    </td>
                    <td style={cellStyle}>{myProjScore ?? "–"}</td>
                    <td style={cellStyle}>
                      <TeamLogo team={r.betSide === "away" ? r.game.away_team : r.game.home_team} size={16} />
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.betEv != null ? `${r.betEv.toFixed(1)}%` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">To Watch — Spreads ({spreadWatch.length})</div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
            Within {SPREAD_WATCH_MARGIN_POINTS} points of the {FILTER_THRESHOLD}-point Filtered threshold, or within{" "}
            {SPREAD_WATCH_MARGIN_SIGMA} sigma of the {SIGMA_THRESHOLD}-sigma NWFB threshold. "Vegas line to watch for"
            is the line that would trigger that specific bet, holding your own line fixed.
          </p>
          {spreadWatch.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem", marginBottom: "1.5rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Line</th>
                  <th className="th th-right">My Line</th>
                  <th className="th">My Proj Score</th>
                  <th className="th">Near</th>
                  <th className="th th-right">Watch For</th>
                </tr>
              </thead>
              <tbody>
                {spreadWatch.map((r) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtSpread(r.vegasAwaySpread)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtSpread(r.myAwaySpread)}
                    </td>
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={cellStyle}>
                      {r.nearFiltered && "Filtered"} {r.nearFiltered && r.nearNwfb && "/"} {r.nearNwfb && "NWFB"}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.nearFiltered && `${fmtSpread(r.vegasLineNeededFiltered)}+ (Filtered)`}
                      {r.nearFiltered && r.nearNwfb && <br />}
                      {r.nearNwfb && `${fmtSpread(r.vegasLineNeededNwfb)}+ (NWFB)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-label">To Watch — Totals ({totalWatch.length})</div>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.78rem", marginTop: 0 }}>
            Within {TOTAL_WATCH_MARGIN_STDDEV} std dev of the {TOTAL_BET_THRESHOLD_STDDEV}-std-dev threshold.
          </p>
          {totalWatch.length === 0 ? (
            <p style={{ color: "var(--chalk-dim)" }}>Nothing close this week.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
              <thead>
                <tr>
                  <th className="th">Game</th>
                  <th className="th th-right">Vegas Total</th>
                  <th className="th th-right">My Total</th>
                  <th className="th">My Proj Score</th>
                  <th className="th th-right">Std Dev Off</th>
                  <th className="th th-right">Watch For</th>
                </tr>
              </thead>
              <tbody>
                {totalWatch.map((r) => (
                  <tr key={r.game.id}>
                    <td style={cellStyle}>
                      <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtTotal(r.vegasTotal)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {fmtTotal(r.myTotal)}
                    </td>
                    <td style={cellStyle}>{r.myProjScore ?? "–"}</td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.stdDevOff.toFixed(2)}
                    </td>
                    <td style={{ ...cellStyle, textAlign: "right" }}>
                      {r.stdDevOff > 0 ? `${fmtTotal(r.vegasTotalNeeded)}+ (Over)` : `${fmtTotal(r.vegasTotalNeeded)}- (Under)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
