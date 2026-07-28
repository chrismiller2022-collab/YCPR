import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../components/TeamLogo";
import {
  SURVIVOR_WEEKS,
  availableConferences,
  DEFAULT_CONFERENCES,
  rowTeams,
  gameForTeamInWeek,
  opponentOf,
  teamSpread,
  cellStatus,
  teamsUsedElsewhere,
  allUsedTeams,
} from "../lib/survivor";

const STORAGE_KEY = "survivor_picks_v1";
const AUTH_KEY = "survivor_authed";

function loadPicks(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function PasswordGate({ onAuthed, onHome }: { onAuthed: () => void; onHome?: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit() {
    if (!password) {
      setError("Enter a password first.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/survivor-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Incorrect password");
        return;
      }
      sessionStorage.setItem(AUTH_KEY, "1");
      onAuthed();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
      <h2>Survivor</h2>
      <p>Enter the password to continue.</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        style={{ width: "100%", padding: "0.6rem", marginBottom: "0.75rem" }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button onClick={submit} disabled={checking}>
        {checking ? "Checking…" : "Continue"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p style={{ marginTop: "2rem" }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onHome?.();
          }}
        >
          ← Back to site
        </a>
      </p>
    </div>
  );
}

export default function SurvivorPage({ onHome }: { onHome?: () => void }) {
  const [authed, setAuthed] = useState(false);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [selectedConfs, setSelectedConfs] = useState<Set<string>>(new Set(DEFAULT_CONFERENCES));
  const [hideUsed, setHideUsed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(AUTH_KEY) === "1") setAuthed(true);
  }, []);

  useEffect(() => {
    if (authed) setPicks(loadPicks());
  }, [authed]);

  useEffect(() => {
    if (authed) localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  }, [picks, authed]);

  const allConfs = useMemo(() => availableConferences(), []);
  const teams = useMemo(() => rowTeams(selectedConfs), [selectedConfs]);
  const usedTeams = useMemo(() => allUsedTeams(picks), [picks]);

  function toggleConf(conf: string) {
    setSelectedConfs((prev) => {
      const next = new Set(prev);
      if (next.has(conf)) next.delete(conf);
      else next.add(conf);
      return next;
    });
  }

  function handleCellClick(teamName: string, weekKey: string, status: string) {
    if (status !== "open" && status !== "selected") return;
    setPicks((prev) => {
      const weekPicks = prev[weekKey] || [];
      if (weekPicks.includes(teamName)) {
        return { ...prev, [weekKey]: weekPicks.filter((t) => t !== teamName) };
      }
      const usedElsewhere = teamsUsedElsewhere(prev, weekKey);
      if (usedElsewhere.has(teamName)) return prev;
      if (weekPicks.length >= 2) return prev;
      return { ...prev, [weekKey]: [...weekPicks, teamName] };
    });
  }

  function resetAll() {
    if (confirm("Clear all picks? This can't be undone.")) {
      setPicks({});
    }
  }

  if (!authed) {
    return <PasswordGate onAuthed={() => setAuthed(true)} onHome={onHome} />;
  }

  const lockedWeeks = SURVIVOR_WEEKS.filter((w) => (picks[w.key] || []).length === 2).length;

  return (
    <div style={{ padding: "1rem 1.25rem 3rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Survivor Pool</h2>
          <p style={{ margin: "0.25rem 0 0", color: "var(--chalk-dim)", fontSize: "0.9rem" }}>
            {lockedWeeks} of {SURVIVOR_WEEKS.length} weeks locked · {usedTeams.size} teams used
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            className="menu-btn"
            onClick={() => setHideUsed((v) => !v)}
            style={{ opacity: hideUsed ? 1 : 0.7 }}
          >
            {hideUsed ? "Showing eligible only" : "Hide used teams"}
          </button>
          <button className="menu-btn" onClick={resetAll}>
            Reset all
          </button>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onHome?.();
            }}
            className="menu-btn"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
          >
            ← Home
          </a>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginBottom: "1rem",
          padding: "0.75rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginRight: "0.5rem", alignSelf: "center" }}>
          Conferences:
        </span>
        {allConfs.map((conf) => {
          const active = selectedConfs.has(conf);
          return (
            <button
              key={conf}
              onClick={() => toggleConf(conf)}
              style={{
                fontSize: "0.78rem",
                padding: "0.3rem 0.6rem",
                borderRadius: 6,
                border: `1px solid ${active ? "var(--gold)" : "var(--hash)"}`,
                background: active ? "var(--gold-dim)" : "transparent",
                color: active ? "var(--chalk)" : "var(--chalk-dim)",
                cursor: "pointer",
              }}
            >
              {conf}
            </button>
          );
        })}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  background: "var(--turf-panel-2)",
                  padding: "0.5rem 0.75rem",
                  textAlign: "left",
                  minWidth: 150,
                  borderBottom: "1px solid var(--hash)",
                }}
              >
                Team
              </th>
              {SURVIVOR_WEEKS.map((w) => {
                const locked = (picks[w.key] || []).length === 2;
                return (
                  <th
                    key={w.key}
                    style={{
                      padding: "0.4rem 0.5rem",
                      textAlign: "center",
                      minWidth: 92,
                      borderBottom: "1px solid var(--hash)",
                      background: locked ? "rgba(255,255,255,0.06)" : "var(--turf-panel-2)",
                      textDecoration: locked ? "line-through" : "none",
                      color: locked ? "var(--chalk-dim)" : "var(--chalk)",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{w.label}</div>
                    <div style={{ fontWeight: 400, fontSize: "0.68rem", opacity: 0.7 }}>
                      {w.lockLabel}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {teams
              .filter((team) => !hideUsed || !usedTeams.has(team.team))
              .map((team) => (
                <tr key={team.team}>
                  <td
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      background: "var(--turf-panel)",
                      padding: "0.4rem 0.75rem",
                      borderBottom: "1px solid var(--hash)",
                      textDecoration: usedTeams.has(team.team) ? "line-through" : "none",
                      opacity: usedTeams.has(team.team) ? 0.5 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                      <TeamLogo team={team} />
                      {team.team}
                    </span>
                  </td>
                  {SURVIVOR_WEEKS.map((week) => {
                    const game = gameForTeamInWeek(team.team, week.dataWeek);
                    const opp = game ? opponentOf(game, team.team) : undefined;
                    const usedElsewhere = teamsUsedElsewhere(picks, week.key);
                    const status = cellStatus(
                      team.team,
                      week,
                      game,
                      opp,
                      selectedConfs,
                      picks,
                      usedElsewhere
                    );

                    if (!game) {
                      return (
                        <td
                          key={week.key}
                          style={{
                            textAlign: "center",
                            padding: "0.4rem",
                            borderBottom: "1px solid var(--hash)",
                            color: "var(--chalk-dim)",
                          }}
                        >
                          –
                        </td>
                      );
                    }

                    const isHome = game.home === team.team;
                    const spread = opp ? teamSpread(team, opp, game) : null;
                    const clickable = status === "open" || status === "selected";

                    const bg =
                      status === "selected"
                        ? "var(--gold-dim)"
                        : status === "ineligible" || status === "team-used" || status === "week-locked"
                        ? "rgba(255,255,255,0.03)"
                        : "transparent";

                    return (
                      <td
                        key={week.key}
                        onClick={() => clickable && handleCellClick(team.team, week.key, status)}
                        title={
                          status === "ineligible"
                            ? "Opponent's conference isn't selected"
                            : status === "team-used"
                            ? "Team already used in another week"
                            : status === "week-locked"
                            ? "Both picks already made for this week"
                            : undefined
                        }
                        style={{
                          textAlign: "center",
                          padding: "0.35rem 0.4rem",
                          borderBottom: "1px solid var(--hash)",
                          background: bg,
                          cursor: clickable ? "pointer" : "not-allowed",
                          opacity: status === "ineligible" || status === "team-used" || status === "week-locked" ? 0.4 : 1,
                          textDecoration:
                            status === "ineligible" || status === "team-used" ? "line-through" : "none",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {isHome ? "" : "@"}
                          {opp ? opp.team : "?"}
                        </div>
                        {spread != null && (
                          <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>
                            {spread > 0 ? "+" : ""}
                            {spread.toFixed(1)}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
