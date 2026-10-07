import { useEffect, useMemo, useState, type CSSProperties } from "react";
import SortHeader from "./SortHeader";
import TeamLink from "./TeamLink";
import { TEAMS_BY_NAME } from "../data/teams";
import { matchTeamName } from "../lib/teamNameMatch";
import { fetchGamesWithLines } from "../lib/api/gamesLines";
import { fetchTeamSos } from "../lib/api/ratingSystems";
import { fetchWinTotalLines, saveWinTotalLines, type WinTotalLineRow } from "../lib/api/winTotalLines";
import { DEFAULT_PR_WEIGHT, DEFAULT_SOS_WEIGHT, PRICE_POINTS_PER_HALF_WIN, computeWinTotalPr, type WinTotalInput } from "../lib/winTotalPr";

const cell: CSSProperties = { padding: "0.3rem 0.5rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right" };

const f = (v: number | null | undefined, d = 2) => (v == null ? "–" : v.toFixed(d));
const sgn = (v: number | null | undefined, d = 2) => (v == null ? "–" : `${v > 0 ? "+" : ""}${v.toFixed(d)}`);
const price = (v: number) => (v > 0 ? `+${v}` : `${v}`);

interface Parsed {
  rows: { team: string; line: number; overPrice: number; underPrice: number }[];
  unmatched: string[];
  skipped: number;
}

/** Paste from the sheet: team, line, over price, under price (tab- or comma-separated; a header row is ignored). */
function parsePaste(text: string): Parsed {
  const rows: Parsed["rows"] = [];
  const unmatched: string[] = [];
  let skipped = 0;
  const byTeam = new Map<string, Parsed["rows"][number]>();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.split(/\t|,/).map((c) => c.trim());
    if (cells.length < 4) {
      skipped++;
      continue;
    }
    const [name, lineS, overS, underS] = cells;
    const line = Number(lineS);
    const over = Number(overS.replace("+", ""));
    const under = Number(underS.replace("+", ""));
    if ([line, over, under].some((v) => Number.isNaN(v))) {
      skipped++; // header row or junk
      continue;
    }
    const m = matchTeamName(name);
    if (!m.matched) {
      unmatched.push(name);
      continue;
    }
    byTeam.set(m.matched, { team: m.matched, line, overPrice: over, underPrice: under });
  }
  rows.push(...byTeam.values());
  return { rows, unmatched, skipped };
}

