import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow, classOf } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useGameProjectionLocks } from "../lib/api/gameProjectionLocks";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { splitTeamTotal } from "../lib/gameTotals";
import { fairMoneylineFromWinPct } from "../lib/odds";

type Tab = "spread" | "total" | "winpct" | "teamtotals" | "moneyline";
const TABS: { key: Tab; label: string }[] = [
  { key: "spread", label: "Spread" },
  { key: "total", label: "Total" },
  { key: "winpct", label: "Win %" },
  { key: "teamtotals", label: "Team Totals" },
  { key: "moneyline", label: "Moneyline" },
];

function fmtSpread(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function fmtPct(v: number | null): string {
  return v == null ? "–" : `${(v * 100).toFixed(1)}%`;
}
function fmtNum(v: number | null, decimals = 1): string {
  return v == null ? "–" : v.toFixed(decimals);
}
function fmtMl(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${Math.round(v)}`;
}

interface HistoryRow {
  game: GameWithLines;
  frozen: boolean;
  ownAwaySpread: number | null;
  ownAwayWinPct: number | null;
  ownTotal: number | null;
  compareAwaySpread: number | null;
  compareAwayWinPct: number | null;
  currentTotal: number | null;
}

// The Freeze Week / Admin / Public Matchups counterpart for looking
// BACKWARD: what did I actually freeze for a past week, and how does
// that compare to what the model would say about that same game today
// (or as of any later week)? Spread/win%/moneyline all have a genuine
// historical per-week ratings snapshot to recompute against
// (useWeekAccurateRatings), so "as of Week N" is a real reconstruction.
// The Total model doesn't — team_season_stats has no per-week history,
// it's just continuously refreshed — so its comparison column is
// labeled "Current" rather than "as of Week N," since that's honestly
// all it can ever mean.
export default function LockedHistoryPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [compareWeek, setCompareWeek] = useState(1);
  const [weekFilter, setWeekFilter] = useState<number | "all">("all");
  const [tab, setTab] = useState<Tab>("spread");
  const [divisionOnly, setDivisionOnly] = useState(true);
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentSeason = new Date().getFullYear();

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchGamesWithLines(season)
      .then(setGames)
      .catch((err) => setError(err.message ?? "Failed to load games"))
      .finally(() => setLoading(false));
  }, [season]);

  const pastGames = useMemo(() => games.filter((g) => g.week <= compareWeek && g.week >= 1), [games, compareWeek]);
  const ownWeeksNeeded = useMemo(() => Array.from(new Set(pastGames.map((g) => g.week))), [pastGames]);
  const allWeeksNeeded = useMemo(() => Array.from(new Set([...ownWeeksNeeded, compareWeek])), [ownWeeksNeeded, compareWeek]);

  const { byWeek: ratingsByWeek, loading: ratingsLoading } = useWeekAccurateRatings(season, allWeeksNeeded, currentSeason);
  const { locks, loading: locksLoading } = useGameProjectionLocks(season, ownWeeksNeeded);
  const { rows: totalsEngineRows, loading: totalsLoading } = useGameTotalsEngine(season);

  const currentTotalByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of totalsEngineRows) {
      if (r.projection?.projectedTotal != null) map.set(`${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`, r.projection.projectedTotal);
    }
    return map;
  }, [totalsEngineRows]);

  const dataReady = !loading && !ratingsLoading && !locksLoading && !totalsLoading;

  const rows: HistoryRow[] = useMemo(() => {
    if (!dataReady) return [];
    return pastGames
      .filter((g) => {
        if (weekFilter !== "all" && g.week !== weekFilter) return false;
        if (!divisionOnly) return true;
        return classOf(g, "home") === "fbs" && classOf(g, "away") === "fbs";
      })
      .map((g) => {
        const lock = locks[g.id];
        const frozen = !!lock;
        const ownRatings = ratingsByWeek[g.week] ?? {};
        const ownLive = computeRow(g, ownRatings);
        const compareLive = computeRow(g, ratingsByWeek[compareWeek] ?? {});
        return {
          game: g,
          frozen,
          ownAwaySpread: frozen ? lock.my_away_spread : ownLive.projAwaySpread,
          ownAwayWinPct: frozen ? lock.my_away_win_pct : ownLive.projWinPct,
          ownTotal: frozen ? lock.my_total : currentTotalByKey.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null,
          compareAwaySpread: compareLive.projAwaySpread,
          compareAwayWinPct: compareLive.projWinPct,
          currentTotal: currentTotalByKey.get(`${g.week}|${g.home_team}|${g.away_team}`) ?? null,
        };
      })
      .sort((a, b) => (a.game.start_date ?? "").localeCompare(b.game.start_date ?? ""));
  }, [dataReady, pastGames, weekFilter, divisionOnly, locks, ratingsByWeek, compareWeek, currentTotalByKey]);

  const frozenCount = rows.filter((r) => r.frozen).length;

  function renderHeader() {
    switch (tab) {
      case "spread":
        return (
          <tr>
            <th className="th">Week</th>
            <th className="th">Game</th>
            <th className="th th-right">Frozen (own week)</th>
            <th className="th th-right">As of Week {compareWeek}</th>
          </tr>
        );
      case "winpct":
        return (
          <tr>
            <th className="th">Week</th>
            <th className="th">Game</th>
            <th className="th th-right">Frozen Away Win% (own week)</th>
            <th className="th th-right">As of Week {compareWeek}</th>
          </tr>
        );
      case "total":
        return (
          <tr>
            <th className="th">Week</th>
            <th className="th">Game</th>
            <th className="th th-right">Frozen (own week)</th>
            <th className="th th-right">Current</th>
          </tr>
        );
      case "teamtotals":
        return (
          <tr>
            <th className="th">Week</th>
            <th className="th">Game</th>
            <th className="th th-right">Away — Frozen</th>
            <th className="th th-right">Home — Frozen</th>
            <th className="th th-right">Away — Current</th>
            <th className="th th-right">Home — Current</th>
          </tr>
        );
      case "moneyline":
        return (
          <tr>
            <th className="th">Week</th>
            <th className="th">Game</th>
            <th className="th th-right">Away — Frozen</th>
            <th className="th th-right">Home — Frozen</th>
            <th className="th th-right">Away — As of Week {compareWeek}</th>
            <th className="th th-right">Home — As of Week {compareWeek}</th>
          </tr>
        );
    }
  }

  function renderRow(r: HistoryRow) {
    const cellStyle = { padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)" };
    const gameCell = (
      <td style={cellStyle}>
        {!r.frozen && <span title="Not frozen — showing live value" style={{ color: "#e0a030", marginRight: "0.3rem" }}>⚠</span>}
        <TeamLogo team={r.game.away_team} size={16} /> {r.game.away_team} @ <TeamLogo team={r.game.home_team} size={16} /> {r.game.home_team}
      </td>
    );
    switch (tab) {
      case "spread":
        return (
          <tr key={r.game.id}>
            <td style={cellStyle}>{r.game.week}</td>
            {gameCell}
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.ownAwaySpread)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtSpread(r.compareAwaySpread)}</td>
          </tr>
        );
      case "winpct":
        return (
          <tr key={r.game.id}>
            <td style={cellStyle}>{r.game.week}</td>
            {gameCell}
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtPct(r.ownAwayWinPct)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtPct(r.compareAwayWinPct)}</td>
          </tr>
        );
      case "total":
        return (
          <tr key={r.game.id}>
            <td style={cellStyle}>{r.game.week}</td>
            {gameCell}
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtNum(r.ownTotal)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtNum(r.currentTotal)}</td>
          </tr>
        );
      case "teamtotals": {
        const ownSplit = splitTeamTotal(r.ownTotal, r.ownAwaySpread != null ? -r.ownAwaySpread : null);
        const currentSplit = splitTeamTotal(r.currentTotal, r.compareAwaySpread != null ? -r.compareAwaySpread : null);
        return (
          <tr key={r.game.id}>
            <td style={cellStyle}>{r.game.week}</td>
            {gameCell}
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtNum(ownSplit.away)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtNum(ownSplit.home)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtNum(currentSplit.away)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtNum(currentSplit.home)}</td>
          </tr>
        );
      }
      case "moneyline": {
        const ownAwayMl = r.ownAwayWinPct != null ? fairMoneylineFromWinPct(r.ownAwayWinPct) : null;
        const ownHomeMl = r.ownAwayWinPct != null ? fairMoneylineFromWinPct(1 - r.ownAwayWinPct) : null;
        const compAwayMl = r.compareAwayWinPct != null ? fairMoneylineFromWinPct(r.compareAwayWinPct) : null;
        const compHomeMl = r.compareAwayWinPct != null ? fairMoneylineFromWinPct(1 - r.compareAwayWinPct) : null;
        return (
          <tr key={r.game.id}>
            <td style={cellStyle}>{r.game.week}</td>
            {gameCell}
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtMl(ownAwayMl)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtMl(ownHomeMl)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtMl(compAwayMl)}</td>
            <td style={{ ...cellStyle, textAlign: "right" }}>{fmtMl(compHomeMl)}</td>
          </tr>
        );
      }
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Locked History</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0, maxWidth: 700 }}>
        Past games' frozen projections (from their own week — see Freeze Week) next to what the model
        would say now. Spread/Win%/Moneyline recompute against a real historical ratings snapshot for
        the week you pick below. Total/Team Totals can't do that the same way — the total model has no
        per-week snapshot of its own inputs, only a continuously-refreshed current one — so that column
        is labeled "Current," not "as of Week N." A ⚠ next to a game means it was never frozen at all;
        both columns are live for that row.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Season
          <br />
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <label>
          Compare as of week
          <br />
          <input
            type="number"
            min={1}
            max={20}
            value={compareWeek}
            onChange={(e) => setCompareWeek(parseInt(e.target.value, 10) || compareWeek)}
            style={{ width: 70 }}
          />
        </label>
        <label>
          Show week
          <br />
          <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}>
            <option value="all">All weeks (1–{compareWeek})</option>
            {ownWeeksNeeded.map((w) => (
              <option key={w} value={w}>
                Week {w}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input type="checkbox" checked={divisionOnly} onChange={(e) => setDivisionOnly(e.target.checked)} />
          FBS vs FBS only
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {TABS.map((t) => (
          <button key={t.key} className={`mode-btn ${tab === t.key ? "mode-btn-active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!dataReady && <p>Loading…</p>}

      {dataReady && (
        <>
          <p style={{ fontSize: "0.85rem" }}>
            {rows.length} game{rows.length === 1 ? "" : "s"} · {frozenCount} frozen, {rows.length - frozenCount} not frozen (showing live)
          </p>
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem" }}>
              <thead>{renderHeader()}</thead>
              <tbody>{rows.map(renderRow)}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
