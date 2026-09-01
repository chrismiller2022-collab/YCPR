import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchCbsSplashWeek, gradeCbsSplashPick, type CbsSplashRow } from "../lib/api/cbsSplashPool";

// Copy of PeayPoolPanel.tsx for a second "ATS vs a custom line, every
// FBS-vs-FBS game" pool.
const POOL_URL: string | null = "https://app.splashsports.com/contest/05480bf3-91d8-4e2a-b25d-1502bb7c9061/entries/overall";
// Second Splash link — a specific contest's picks page (with its own
// entryId/slateId), separate from POOL_URL above which is the overall
// entries/leaderboard view.
const POOL_PICKS_URL: string | null =
  "https://app.splashsports.com/contest/99efb826-9409-48f5-9c73-1182a213ce7c/picks?entryId=01a05d21-e5e9-4bc8-827a-7045eee2a393&slateId=f28a6120-8691-4e4f-aa9c-0d9dc903e3a3&isEdit=";
const KEY_PICKS_TARGET = 3;

async function splashSave(season: number, week: number, rows: CbsSplashRow[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password,
      pool: "cbssplash",
      action: "saveWeek",
      season,
      week,
      rows: rows.map((r) => ({
        game_id: r.game_id,
        splash_line: r.splash_line,
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

export default function CbsSplashPoolPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState<CbsSplashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showPickedOnly, setShowPickedOnly] = useState(false);
  const [sortKey, setSortKey] = useState("start_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [gameSearch, setGameSearch] = useState("");
  const [sortMode, setSortMode] = useState<"time" | "bestBet">("time");

  const { byTeam: liveByTeam, loading: ratingsLoading } = useWeeklyStats("latest");

  function load() {
    setLoading(true);
    setError(null);
    fetchCbsSplashWeek(season, week, liveByTeam)
      .then((data) => {
        // See PeayPoolPanel.tsx's load() for the reasoning — default
        // pick follows the (Vegas-defaulted) Splash line, only for rows
        // with no pick made yet.
        const withAutoPicks = data.map((r) => {
          if (r.picked_side != null) return r;
          const autoPick: "away" | "home" | null =
            r.splash_line == null || r.myProjAwaySpread == null
              ? null
              : r.myProjAwaySpread < r.splash_line
              ? "away"
              : r.myProjAwaySpread > r.splash_line
              ? "home"
              : null;
          return { ...r, picked_side: autoPick };
        });
        setRows(withAutoPicks);
      })
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

  function updateRow(gameId: string, patch: Partial<CbsSplashRow>) {
    setRows((prev) => prev.map((r) => (r.game_id === gameId ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await splashSave(season, week, rows);
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
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  // Diff columns are computed here, live, from the row's *current* state —
  // not read from a stored field — so they update immediately as a Splash
  // line is typed in, rather than staying stuck at whatever they were when
  // the page first loaded.
  function myVsVegas(r: CbsSplashRow): number | null {
    return r.myProjAwaySpread != null && r.vegasAwaySpread != null ? r.myProjAwaySpread - r.vegasAwaySpread : null;
  }
  function splashVsMineLive(r: CbsSplashRow): number | null {
    return r.splash_line != null && r.myProjAwaySpread != null ? r.splash_line - r.myProjAwaySpread : null;
  }
  function splashVsVegasLive(r: CbsSplashRow): number | null {
    return r.splash_line != null && r.vegasAwaySpread != null ? r.splash_line - r.vegasAwaySpread : null;
  }

  const accessor = (r: CbsSplashRow, key: string): any => {
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
      case "splash_line":
        return r.splash_line;
      case "myVsVegas":
        return myVsVegas(r);
      case "splashVsMine":
        return splashVsMineLive(r);
      case "splashVsVegas":
        return splashVsVegasLive(r);
      default:
        return null;
    }
  };

  const visibleRows = useMemo(() => {
    let list = showPickedOnly ? rows.filter((r) => r.picked_side != null) : rows;
    if (gameSearch.trim() !== "") {
      const q = gameSearch.trim().toLowerCase();
      list = list.filter((r) => r.game.away_team.toLowerCase().includes(q) || r.game.home_team.toLowerCase().includes(q));
    }
    if (sortMode === "bestBet") {
      list = [...list].sort((a, b) => {
        const av = splashVsMineLive(a);
        const bv = splashVsMineLive(b);
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
  }, [rows, showPickedOnly, sortKey, sortDir, gameSearch, sortMode]);

  const keyPickCount = rows.filter((r) => r.is_key_pick).length;
  const pickedCount = rows.filter((r) => r.picked_side != null).length;
  const record = rows.reduce(
    (acc, r) => {
      const g = gradeCbsSplashPick(r);
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
        <h2 style={{ margin: 0 }}>CBS/Kelly</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {POOL_URL && (
            <a href={POOL_URL} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
              Open Splash (Overall) ↗
            </a>
          )}
          {POOL_PICKS_URL && (
            <a href={POOL_PICKS_URL} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
              Open Splash (Picks) ↗
            </a>
          )}
        </div>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Every FBS-vs-FBS game this week, automatically. Enter CBS Splash's line for each game
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
                    label="Splash Line"
                    sortKey="splash_line"
                    active={sortKey === "splash_line"}
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
                    label="Splash vs Mine"
                    sortKey="splashVsMine"
                    active={sortKey === "splashVsMine"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <SortHeader
                    label="Splash vs Vegas"
                    sortKey="splashVsVegas"
                    active={sortKey === "splashVsVegas"}
                    dir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                  <th className="th">Pick</th>
                  <th className="th">Key Pick</th>
                  <th className="th">Result</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const grade = gradeCbsSplashPick(r);
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
                      <td style={{ ...cellStyle, textAlign: "right" }}>
                        <input
                          type="number"
                          step="0.5"
                          value={r.splash_line ?? ""}
                          onChange={(e) =>
                            updateRow(r.game_id, { splash_line: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 55, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(myVsVegas(r), 2)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(splashVsMineLive(r), 2)}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(splashVsVegasLive(r), 2)}</td>
                      <td style={cellStyle}>
                        <div style={{ display: "flex", gap: "0.2rem" }}>
                          <button
                            className="menu-btn"
                            style={{ opacity: r.picked_side === "away" ? 1 : 0.4, padding: "0.15rem 0.4rem" }}
                            onClick={() => updateRow(r.game_id, { picked_side: "away" })}
                          >
                            Away
                          </button>
                          <button
                            className="menu-btn"
                            style={{ opacity: r.picked_side === "home" ? 1 : 0.4, padding: "0.15rem 0.4rem" }}
                            onClick={() => updateRow(r.game_id, { picked_side: "home" })}
                          >
                            Home
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
            {saving ? "Saving…" : "Save Splash Lines"}
          </button>
          {saveMsg && <span style={{ color: "green", marginLeft: "0.75rem" }}>{saveMsg}</span>}
        </>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        Splash vs Mine / Splash vs Vegas = Splash's line minus that number — positive means
        Splash's line is more home-favoring than the comparison. Results grade automatically
        once CFBD marks a game complete with a final score.
      </div>
    </div>
  );
}
