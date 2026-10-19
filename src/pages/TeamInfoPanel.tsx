import { useState, type CSSProperties } from "react";
import { useDefaultToAdminWeek } from "../lib/adminWeek";
import CoachAtsSection from "../components/CoachAtsSection";
import TeamBettingSection from "../components/TeamBettingSection";
import TeamOverviewSection from "../components/TeamOverviewSection";
import TeamPage from "./TeamPage";
import { TEAMS, TEAMS_BY_NAME } from "../data/teams";
import { teamToSlug } from "../lib/slugs";
import { invalidateCache } from "../lib/api/cache";
import { pullTeamInfo } from "../lib/api/teamInfo";

const FBS_TEAMS = TEAMS.filter((t) => t.div === "FBS")
  .map((t) => t.team)
  .sort((a, b) => a.localeCompare(b));

const TABS = [
  { key: "betting", label: "Betting by team" },
  { key: "coaches", label: "Coach records" },
  { key: "team", label: "Team page" },
  { key: "pulls", label: "Data pulls" },
] as const;

const panel: CSSProperties = { padding: "0.75rem", border: "1px solid var(--hash)", borderRadius: 8, background: "var(--turf-panel)" };

// Admin Teams: my betting record by team, current-coach records, any team's public page with admin-only blocks
// under it, and the CFBD Team Info pull. (The per-game PGWE / net SR table moved to Admin Matchups → Review.)
export default function TeamInfoPanel({ onBack: _onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("betting");
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  useDefaultToAdminWeek(setWeek);
  const [pickedTeam, setPickedTeam] = useState("Georgia");
  const [wholeSeason, setWholeSeason] = useState(false);
  const [parts, setParts] = useState<Record<string, boolean>>({ pgwe: true, netsr: true, coaches: true, venues: false });
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  async function handlePull() {
    const selected = Object.entries(parts).filter(([, on]) => on).map(([k]) => k);
    if (selected.length === 0) return;
    if (!window.confirm(`Pull ${selected.length} CFBD dataset(s) (${selected.length + (selected.includes("venues") ? 2 : 0)} requests) for ${season}${wholeSeason ? " (whole season)" : ` week ${week}`}?`)) return;
    setPulling(true);
    setPullMsg(null);
    setPullError(null);
    try {
      const r = await pullTeamInfo(season, wholeSeason ? null : week, selected);
      const bits: string[] = [];
      if (r.pgwe) bits.push(`PGWE: ${r.pgwe.withPgwe} of ${r.pgwe.games} games have it`);
      if (r.netSr) bits.push(`Net success rate: ${r.netSr.saved} team-games saved`);
      if (r.venues) bits.push(`Stadiums: ${r.venues.teams} teams, ${r.venues.venues} venues, ${r.venues.gamesWithVenue} of ${r.venues.games} games have a venue`);
      if (r.coaches) bits.push(`Coaches: ${r.coaches.teams} teams${r.coaches.historySeasons != null ? `, ${r.coaches.historySeasons} coach-seasons of history` : ""}${r.coaches.staleTeams ? ` (${r.coaches.staleTeams} using last season's coach)` : ""}`);
      setPullMsg(bits.join(" · ") + (r.warnings?.length ? ` — ${r.warnings.join(" ")}` : ""));
      invalidateCache();
      setReloadTick((n) => n + 1);
    } catch (e: any) {
      setPullError(e.message ?? "Pull failed");
    } finally {
      setPulling(false);
    }
  }

  const teamObj = TEAMS_BY_NAME[pickedTeam];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Teams</h2>
      <nav className="admin-tabs" aria-label="Teams views">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : undefined} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "betting" && <TeamBettingSection />}

      {tab === "coaches" && <CoachAtsSection refreshKey={reloadTick} />}

      {tab === "team" && (
        <div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.85rem" }}>
              Team{" "}
              <select value={pickedTeam} onChange={(e) => setPickedTeam(e.target.value)}>
                {FBS_TEAMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <a href={`/team/${teamToSlug(pickedTeam)}`} target="_blank" rel="noopener" style={{ fontSize: "0.82rem" }}>
              Open public page ↗
            </a>
          </div>
          {teamObj && (
            <div className="admin-embedded-tool">
              <TeamPage key={pickedTeam} team={teamObj} onNavigateTeam={(t: any) => setPickedTeam(typeof t === "string" ? t : t?.team ?? pickedTeam)} onHome={() => setTab("betting")} />
            </div>
          )}
          <h3>Admin only: coach history</h3>
          <TeamOverviewSection season={season} refreshKey={reloadTick} fixedTeam={pickedTeam} showCharts={false} />
        </div>
      )}

      {tab === "pulls" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", margin: 0 }}>
            CFBD Team Info: postgame win expectancy (PGWE), net success rate, head coaches with tenure, and stadium coordinates for Game
            Weather. PGWE and net SR show in Admin Matchups → Review.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.85rem" }}>
              Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 70 }} />
            </label>
            <label style={{ fontSize: "0.85rem" }}>
              Week <input type="number" min={1} value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || 1)} style={{ width: 60 }} />
            </label>
          </div>
          <div style={{ ...panel, display: "flex", gap: "0.9rem", alignItems: "center", flexWrap: "wrap" }}>
            <button className="menu-btn" onClick={handlePull} disabled={pulling || !Object.values(parts).some(Boolean)}>
              {pulling ? "Pulling…" : "Pull Team Info"}
            </button>
            {(
              [
                ["pgwe", "PGWE"],
                ["netsr", "Net success rate"],
                ["coaches", "Coaches + tenure"],
                ["venues", "Stadiums (coordinates)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <input type="checkbox" checked={parts[k]} onChange={(e) => setParts((p) => ({ ...p, [k]: e.target.checked }))} />
                {label}
              </label>
            ))}
            <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <input type="checkbox" checked={wholeSeason} onChange={(e) => setWholeSeason(e.target.checked)} />
              Whole season (else just week {week})
            </label>
            <span style={{ fontSize: "0.75rem", color: "var(--chalk-dim)" }}>
              One CFBD request per box checked, except Stadiums. Coaches ignores the week (pulls the current staff either way). Stadiums is
              three requests (venues, team stadiums, game venues) and feeds Game Weather.
            </span>
          </div>
          {pullMsg && <p style={{ color: "var(--c-ok)", fontSize: "0.82rem" }}>{pullMsg}</p>}
          {pullError && <p style={{ color: "var(--c-err)", fontSize: "0.82rem" }}>{pullError}</p>}
        </div>
      )}
    </div>
  );
}
