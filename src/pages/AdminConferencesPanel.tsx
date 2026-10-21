import { useEffect, useMemo, useState } from "react";
import SortHeader from "../components/SortHeader";
import TeamLink from "../components/TeamLink";
import { TEAMS, conferencesForDivision } from "../data/teams";
import { BLUE_CHIP_HFA } from "../data/blueChipHfa";
import { useWeeklyStats } from "../lib/api/weeklyStats";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { fetchTeamSos } from "../lib/api/ratingSystems";
import { fetchResumeRatingsAvailableWeeks, fetchResumeRatingsForWeek, fetchFinishedResumeAvailableWeeks, fetchFinishedResumeForWeek } from "../lib/api/resumeWeights";
import { fetchTeamHfa, fetchHfaSettings, indexTeamHfa, hfaAsOf } from "../lib/api/teamHfa";
import { DEFAULT_HFA_SETTINGS, teamHfa, type HfaSettings } from "../lib/hfaBacktest";
import { useLatestMonteCarloRun } from "../lib/futuresData";
import { useBetHistoryRecords } from "../lib/useBetHistoryRecords";
import { breakdownByConference, breakdownByTeam, DEFAULT_CUSTOM_PARAMS, emptyTally, winPct, type RecordTally } from "../lib/betHistory";
import { useAdminWeek } from "../lib/adminWeek";

// Admin Conferences: the public Conference Overview's numbers from the saved tables (live ratings, saved SOS Blend,
// both saved résumés, the latest Monte Carlo win totals) plus admin-only columns: the model's ATS record and bet
// record on each conference's games this season (frozen pregame projections where locked), non-conference record,
// and home-field advantage by source. Click a conference for its teams.

const SEASON = new Date().getFullYear();

interface Row {
  key: string;
  label: string;
  teams: number;
  rating: number | null;
  sos: number | null;
  resume: number | null;
  soFar: number | null;
  projWins: number | null;
  wins: number;
  losses: number;
  ncWins: number;
  ncLosses: number;
  ats: RecordTally;
  bets: RecordTally;
  hfaTeam: number | null; // the saved Team HFA blend
  hfaBlueChip: number | null;
  hfaMassey: number | null;
  hfaTr: number | null;
}

const avg = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const f = (v: number | null, d = 2) => (v == null ? "–" : v.toFixed(d));
const rec = (t: RecordTally) => (t.w + t.l === 0 ? "–" : `${t.w}-${t.l}${t.push ? `-${t.push}` : ""} (${winPct(t).toFixed(0)}%)`);

