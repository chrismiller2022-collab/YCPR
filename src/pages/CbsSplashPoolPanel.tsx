import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { spreadColor } from "../lib/odds";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchCbsSplashWeek, gradeCbsPick, gradeKellyPick, type CbsSplashRow } from "../lib/api/cbsSplashPool";

// Copy of PeayPoolPanel.tsx for a second "ATS vs a custom line, every
// FBS-vs-FBS game" pool.
const POOL_URL: string | null = "https://app.splashsports.com/contest/05480bf3-91d8-4e2a-b25d-1502bb7c9061/entries/overall";
// Second Splash link — a specific contest's picks page (with its own
// entryId/slateId), separate from POOL_URL above which is the overall
// entries/leaderboard view.
const POOL_PICKS_URL: string | null =
  "https://app.splashsports.com/contest/99efb826-9409-48f5-9c73-1182a213ce7c/picks?entryId=01a05d21-e5e9-4bc8-827a-7045eee2a393&slateId=f28a6120-8691-4e4f-aa9c-0d9dc903e3a3&isEdit=";
const CBS_GAMES_TARGET = 6;
const CBS_KEY_PICKS_TARGET = 1;
const KELLY_GAMES_TARGET = 7;

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
        cbs_selected: r.cbsSelected,
        picked_side: r.cbsPickedSide,
        is_key_pick: r.cbsIsKeyPick,
        kelly_selected: r.kellySelected,
        kelly_picked_side: r.kellyPickedSide,
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

