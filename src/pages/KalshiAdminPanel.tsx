import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SortHeader from "../components/SortHeader";
import { spreadToWinPct } from "../lib/odds";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { fetchKalshiCfbMarkets, type KalshiGame } from "../lib/api/kalshi";
import { matchKalshiGames, type KalshiMatch } from "../lib/kalshiMatch";
import { SeasonPicker, DivisionPicker, filterRowsByDivision } from "./GameTotalsAdminPanel";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };

function fmt(v: number | null | undefined, digits = 1): string {
  return v == null || Number.isNaN(v) ? "–" : v.toFixed(digits);
}
function pct(v: number | null): string {
  return v == null ? "–" : `${(v * 100).toFixed(1)}%`;
}
function fmtEdge(v: number | null): string {
  if (v == null) return "–";
  const pts = v * 100;
  return `${pts > 0 ? "+" : ""}${pts.toFixed(1)}`;
}
function dateLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}
function kickoffLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface Row extends KalshiMatch {
  myHomeWinPct: number | null;
  myAwayWinPct: number | null;
}

type SortKey = "week" | "date" | "awayTeam" | "awayMine" | "awayKalshi" | "awayEdge" | "homeTeam" | "homeMine" | "homeKalshi" | "homeEdge" | "volume";

function sortValue(r: Row, key: SortKey): number | string {
  switch (key) {
    case "week":
      return r.game.game.week;
    case "date":
      return r.game.game.startDate ?? "";
    case "awayTeam":
      return r.game.game.awayTeam;
    case "awayMine":
      return r.myAwayWinPct ?? -Infinity;
    case "awayKalshi":
      return r.awayProb ?? -Infinity;
    case "awayEdge":
      return r.myAwayWinPct != null && r.awayProb != null ? r.myAwayWinPct - r.awayProb : -Infinity;
    case "homeTeam":
      return r.game.game.homeTeam;
    case "homeMine":
      return r.myHomeWinPct ?? -Infinity;
    case "homeKalshi":
      return r.homeProb ?? -Infinity;
    case "homeEdge":
      return r.myHomeWinPct != null && r.homeProb != null ? r.myHomeWinPct - r.homeProb : -Infinity;
    case "volume":
      return r.homeVolume + r.awayVolume;
  }
}

export default function KalshiAdminPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [division, setDivision] = useState("FBS");
  const { rows: allRows, loading: loadingSite, error: siteError } = useGameTotalsEngine(season);
  const rows = filterRowsByDivision(allRows, division);

  const [kalshiGames, setKalshiGames] = useState<KalshiGame[]>([]);
  const [loadingKalshi, setLoadingKalshi] = useState(true);
  const [kalshiError, setKalshiError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function loadKalshi() {
    setLoadingKalshi(true);
    setKalshiError(null);
    fetchKalshiCfbMarkets()
      .then(setKalshiGames)
      .catch((err) => setKalshiError(err.message ?? "Failed to load Kalshi markets"))
      .finally(() => setLoadingKalshi(false));
  }

  useEffect(() => {
    loadKalshi();
  }, []);

  const matched = useMemo(() => matchKalshiGames(kalshiGames, rows), [kalshiGames, rows]);

  const tableRows: Row[] = useMemo(
    () =>
      matched.map((m) => ({
        ...m,
        myHomeWinPct: spreadToWinPct(m.game.myHomeSpread),
        myAwayWinPct: spreadToWinPct(m.game.myHomeSpread != null ? -m.game.myHomeSpread : null),
      })),
    [matched]
  );

  function handleSort(key: string) {
    const k = key as SortKey;
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    return [...tableRows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [tableRows, sortKey, sortDir]);

  const sh = (label: string, key: SortKey, align?: "right") => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} align={align} />
  );

  const loading = loadingSite || loadingKalshi;
  const unmatchedKalshiCount = kalshiGames.length - matched.length;

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Kalshi</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Live snapshot only — no history kept, just Kalshi's current market price against my model's win
        probability for the same game. Kalshi's college football single-game markets are win/loss contracts
        (implied probability), not spreads or totals, so this compares against my model's win% derived from
        its projected spread, not the Totals/Predictions numbers. Thinly-traded games show a wide 7%/93%
        placeholder spread with zero volume rather than a real price — worth discounting those rows.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
        <button className="menu-btn" onClick={loadKalshi} disabled={loadingKalshi}>
          {loadingKalshi ? "Refreshing…" : "Refresh Kalshi prices"}
        </button>
      </div>

      {siteError && <p style={{ color: "crimson" }}>{siteError}</p>}
      {kalshiError && <p style={{ color: "crimson" }}>Kalshi: {kalshiError}</p>}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : (
        <>
          <div className="table-scroll">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {sh("Wk", "week")}
                  {sh("Date", "date")}
                  <th style={CP}>Kickoff</th>
                  {sh("Away", "awayTeam")}
                  {sh("Away Win% (mine)", "awayMine", "right")}
                  {sh("Away Win% (Kalshi)", "awayKalshi", "right")}
                  {sh("Away Edge", "awayEdge", "right")}
                  {sh("Home", "homeTeam")}
                  {sh("Home Win% (mine)", "homeMine", "right")}
                  {sh("Home Win% (Kalshi)", "homeKalshi", "right")}
                  {sh("Home Edge", "homeEdge", "right")}
                  {sh("Kalshi Volume", "volume", "right")}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.game.game.id}>
                    <td style={CP}>{r.game.game.week}</td>
                    <td style={CP}>{dateLabel(r.game.game.startDate)}</td>
                    <td style={CP}>{kickoffLabel(r.game.game.startDate)}</td>
                    <td style={CP}>{r.game.game.awayTeam}</td>
                    <td style={{ ...CP, textAlign: "right" }}>{pct(r.myAwayWinPct)}</td>
                    <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{pct(r.awayProb)}</td>
                    <td style={{ ...CP, textAlign: "right" }}>{fmtEdge(r.myAwayWinPct != null && r.awayProb != null ? r.myAwayWinPct - r.awayProb : null)}</td>
                    <td style={CP}>{r.game.game.homeTeam}</td>
                    <td style={{ ...CP, textAlign: "right" }}>{pct(r.myHomeWinPct)}</td>
                    <td style={{ ...CP, textAlign: "right", fontWeight: 700 }}>{pct(r.homeProb)}</td>
                    <td style={{ ...CP, textAlign: "right" }}>{fmtEdge(r.myHomeWinPct != null && r.homeProb != null ? r.myHomeWinPct - r.homeProb : null)}</td>
                    <td style={{ ...CP, textAlign: "right" }}>{fmt(r.homeVolume + r.awayVolume, 0)}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={12} className="empty">
                      No matching Kalshi markets for this season/division yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--chalk-dim)", marginTop: "0.5rem" }}>
            {kalshiGames.length} open Kalshi game markets fetched, {matched.length} matched to games in this
            season/division{unmatchedKalshiCount > 0 ? ` (${unmatchedKalshiCount} unmatched — usually lower-division games we don't track)` : ""}.
          </p>
        </>
      )}
    </div>
  );
}