export default function WinTotalPrTab({ season }: { season: number }) {
  const [lines, setLines] = useState<WinTotalLineRow[]>([]);
  const [gamesByTeam, setGamesByTeam] = useState<Record<string, number>>({});
  const [sosByTeam, setSosByTeam] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [paste, setPaste] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [prWeight, setPrWeight] = useState(DEFAULT_PR_WEIGHT);
  const [sosWeight, setSosWeight] = useState(DEFAULT_SOS_WEIGHT);
  const [division, setDivision] = useState<"FBS" | "FCS" | "all">("FBS");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("pr");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchWinTotalLines(season), fetchGamesWithLines(season), fetchTeamSos(season)])
      .then(([l, games, sos]) => {
        if (cancelled) return;
        setLines(l);
        const counts: Record<string, number> = {};
        for (const g of games) {
          counts[g.home_team] = (counts[g.home_team] ?? 0) + 1;
          counts[g.away_team] = (counts[g.away_team] ?? 0) + 1;
        }
        setGamesByTeam(counts);
        setSosByTeam(Object.fromEntries(Object.entries(sos).map(([t, r]) => [t, r.blend_score ?? null])));
      })
      .catch((e) => !cancelled && setError(e.message ?? "Failed to load"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [season, reload]);

  const parsed = useMemo(() => parsePaste(paste), [paste]);

  async function handleSave() {
    if (parsed.rows.length === 0) return;
    const overwriting = parsed.rows.filter((r) => lines.some((l) => l.team === r.team)).length;
    if (overwriting > 0 && !window.confirm(`${overwriting} of these teams already have a saved ${season} line. Replace them?`)) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await saveWinTotalLines(season, parsed.rows, "pasted");
      setSaveMsg(`Saved ${r.saved} team lines.`);
      setPaste("");
      setReload((n) => n + 1);
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message ?? "Save failed"}`);
    } finally {
      setSaving(false);
    }
  }

  const computed = useMemo(() => {
    const inputs: WinTotalInput[] = lines.map((l) => ({
      team: l.team,
      line: l.line,
      overPrice: l.overPrice,
      underPrice: l.underPrice,
      games: gamesByTeam[l.team] ?? null,
      sos: sosByTeam[l.team] ?? null,
      isFbs: TEAMS_BY_NAME[l.team]?.div === "FBS",
    }));
    return computeWinTotalPr(inputs, prWeight, sosWeight);
  }, [lines, gamesByTeam, sosByTeam, prWeight, sosWeight]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = computed
      .filter((r) => {
        const div = TEAMS_BY_NAME[r.team]?.div;
        return (division === "all" || div === division) && (!q || r.team.toLowerCase().includes(q));
      })
      .map((r) => ({ ...r, conf: TEAMS_BY_NAME[r.team]?.conf ?? "" }));
    return list.sort((a: any, b: any) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [computed, division, query, sortKey, sortDir]);

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "team" || key === "conf" ? "asc" : "asc");
    }
  }
  const H = (label: string, key: string, right = true) => (
    <SortHeader key={key} label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} align={right ? "right" : undefined} />
  );

  const missingFbs = useMemo(() => {
    const have = new Set(lines.map((l) => l.team));
    return Object.values(TEAMS_BY_NAME).filter((t) => t.div === "FBS" && !have.has(t.team)).length;
  }, [lines]);

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        A power rating from the preseason win-total market. Each side's price is converted to "hold" (points worse than -110, counting the gap across even money as 200); each
        side's implied line moves {PRICE_POINTS_PER_HALF_WIN} price points per half win (over up, under down); the no-vig line is the midpoint of the two; ÷ games scheduled
        gives an average win % (never below 0); then min / median / max across FBS maps it to -25 (best) .. +25 (worst). The last two columns blend in the latest SOS blend and
        rescale. Example: 9.5, over -160, under -120 → holds 50 / 10, lines 10.00 / 9.40, no-vig 9.70.
      </p>

      <div style={{ border: "1px solid var(--hash)", borderRadius: 8, padding: "0.8rem 1rem", marginBottom: "1rem" }}>
        <div className="section-label" style={{ marginBottom: "0.4rem" }}>
          Load lines ({season}) — paste from the sheet
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={"Team\tLine\tOver\tUnder\nGeorgia\t10.5\t-160\t-120"}
          rows={5}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "0.78rem" }}
        />
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.4rem" }}>
          <button className="menu-btn" onClick={handleSave} disabled={saving || parsed.rows.length === 0}>
            {saving ? "Saving…" : `Save ${parsed.rows.length} team line${parsed.rows.length === 1 ? "" : "s"}`}
          </button>
          <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>
            {paste.trim() ? `${parsed.rows.length} parsed${parsed.skipped ? `, ${parsed.skipped} skipped (header/blank)` : ""}` : "Columns: team, line, over price, under price."}
          </span>
          {parsed.unmatched.length > 0 && <span style={{ fontSize: "0.78rem", color: "#d9a441" }}>Unmatched: {parsed.unmatched.join(", ")}</span>}
          {saveMsg && <span style={{ fontSize: "0.8rem", color: saveMsg.startsWith("Error") ? "#c45c52" : "#8fd39a" }}>{saveMsg}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
        {(["FBS", "FCS", "all"] as const).map((d) => (
          <button key={d} className={`mode-btn ${division === d ? "mode-btn-active" : ""}`} onClick={() => setDivision(d)}>
            {d === "all" ? "All" : d}
          </button>
        ))}
        <input className="search" placeholder="Search for a team…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 180 }} />
        <label style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }} title="Weight on the Win Total PR in the SOS-adjusted column">
          PR weight
          <input type="number" step="0.05" value={prWeight} onChange={(e) => setPrWeight(parseFloat(e.target.value) || 0)} style={{ width: 62 }} />
        </label>
        <label style={{ fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.3rem" }} title="Weight on the SOS blend (-10 hardest .. +10 easiest) in the SOS-adjusted column">
          SOS weight
          <input type="number" step="0.05" value={sosWeight} onChange={(e) => setSosWeight(parseFloat(e.target.value) || 0)} style={{ width: 62 }} />
        </label>
        {missingFbs > 0 && lines.length > 0 && <span style={{ fontSize: "0.78rem", color: "#d9a441" }}>{missingFbs} FBS teams have no line yet — min/median/max use only teams with lines.</span>}
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : lines.length === 0 ? (
        <p style={{ fontSize: "0.85rem" }}>No lines saved for {season} yet — paste them above.</p>
      ) : (
        <div className="table-scroll" style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 760, overflowY: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.76rem" }}>
            <thead>
              <tr>
                {H("Team", "team", false)}
                {H("Conf", "conf", false)}
                {H("Line", "line")}
                {H("Over", "overPrice")}
                {H("Under", "underPrice")}
                {H("Over vig", "overHold")}
                {H("Under vig", "underHold")}
                {H("Hold", "hold")}
                {H("Over line", "overLine")}
                {H("Under line", "underLine")}
                {H("No-vig line", "noVigLine")}
                {H("Games", "games")}
                {H("Avg win %", "avgWinPct")}
                {H("Win Total PR", "pr")}
                {H("SOS blend", "sos")}
                {H("SOS-adj (weighted)", "adjusted")}
                {H("PR + SOS (-25..+25)", "prSos")}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.team}>
                  <td style={{ ...cell, fontWeight: 700 }}>
                    <TeamLink team={r.team} />
                  </td>
                  <td style={cell}>{r.conf}</td>
                  <td style={num}>{f(r.line, 1)}</td>
                  <td style={num}>{price(r.overPrice)}</td>
                  <td style={num}>{price(r.underPrice)}</td>
                  <td style={num}>{r.overHold}</td>
                  <td style={num}>{r.underHold}</td>
                  <td style={num}>{r.hold}</td>
                  <td style={num}>{f(r.overLine)}</td>
                  <td style={num}>{f(r.underLine)}</td>
                  <td style={{ ...num, fontWeight: 700 }}>{f(r.noVigLine)}</td>
                  <td style={num}>{r.games ?? "–"}</td>
                  <td style={num}>{r.avgWinPct != null ? r.avgWinPct.toFixed(4) : "–"}</td>
                  <td style={{ ...num, fontWeight: 700, color: r.pr == null ? undefined : r.pr < 0 ? "#8fd39a" : r.pr > 0 ? "#e07a7a" : undefined }}>{sgn(r.pr)}</td>
                  <td style={num}>{sgn(r.sos)}</td>
                  <td style={num}>{sgn(r.adjusted)}</td>
                  <td style={{ ...num, fontWeight: 700, color: r.prSos == null ? undefined : r.prSos < 0 ? "#8fd39a" : r.prSos > 0 ? "#e07a7a" : undefined }}>{sgn(r.prSos)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={17} className="empty">
                    No teams match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