export default function CbsSplashPoolPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState<CbsSplashRow[]>([]);
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
  const [savedSnapshot, setSavedSnapshot] = useState<string>("[]");

  function snapshotOf(list: CbsSplashRow[]): string {
    return JSON.stringify(
      list.map((r) => ({
        g: r.game_id,
        l: r.splash_line,
        cs: r.cbsSelected,
        cp: r.cbsPickedSide,
        ck: r.cbsIsKeyPick,
        ks: r.kellySelected,
        kp: r.kellyPickedSide,
      }))
    );
  }

  function load() {
    setLoading(true);
    setError(null);
    fetchCbsSplashWeek(season, week, liveByTeam)
      .then((data) => {
        setRows(data);
        setSavedSnapshot(snapshotOf(data));
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

  const isDirty = snapshotOf(rows) !== savedSnapshot;

  function updateRow(gameId: string, patch: Partial<CbsSplashRow>) {
    setRows((prev) => prev.map((r) => (r.game_id === gameId ? { ...r, ...patch } : r)));
  }

  // "Most of the time" the same pick works for both — this just copies
  // CBS's current selections/picks over Kelly's, since Kelly's extra
  // 7th game still needs to be added by hand afterward. One-way only;
  // doesn't touch CBS.
  function copyCbsToKelly() {
    setRows((prev) => prev.map((r) => (r.cbsSelected ? { ...r, kellySelected: true, kellyPickedSide: r.cbsPickedSide } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await splashSave(season, week, rows);
      setSaveMsg("Saved.");
      setSavedSnapshot(snapshotOf(rows));
      setSortMode("bestBet");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSort(key: string) {
    // See PeayPoolPanel.tsx's handleSort — Best Bets hard-codes the row
    // order regardless of sortKey/sortDir, so a column-header click had
    // no visible effect while Best Bets was active.
    setSortMode("time");
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
      case "openingAwaySpread":
        return r.openingAwaySpread;
      case "splash_line":
        return r.splash_line;
      case "myVsVegas": {
        const v = myVsVegas(r);
        return v != null ? Math.abs(v) : null;
      }
      case "splashVsMine": {
        const v = splashVsMineLive(r);
        return v != null ? Math.abs(v) : null;
      }
      case "splashVsVegas":
        return splashVsVegasLive(r);
      case "wfb":
        return r.wfbTeam ? 1 : 0;
      default:
        return null;
    }
  };

  const visibleRows = useMemo(() => {
    let list = showPickedOnly ? rows.filter((r) => r.cbsPickedSide != null || r.kellyPickedSide != null) : rows;
    if (hideCompleted) list = list.filter((r) => !r.game.completed);
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
  }, [rows, showPickedOnly, hideCompleted, sortKey, sortDir, gameSearch, sortMode]);

  const cbsSelectedCount = rows.filter((r) => r.cbsSelected).length;
  const cbsKeyCount = rows.filter((r) => r.cbsIsKeyPick).length;
  const cbsPickedCount = rows.filter((r) => r.cbsSelected && r.cbsPickedSide != null).length;
  const kellySelectedCount = rows.filter((r) => r.kellySelected).length;
  const kellyPickedCount = rows.filter((r) => r.kellySelected && r.kellyPickedSide != null).length;
  const cbsRecord = rows.reduce(
    (acc, r) => {
      const g = gradeCbsPick(r);
      if (g === "win") acc.wins++;
      else if (g === "loss") acc.losses++;
      else if (g === "push") acc.pushes++;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0 }
  );
  const kellyRecord = rows.reduce(
    (acc, r) => {
      const g = gradeKellyPick(r);
      if (g === "win") acc.wins++;
      else if (g === "loss") acc.losses++;
      else if (g === "push") acc.pushes++;
      return acc;
    },
    { wins: 0, losses: 0, pushes: 0 }
  );

  return (
    <div>
      <button
        className="menu-btn"
        onClick={() => {
          if (isDirty && !confirm("You have unsaved picks/lines — leave anyway and lose them?")) return;
          onBack();
        }}
        style={{ marginBottom: "1.5rem" }}
      >
        ‹ Pools
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 style={{ margin: 0 }}>CBS/Kelly</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {POOL_URL && (
            <a href={POOL_URL} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
              CBS Splash ↗
            </a>
          )}
          {POOL_PICKS_URL && (
            <a href={POOL_PICKS_URL} target="_blank" rel="noopener noreferrer" className="menu-btn" style={{ textDecoration: "none" }}>
              Kelly in Vegas ↗
            </a>
          )}
        </div>
      </div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem" }}>
        Every FBS-vs-FBS game this week, automatically, shared between two separate contests on
        the same line: check a game into CBS ({CBS_GAMES_TARGET} games, {CBS_KEY_PICKS_TARGET} key
        pick) and/or Kelly ({KELLY_GAMES_TARGET} games, no key pick) and pick a side for each.
        Splash line convention matches the rest of the site: negative = away favored.
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
            onChange={(e) => {
              const next = parseInt(e.target.value, 10) || week;
              if (isDirty && !confirm("You have unsaved picks/lines for this week — switch weeks anyway and lose them?")) return;
              setWeek(next);
            }}
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
        <span style={{ fontSize: "0.82rem", color: cbsSelectedCount === CBS_GAMES_TARGET && cbsKeyCount === CBS_KEY_PICKS_TARGET ? "green" : "#a15c00" }}>
          CBS: {cbsSelectedCount}/{CBS_GAMES_TARGET} selected · {cbsPickedCount} picked · Key {cbsKeyCount}/{CBS_KEY_PICKS_TARGET} · {cbsRecord.wins}-
          {cbsRecord.losses}
          {cbsRecord.pushes > 0 ? `-${cbsRecord.pushes}` : ""}
        </span>
        <span style={{ fontSize: "0.82rem", color: kellySelectedCount === KELLY_GAMES_TARGET ? "green" : "#a15c00" }}>
          Kelly: {kellySelectedCount}/{KELLY_GAMES_TARGET} selected · {kellyPickedCount} picked · {kellyRecord.wins}-{kellyRecord.losses}
          {kellyRecord.pushes > 0 ? `-${kellyRecord.pushes}` : ""}
        </span>
        <button className="menu-btn" onClick={copyCbsToKelly} title="Copies CBS's current selections/picks onto Kelly — doesn't touch CBS">
          Copy CBS → Kelly
        </button>
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
                  <th className="th">Proj Cover</th>
                  <th className="th">Actual Cover</th>
                  <SortHeader label="WFB" sortKey="wfb" active={sortKey === "wfb"} dir={sortDir} onClick={handleSort} />
                  <th className="th">CBS?</th>
                  <th className="th">CBS Pick</th>
                  <th className="th">Key</th>
                  <th className="th">CBS Result</th>
                  <th className="th">Kelly?</th>
                  <th className="th">Kelly Pick</th>
                  <th className="th">Kelly Result</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const cbsGrade = gradeCbsPick(r);
                  const kellyGrade = gradeKellyPick(r);
                  const cellStyle = { padding: "0.25rem 0.35rem", borderBottom: "1px solid var(--hash)" };
                  return (
                    <tr key={r.game_id} style={{ background: r.cbsIsKeyPick ? "var(--gold-dim)" : undefined }}>
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
                          value={r.splash_line ?? ""}
                          onChange={(e) =>
                            updateRow(r.game_id, { splash_line: e.target.value === "" ? null : Number(e.target.value) })
                          }
                          style={{ width: 55, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmtAbs(myVsVegas(r))}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmtAbs(splashVsMineLive(r))}</td>
                      <td style={{ ...cellStyle, textAlign: "right" }}>{fmt(splashVsVegasLive(r), 2)}</td>
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

                      {/* CBS */}
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.cbsSelected}
                          onChange={(e) => {
                            if (e.target.checked && cbsSelectedCount >= CBS_GAMES_TARGET) {
                              setSaveMsg(`CBS is already at ${CBS_GAMES_TARGET} games — uncheck one first.`);
                              return;
                            }
                            updateRow(r.game_id, e.target.checked ? { cbsSelected: true } : { cbsSelected: false, cbsPickedSide: null, cbsIsKeyPick: false });
                          }}
                        />
                      </td>
                      <td style={cellStyle}>
                        {r.cbsSelected && (
                          <div style={{ display: "flex", gap: "0.2rem" }}>
                            <button
                              className="menu-btn"
                              style={{ opacity: r.cbsPickedSide === "away" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                              onClick={() => updateRow(r.game_id, { cbsPickedSide: r.cbsPickedSide === "away" ? null : "away" })}
                              title={r.game.away_team}
                            >
                              <TeamLogo team={r.game.away_team} size={16} /> {fmt(r.splash_line)}
                            </button>
                            <button
                              className="menu-btn"
                              style={{ opacity: r.cbsPickedSide === "home" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                              onClick={() => updateRow(r.game_id, { cbsPickedSide: r.cbsPickedSide === "home" ? null : "home" })}
                              title={r.game.home_team}
                            >
                              <TeamLogo team={r.game.home_team} size={16} /> {fmt(r.splash_line != null ? -r.splash_line : null)}
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        {r.cbsSelected && (
                          <input
                            type="checkbox"
                            checked={r.cbsIsKeyPick}
                            onChange={(e) => {
                              if (e.target.checked && cbsKeyCount >= CBS_KEY_PICKS_TARGET) {
                                setSaveMsg(`CBS already has ${CBS_KEY_PICKS_TARGET} key pick — uncheck it first.`);
                                return;
                              }
                              updateRow(r.game_id, { cbsIsKeyPick: e.target.checked });
                            }}
                          />
                        )}
                      </td>
                      <td style={cellStyle}>
                        {r.cbsSelected ? (cbsGrade === "pending" ? "–" : cbsGrade === "win" ? "✅ Win" : cbsGrade === "push" ? "Push" : "❌ Loss") : ""}
                      </td>

                      {/* Kelly */}
                      <td style={{ ...cellStyle, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={r.kellySelected}
                          onChange={(e) => {
                            if (e.target.checked && kellySelectedCount >= KELLY_GAMES_TARGET) {
                              setSaveMsg(`Kelly is already at ${KELLY_GAMES_TARGET} games — uncheck one first.`);
                              return;
                            }
                            updateRow(r.game_id, e.target.checked ? { kellySelected: true } : { kellySelected: false, kellyPickedSide: null });
                          }}
                        />
                      </td>
                      <td style={cellStyle}>
                        {r.kellySelected && (
                          <div style={{ display: "flex", gap: "0.2rem" }}>
                            <button
                              className="menu-btn"
                              style={{ opacity: r.kellyPickedSide === "away" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                              onClick={() => updateRow(r.game_id, { kellyPickedSide: r.kellyPickedSide === "away" ? null : "away" })}
                              title={r.game.away_team}
                            >
                              <TeamLogo team={r.game.away_team} size={16} /> {fmt(r.splash_line)}
                            </button>
                            <button
                              className="menu-btn"
                              style={{ opacity: r.kellyPickedSide === "home" ? 1 : 0.4, padding: "0.15rem 0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}
                              onClick={() => updateRow(r.game_id, { kellyPickedSide: r.kellyPickedSide === "home" ? null : "home" })}
                              title={r.game.home_team}
                            >
                              <TeamLogo team={r.game.home_team} size={16} /> {fmt(r.splash_line != null ? -r.splash_line : null)}
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={cellStyle}>
                        {r.kellySelected ? (kellyGrade === "pending" ? "–" : kellyGrade === "win" ? "✅ Win" : kellyGrade === "push" ? "Push" : "❌ Loss") : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {isDirty && (
            <p style={{ color: "#e0a030", fontWeight: 700, marginTop: "1rem", marginBottom: 0 }}>
              ⚠ You have unsaved picks and/or lines — click Save below before leaving this page, or they'll be lost.
            </p>
          )}
          <button onClick={handleSave} disabled={saving} style={{ marginTop: "0.5rem" }}>
            {saving ? "Saving…" : "Save Lines & Picks"}
          </button>
          {saveMsg && <span style={{ color: saveMsg === "Saved." ? "green" : "#e0a030", marginLeft: "0.75rem" }}>{saveMsg}</span>}
        </>
      )}

      <div className="footer-note" style={{ marginTop: "1rem" }}>
        My vs Vegas / Splash vs Mine show the size of the disagreement only (no sign) — how
        far off, not which direction. Splash vs Vegas keeps its sign: positive means Splash's
        line is more home-favoring than Vegas. Results grade automatically once CFBD marks a
        game complete with a final score.
      </div>
    </div>
  );
}