export default function AdminConferencesPanel() {
  const { week: adminWeek } = useAdminWeek();
  const [div, setDiv] = useState<"FBS" | "FCS">("FBS");
  const [openConf, setOpenConf] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof Row>("rating");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { byTeam: liveByTeam } = useWeeklyStats("latest");
  const { results: mc } = useLatestMonteCarloRun(SEASON);
  const { recordsLocked } = useBetHistoryRecords("team", "close");
  const [games, setGames] = useState<GameWithLines[]>([]);
  const [sos, setSos] = useState<Record<string, number | null>>({});
  const [resume, setResume] = useState<{ week: number | null; byTeam: Record<string, number | null> }>({ week: null, byTeam: {} });
  const [soFar, setSoFar] = useState<{ week: number | null; byTeam: Record<string, number | null> }>({ week: null, byTeam: {} });
  const [hfaIndex, setHfaIndex] = useState<ReturnType<typeof indexTeamHfa>>({});
  const [hfaSettings, setHfaSettings] = useState<HfaSettings>(DEFAULT_HFA_SETTINGS);

  useEffect(() => {
    fetchGamesWithLines(SEASON).then(setGames).catch(() => setGames([]));
    fetchTeamSos(SEASON)
      .then((m) => setSos(Object.fromEntries(Object.entries(m).map(([t, r]) => [t, r.blend_score]))))
      .catch(() => setSos({}));
    const latest = async (weeksFn: (s: number) => Promise<number[]>, rowsFn: (s: number, w: number) => Promise<Record<string, { score: number | null }>>) => {
      const weeks = await weeksFn(SEASON);
      const w = weeks.length ? Math.max(...weeks) : null;
      if (w == null) return { week: null, byTeam: {} };
      const rows = await rowsFn(SEASON, w);
      return { week: w, byTeam: Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.score])) };
    };
    latest(fetchResumeRatingsAvailableWeeks, fetchResumeRatingsForWeek).then(setResume).catch(() => {});
    latest(fetchFinishedResumeAvailableWeeks, fetchFinishedResumeForWeek).then(setSoFar).catch(() => {});
    fetchTeamHfa(SEASON).then((r) => setHfaIndex(indexTeamHfa(r))).catch(() => {});
    fetchHfaSettings(SEASON)
      .then((x) => x && setHfaSettings({ ...DEFAULT_HFA_SETTINGS, ...x, weights: { ...DEFAULT_HFA_SETTINGS.weights, ...(x.weights ?? {}) } } as HfaSettings))
      .catch(() => {});
  }, []);

  const confOf = useMemo(() => Object.fromEntries(TEAMS.map((t) => [t.team, t.conf])), []);
  const seasonRecords = useMemo(() => recordsLocked.filter((r) => r.season === SEASON), [recordsLocked]);
  const atsByConf = useMemo(() => breakdownByConference(seasonRecords, "custom", DEFAULT_CUSTOM_PARAMS), [seasonRecords]);
  const atsByTeam = useMemo(() => breakdownByTeam(seasonRecords, "custom", DEFAULT_CUSTOM_PARAMS), [seasonRecords]);

  // Straight-up and non-conference records from completed games.
  const records = useMemo(() => {
    const out: Record<string, { w: number; l: number; ncw: number; ncl: number }> = {};
    for (const g of games) {
      if (!g.completed || g.home_points == null || g.away_points == null || g.home_points === g.away_points) continue;
      const homeWon = g.home_points > g.away_points;
      const nonConf = confOf[g.home_team] !== confOf[g.away_team];
      for (const [team, won] of [
        [g.home_team, homeWon],
        [g.away_team, !homeWon],
      ] as const) {
        const r = (out[team] ??= { w: 0, l: 0, ncw: 0, ncl: 0 });
        if (won) r.w++;
        else r.l++;
        if (nonConf) {
          if (won) r.ncw++;
          else r.ncl++;
        }
      }
    }
    return out;
  }, [games, confOf]);

  function teamRow(team: string): Row {
    const live = liveByTeam[team];
    const base = TEAMS.find((t) => t.team === team);
    const sim = mc?.find((r) => r.team === team);
    const r = records[team] ?? { w: 0, l: 0, ncw: 0, ncl: 0 };
    return {
      key: team,
      label: team,
      teams: 1,
      rating: live?.rating ?? base?.rating ?? null,
      sos: sos[team] ?? null,
      resume: resume.byTeam[team] ?? null,
      soFar: soFar.byTeam[team] ?? null,
      projWins: sim?.meanWins ?? null,
      wins: r.w,
      losses: r.l,
      ncWins: r.ncw,
      ncLosses: r.ncl,
      ats: atsByTeam.everyBet.get(team) ?? emptyTally(),
      bets: atsByTeam.filteredBet.get(team) ?? emptyTally(),
      hfaTeam: teamHfa({ index: hfaIndex, elevationM: {} }, hfaSettings, team, adminWeek),
      hfaBlueChip: BLUE_CHIP_HFA[team] ?? null,
      hfaMassey: hfaAsOf(hfaIndex, "massey", team, adminWeek)?.value ?? null,
      hfaTr: hfaAsOf(hfaIndex, "tr", team, adminWeek)?.value ?? null,
    };
  }

  const confRows: Row[] = useMemo(
    () =>
      conferencesForDivision(div).map((conf) => {
        const teams = TEAMS.filter((t) => t.div === div && t.conf === conf).map((t) => teamRow(t.team));
        return {
          key: conf,
          label: conf,
          teams: teams.length,
          rating: avg(teams.map((t) => t.rating)),
          sos: avg(teams.map((t) => t.sos)),
          resume: avg(teams.map((t) => t.resume)),
          soFar: avg(teams.map((t) => t.soFar)),
          projWins: sum(teams.map((t) => t.projWins)),
          wins: teams.reduce((a, t) => a + t.wins, 0),
          losses: teams.reduce((a, t) => a + t.losses, 0),
          ncWins: teams.reduce((a, t) => a + t.ncWins, 0),
          ncLosses: teams.reduce((a, t) => a + t.ncLosses, 0),
          // A game counts once per team in it, same as Bet History's conference breakdown.
          ats: atsByConf.everyBet.get(conf) ?? emptyTally(),
          bets: atsByConf.filteredBet.get(conf) ?? emptyTally(),
          hfaTeam: avg(teams.map((t) => t.hfaTeam)),
          hfaBlueChip: avg(teams.map((t) => t.hfaBlueChip)),
          hfaMassey: avg(teams.map((t) => t.hfaMassey)),
          hfaTr: avg(teams.map((t) => t.hfaTr)),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [div, liveByTeam, mc, sos, resume, soFar, records, atsByConf, atsByTeam, hfaIndex, hfaSettings, adminWeek]
  );

  const shown = useMemo(() => {
    const base = openConf ? TEAMS.filter((t) => t.div === div && t.conf === openConf).map((t) => teamRow(t.team)) : confRows;
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: Row): number | string | null => {
      const v = r[sortKey];
      if (typeof v === "object" && v && "w" in v) return winPct(v as RecordTally);
      return v as number | string | null;
    };
    return [...base].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return dir * av.localeCompare(String(bv));
      return dir * ((av as number) - (bv as number));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConf, confRows, sortKey, sortDir, div]);

  function onSort(k: string) {
    const key = k as keyof Row;
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      // Lower is better for rating and SOS (harder schedule); higher is better for everything else.
      setSortDir(key === "rating" || key === "sos" || key === "label" ? "asc" : "desc");
    }
  }
  const th = (label: string, k: keyof Row, title?: string) => (
    <SortHeader label={<span title={title}>{label}</span>} sortKey={k} active={sortKey === k} dir={sortDir} onClick={onSort} align={k === "label" ? undefined : "right"} />
  );

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Conferences</h2>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <button className={`mode-btn ${div === "FBS" ? "mode-btn-active" : ""}`} onClick={() => { setDiv("FBS"); setOpenConf(null); }}>FBS</button>
        <button className={`mode-btn ${div === "FCS" ? "mode-btn-active" : ""}`} onClick={() => { setDiv("FCS"); setOpenConf(null); }}>FCS</button>
        {openConf && (
          <button className="menu-btn" onClick={() => setOpenConf(null)}>
            ← All conferences
          </button>
        )}
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
          SOS Blend latest saved week · Projected résumé week {resume.week ?? "–"} · So far week {soFar.week ?? "–"} · win totals from the latest Monte Carlo run · ATS = the model on every
          game, Bets = Filtered signals, {SEASON} only, frozen projections where locked.
        </span>
      </div>
      {openConf && <h3 style={{ margin: "0 0 0.5rem" }}>{openConf}</h3>}
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <table className="hfa-table">
          <thead>
            <tr>
              {th(openConf ? "Team" : "Conference", "label")}
              {!openConf && th("Teams", "teams")}
              {th("Rating", "rating", "Live YC power rating (lower is better)")}
              {th("SOS Blend", "sos", "-10 hardest .. +10 easiest")}
              {th("Projected résumé", "resume")}
              {th("Résumé so far", "soFar")}
              {th(openConf ? "Proj. wins" : "Proj. wins (sum)", "projWins")}
              {th("W-L", "wins")}
              {th("Non-conf W-L", "ncWins")}
              {th("Model ATS", "ats")}
              {th("Bets (Filtered)", "bets")}
              {th("Team HFA", "hfaTeam", "The saved blend from Teams → HFA")}
              {th("HFA Blue Chip", "hfaBlueChip")}
              {th("HFA Massey", "hfaMassey")}
              {th("HFA TR ÷10", "hfaTr")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td>
                  {openConf ? (
                    <TeamLink team={r.label} size={16} />
                  ) : (
                    <button className="link-btn" onClick={() => setOpenConf(r.key)} style={{ background: "none", border: "none", color: "var(--gold)", cursor: "pointer", padding: 0, font: "inherit" }}>
                      {r.label}
                    </button>
                  )}
                </td>
                {!openConf && <td className="td-right">{r.teams}</td>}
                <td className="td-right">{f(r.rating)}</td>
                <td className="td-right">{f(r.sos)}</td>
                <td className="td-right">{f(r.resume)}</td>
                <td className="td-right">{f(r.soFar)}</td>
                <td className="td-right">{f(r.projWins, 1)}</td>
                <td className="td-right">
                  {r.wins}-{r.losses}
                </td>
                <td className="td-right">
                  {r.ncWins}-{r.ncLosses}
                </td>
                <td className="td-right">{rec(r.ats)}</td>
                <td className="td-right">{rec(r.bets)}</td>
                <td className="td-right" style={{ fontWeight: 700 }}>{f(r.hfaTeam)}</td>
                <td className="td-right">{f(r.hfaBlueChip, 1)}</td>
                <td className="td-right">{f(r.hfaMassey)}</td>
                <td className="td-right">{f(r.hfaTr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
