import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchPeayWeek, gradePeayPick, type PeayRow } from "../lib/api/peayPool";

const POOL_URL =
  "https://contests.app.splashsports.com/team-pickem/contests/contest_01KYZ8NG5NAXAWP07SM1XKN1B8?_gl=1*xjk1n4*_ga*MTg2MTgyNDQ2Ni4xNzc5OTg5MDc4*_ga_HBBJBG5JSR*czE3ODU3NzE5NzckbzQkZzEkdDE3ODU3NzIwNTckajYwJGwwJGgxMDcyNTUwNDA0";
const KEY_PICKS_TARGET = 3;

async function peaySave(season: number, week: number, rows: PeayRow[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password,
      pool: "peay",
      action: "saveWeek",
      season,
      week,
      rows: rows.map((r) => ({
        game_id: r.game_id,
        peay_line: r.peay_line,
        picked_side: r.picked_side,
        is_key_pick: r.is_key_pick,
      })),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

function fmt(v: number | null, decimals = 1) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(decimals)}`;
}

// No sign prefix — used for values that are already a magnitude
// (absolute-value diffs, WFB's amount off), where a "+" in front of
// every number would just be visual noise.
function fmtAbs(v: number | null, decimals = 2) {
  if (v == null) return "–";
  return Math.abs(v).toFixed(decimals);
}

export default function PeayPoolPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState<PeayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showPickedOnly, setShowPickedOnly] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [sortKey, setSortKey] = useState("start_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [gameSearch, setGameSearch] = useState("");
  const [sortMode, setSortMode] = useState<"time" | "bestBet">("time");

  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");

  function load() {
    setLoading(true);
    setError(null);
    fetchPeayWeek(season, week, liveByTeam)
      .then(setRows)
      .catch((err) => setError(err.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }

  // See EspnMoneylinePanel.tsx for why this waits on ratingsLoading —
  // without it, this effect ran once at mount using whatever liveByTeam
  // was at that instant (often {} on a cold load, before live ratings
  // finish fetching) and never re-ran once real data arrived, so the
  // same game could show a different "My" number on different page
  // loads depending on cache timing.
  useEffect(() => {
    if (ratingsLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, week, ratingsLoading]);

  function updateRow(gameId: string, patch: Partial<PeayRow>) {
    setRows((prev) => prev.map((r) => (r.game_id === gameId ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await peaySave(season, week, rows);
      setSaveMsg("Saved.");
      setSortMode("bestBet");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSort(key: string) {
    // Best Bets hard-codes the row order (below) regardless of
    // sortKey/sortDir — without this, clicking a column header while
    // Best Bets is active silently did nothing, since Best Bets mode
    // never even looked at what was clicked.
    setSortMode("time");
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Diff columns are computed here, live, from the row's *current* state —
  // not read from a stored field — so they update immediately as a Peay
  // line is typed in, rather than staying stuck at whatever they were
  // when the page first loaded.
  function myVsVegas(r: PeayRow): number | null {
    return r.myProjAwaySpread != null && r.vegasAwaySpread != null ? r.myProjAwaySpread - r.vegasAwaySpread : null;
  }
  function peayVsMineLive(r: PeayRow): number | null {
    return r.peay_line != null && r.myProjAwaySpread != null ? r.peay_line - r.myProjAwaySpread : null;
  }
  function peayVsVegasLive(r: PeayRow): number | null {
    return r.peay_line != null && r.vegasAwaySpread != null ? r.peay_line - r.vegasAwaySpread : null;
  }

  const accessor = (r: PeayRow, key: string): any => {
    switch (key) {
      case "away_team":
        return r.game.away_team;
      case "home_team":
        return r.game.home_team;
      case "start_date":
        return r.game.start_date ?? "";
      case "myProjAwaySpread":
        return r.myProjAwaySpread;
      case "vegasAwaySpread":
        return r.vegasAwaySpread;
      case "openingAwaySpread":
        return r.openingAwaySpread;
      case "peay_line":
        return r.peay_line;
      case "myVsVegas": {
        const v = myVsVegas(r);
        return v != null ? Math.abs(v) : null;
      }
      case "peayVsMine": {
        const v = peayVsMineLive(r);
        return v != null ? Math.abs(v) : null;
      }
      case "peayVsVegas":
        return peayVsVegasLive(r);
      case "wfb":
        return r.wfbTeam ? 1 : 0;
      default:
        return null;
    }
  };

  const visibleRows = useMemo(() => {
    let list = showPickedOnly ? rows.filter((r) => r.picked_side != null) : rows;
    if (hideCompleted) list = list.filter((r) => !r.game.completed);
    if (gameSearch.trim() !== "") {
      const q = gameSearch.trim().toLowerCase();
      list = list.filter((r) => r.game.away_team.toLowerCase().includes(q) || r.game.home_team.toLowerCase().includes(q));
    }
    if (sortMode === "bestBet") {
      list = [...list].sort((a, b) => {
        const av = peayVsMineLive(a);
        const bv = peayVsMineLive(b);
        const aAbs = av == null ? -Infinity : Math.abs(av);
        const bAbs = bv == null ? -Infinity : Math.abs(bv);
        return bAbs - aAbs;
      });
    } else {
      list = [...list].sort((a, b) => {
        const av = accessor(a, sortKey);
        const bv = accessor(b, sortKey);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string") {
          return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }
    return list;
  }, [rows, showPickedOnly, hideCompleted, sortKey, sortDir, gameSearch, sortMode]);

  const keyPickCount = rows.filter((r) => r.is_key_pick).length;
  const pickedCount = rows.filter((r) => r.picked_side != null).length;
  const record = rows.reduce(
    (acc, r) => {
      const g = gradePeayPick(r);
      if (g === "win") acc.wins++;
      else if (g === "loss") acc.losses++;
      else if (g === "push") acc.pushes++;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0 }
  );

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Pools
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>Peay Pool</h2>
        <a href={POOL_URL} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
          Open Peay Pool ↗
        </a>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Every FBS-vs-FBS game this week, automatically. Enter Peay's line for each game
        (same convention as the rest of the site: negative = away favored), pick a side,
        and flag exactly {KEY_PICKS_TARGET} as Key Picks.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
        <label>
          Week{" "}
          <input
            type="number"
            min={1}
            max={16}
            value={week}
            onChange={(e) => setWeek(parseInt(e.target.value, 10) || week)}
            style={{ width: 70 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input type="checkbox" checked={showPickedOnly} onChange={(e) => setShowPickedOnly(e.target.checked)} />
          Show picked games only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed games
        </label>
        <span style={{ fontSize: "0.82rem", color: keyPickCount === KEY_PICKS_TARGET ? "green" : "#a15c00" }}>
          Key Picks: {keyPickCount}/{KEY_PICKS_TARGET}
        </span>
        <span style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>
          Picked: {pickedCount}/{rows.length} · Record: {record.wins}-{record.losses}
          {record.pushes > 0 ? `-${record.pushes}` : ""}
        </span>
        <input
          type="text"
          placeholder="Search teams…"
          value={gameSearch}
          onChange={(e) => setGameSearch(e.target.value)}
          style={{ width: 150 }}
        />
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Sort:</span>
        <button className={`mode-btn ${sortMode === "bestBet" ? "mode-btn-active" : ""}`} onClick={() => setSortMode("bestBet")}>
          Best Bets
        </button>
        <button
          className={`mode-btn ${sortMode === "time" ? "mode-btn-active" : ""}`}
          onClick={() => {
            setSortMode("time");
            setSortKey("start_date");
            setSortDir("asc");
          }}
        >
          Time
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {ratingsLoading && <p>Loading live ratings…</p>}
      {loading && <p>Loading…</p>}

      {!loading && rows.length === 0 && (
        <p style={{ color: "var(--chalk-dim)" }}>
          No FBS-vs-FBS games saved for {season} week {week} yet — sync this week from Games
          & Lines first.
        </p>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <SortHeader label="Away" sortKey="away_team" active={sortKey === "away_team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader label="Home" sortKey="home_team" active={sortKey === "home_team"} dir={sortDir} onClick={handleSort} />
                  <SortHeader
                    label="My Projection"
                    sortKey="myProjAwaySpread"
                    active={sortKey === "myProjAwaySpread"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Vegas Line"
                    sortKey="vegasAwaySpread"
                    active={sortKey === "vegasAwaySpread"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Opening Line"
                    sortKey="openingAwaySpread"
                    active={sortKey === "openingAwaySpread"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Peay Line"
                    sortKey="peay_line"
                    active={sortKey === "peay_line"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="My vs Vegas"
                    sortKey="myVsVegas"
                    active={sortKey === "myVsVegas"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Peay vs Mine"
                    sortKey="peayVsMine"
                    active={sortKey === "peayVsMine"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Peay vs Vegas"
                    sortKey="peayVsVegas"
                    active={sortKey === "peayVsVegas"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <th className="th">Proj Cover</th>
                  <th className="th">Actual Cover</th>
                  <SortHeader label="WFB" sortKey="wfb" active={sortKey === "wfb"} dir={sortDir} onClick={handleSort} />
                  <th className="th">Pick</th>
                  <th className="th">Key Pick</th>
                  <th className="th">Result</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const grade = gradePeayPick(r);
                  const cellStyle = { padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)" };
                  return (
                    <tr key={r.game_id} style={{ background: r.is_key_pick ? "var(--gold-dim)" : undefined }}>
                      <td style={cellStyle}><TeamLogo team={r.game.away_team} /> {r.game.away_team}</td>
                      <td style={cellStyle}><TeamLogo team={r.game.home_team} /> {r.game.home_team}</td>
                      <td
                        style={{
                          ...cellStyle,
                          textAlign: "right",
                          color: r.myProjAwaySpread != null ? spreadColor(r.myProjAwaySpread) : undefined,
                        }}
                      >
                        {fmt(r.myProjAwaySpread)}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(r.vegasAwaySpread)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(r.openingAwaySpread)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>
                        <input
                          type="number"
                          step="0.5"
                          value={r.peay_line ?? ""}
                          onChange={(e) =>
                            updateRow(r.game_id, { peay_line: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 55, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmtAbs(myVsVegas(r))}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmtAbs(peayVsMineLive(r))}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(peayVsVegasLive(r), 2)}</td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        {r.projCoverTeam === "away" ? (
                          <TeamLogo team={r.game.away_team} size={16} />
                        ) : r.projCoverTeam === "home" ? (
                          <TeamLogo team={r.game.home_team} size={16} />
                        ) : (
                          <span style={{ color: "var(--chalk-dim)" }}>–</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        {r.actualCoverTeam === "away" ? (
                          <TeamLogo team={r.game.away_team} size={16} />
                        ) : r.actualCoverTeam === "home" ? (
                          <TeamLogo team={r.game.home_team} size={16} />
                        ) : r.actualCoverTeam === "push" ? (
                          "Push"
                        ) : (
                          <span style={{ color: "var(--chalk-dim)" }}>–</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.3rem" }}>
                          {r.wfbTeam === "away" ? (
                            <TeamLogo team={r.game.away_team} size={16} />
                          ) : r.wfbTeam === "home" ? (
                            <TeamLogo team={r.game.home_team} size={16} />
                          ) : (
                            <span style={{ color: "var(--chalk-dim)" }}>–</span>
                          )}
                          {r.wfbTeam != null && <span style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{fmtAbs(r.wfbAmountOff)}</span>}
                        </div>
                      </td>
                      <td style={cellStyle}>
                        <div style={{ display: "flex", gap: "0.2rem" }}>
                          <button
                            className="menu-btn"
                            style={{ opacity: r.picked_side === "away" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                            onClick={() => updateRow(r.game_id, { picked_side: r.picked_side === "away" ? null : "away" })}
                            title={r.game.away_team}
                          >
                            <TeamLogo team={r.game.away_team} size={16} /> {fmt(r.peay_line)}
                          </button>
                          <button
                            className="menu-btn"
                            style={{ opacity: r.picked_side === "home" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                            onClick={() => updateRow(r.game_id, { picked_side: r.picked_side === "home" ? null : "home" })}
                            title={r.game.home_team}
                          >
                            <TeamLogo team={r.game.home_team} size={16} /> {fmt(r.peay_line != null ? -r.peay_line : null)}
                          </button>
                        </div>
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.is_key_pick}
                          onChange={(e) => updateRow(r.game_id, { is_key_pick: e.target.checked })}
                        />
                      </td>
                      <td style={cellStyle}>
                        {grade === "pending" ? "–" : grade === "win" ? "✅ Win" : grade === "push" ? "Push" : "❌ Loss"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button onClick={handleSave} disabled={saving} style={{ marginTop: "1rem" }}>
            {saving ? "Saving…" : "Save Peay Lines"}
          </button>
          {saveMsg && <span style={{ color: "green", marginLeft: "0.75rem" }}>{saveMsg}</span>}
        </>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        My vs Vegas / Peay vs Mine show the size of the disagreement only (no sign) — how far
        off, not which direction. Peay vs Vegas keeps its sign: positive means Peay's line is
        more home-favoring than Vegas. Results grade automatically once CFBD marks a game
        complete with a final score.
      </div>
    </div>
  );
}
