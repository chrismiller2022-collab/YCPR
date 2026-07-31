import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { availableConferences } from "../lib/survivor";
import {
  fetchSurvivorPoolSettings,
  fetchSurvivorPoolEntrants,
  saveSurvivorPoolSettings,
  addSurvivorPoolEntrant,
  removeSurvivorPoolEntrant,
  type SurvivorPoolEntrant,
} from "../lib/api/survivorPoolAdmin";

// ---------------------------------------------------------------------
// Settings tab — one-time conference selection for the whole season.
// ---------------------------------------------------------------------
function SettingsTab({ season }: { season: number }) {
  const allConfs = availableConferences();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSurvivorPoolSettings(season)
      .then((s) => setSelected(new Set(s?.conferences ?? [])))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [season]);

  function toggle(conf: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(conf)) next.delete(conf);
      else next.add(conf);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      await saveSurvivorPoolSettings(season, Array.from(selected));
      setSaveMsg("Saved.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p>Loading settings…</p>;

  return (
    <div>
      <div className="section-label">Conferences in scope for {season}</div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem", marginTop: 0 }}>
        Set once for the whole season — entrants never choose this themselves. Every week's
        grid will only show games involving these conferences.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1rem" }}>
        {allConfs.map((conf) => {
          const active = selected.has(conf);
          return (
            <button
              key={conf}
              onClick={() => toggle(conf)}
              style={{
                fontSize: "0.82rem",
                padding: "0.4rem 0.75rem",
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

      <button onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save conferences"}
      </button>
      {saveMsg && <span style={{ color: "green", marginLeft: "0.75rem" }}>{saveMsg}</span>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Entrants tab — add/remove entrants, copy their private link.
// ---------------------------------------------------------------------
function EntrantsTab({ season }: { season: number }) {
  const [entrants, setEntrants] = useState<SurvivorPoolEntrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetchSurvivorPoolEntrants(season)
      .then(setEntrants)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [season]);

  function linkFor(slug: string) {
    return `${window.location.origin}${window.location.pathname}#survivorpool-${slug}`;
  }

  async function handleAdd() {
    if (!name.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addSurvivorPoolEntrant(season, name.trim());
      setName("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: number, entrantName: string) {
    if (!confirm(`Remove ${entrantName} from the pool? This cannot be undone.`)) return;
    try {
      await removeSurvivorPoolEntrant(id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function copyLink(slug: string) {
    try {
      await navigator.clipboard.writeText(linkFor(slug));
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 1500);
    } catch {
      // clipboard permissions can fail silently in some browsers — no-op
    }
  }

  return (
    <div>
      <div className="section-label">Entrants — {season}</div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem", marginTop: 0 }}>
        Each entrant gets a private link — no signup, no password. Anyone with the link can
        pick as that entrant, so only share it with the person it's for.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <input
          placeholder="Entrant name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          style={{ flex: 1, maxWidth: 260 }}
        />
        <button onClick={handleAdd} disabled={adding || !name.trim()}>
          {adding ? "Adding…" : "Add entrant"}
        </button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {loading ? (
        <p>Loading entrants…</p>
      ) : entrants.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No entrants yet.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Name</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Link</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Added</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}></th>
              </tr>
            </thead>
            <tbody>
              {entrants.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{e.name}</td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <code style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{linkFor(e.slug)}</code>
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    {new Date(e.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", whiteSpace: "nowrap" }}>
                    <button className="menu-btn" style={{ marginRight: "0.4rem" }} onClick={() => copyLink(e.slug)}>
                      {copiedSlug === e.slug ? "Copied!" : "Copy link"}
                    </button>
                    <button className="menu-btn" onClick={() => handleRemove(e.id, e.name)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="footer-note" style={{ marginTop: "1rem" }}>
        Note: the link itself doesn't go anywhere yet — the public pick page is the next
        piece to build. This tab just sets up entrants and their links ahead of that.
      </p>
    </div>
  );
}

import { fetchPoolSeasonGames, fetchAllSeasonPicks, gradePickResult, type PoolGameRow } from "../lib/api/survivorPoolPublic";

// ---------------------------------------------------------------------
// FPI Ratings tab — lets you confirm the FPI sync actually populated
// data (and spot-check the values) without having to go dig through
// Games & Lines. If spreads aren't showing in FPI mode on the public
// grid, this is the first place to check — an empty table here means
// the sync hasn't been run yet (or returned no matching rows) for this
// season, not a bug in the grid itself.
// ---------------------------------------------------------------------
function FpiRatingsTab({ season }: { season: number }) {
  const [rows, setRows] = useState<{ team: string; conference: string | null; fpi: number | null; updated_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // CFBD may not have FPI published yet for the current season (e.g. very
  // early/preseason) — sourceYear lets you pull a different year's FPI
  // (like last season's) as a placeholder, saved tagged under `season`.
  const [sourceYear, setSourceYear] = useState(season);

  const [manualTeam, setManualTeam] = useState("");
  const [manualConf, setManualConf] = useState("");
  const [manualFpi, setManualFpi] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualMsg, setManualMsg] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    supabase
      .from("fpi_ratings")
      .select("team, conference, fpi, updated_at")
      .eq("season", season)
      .order("team", { ascending: true })
      .then(({ data, error: err }: any) => {
        if (err) {
          setError(err.message);
        } else {
          setRows(data ?? []);
        }
        setLoading(false);
      });
  }

  useEffect(load, [season]);
  useEffect(() => setSourceYear(season), [season]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    setSyncError(null);
    try {
      const password = sessionStorage.getItem("admin_password") ?? "";
      const res = await fetch("/api/fpi-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, year: season, sourceYear }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSyncError(data.error ?? "FPI sync failed");
      } else {
        const sourceNote = data.sourceYear !== season ? ` (pulled from CFBD's ${data.sourceYear} data)` : "";
        setSyncMsg(`Synced FPI ratings for ${data.saved} of ${data.fetched} teams, saved under season ${season}${sourceNote}.`);
        load();
      }
    } catch (err: any) {
      setSyncError(err.message ?? "FPI sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleManualSave() {
    if (!manualTeam.trim() || manualFpi.trim() === "") return;
    setManualSaving(true);
    setManualMsg(null);
    setManualError(null);
    try {
      const password = sessionStorage.getItem("admin_password") ?? "";
      const res = await fetch("/api/fpi-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          year: season,
          action: "manualUpsert",
          team: manualTeam.trim(),
          conference: manualConf.trim() || null,
          fpi: Number(manualFpi),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.error ?? "Save failed");
      } else {
        setManualMsg(`Saved ${manualTeam.trim()}.`);
        setManualTeam("");
        setManualConf("");
        setManualFpi("");
        load();
      }
    } catch (err: any) {
      setManualError(err.message ?? "Save failed");
    } finally {
      setManualSaving(false);
    }
  }

  const filtered = rows.filter((r) => !query.trim() || r.team.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div>
      <div className="section-label">FPI Ratings — {season}</div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem", marginTop: 0 }}>
        Diagnostic view for the public pool's FPI spread mode. If this table is empty, the
        public grid's "FPI" odds toggle won't show any spreads either.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.82rem" }}>
          Pull from CFBD's{" "}
          <input
            type="number"
            value={sourceYear}
            onChange={(e) => setSourceYear(parseInt(e.target.value, 10) || sourceYear)}
            style={{ width: 80 }}
          />{" "}
          data
        </label>
        <button onClick={handleSync} disabled={syncing}>
          {syncing ? "Syncing…" : `Sync FPI Ratings (save as ${season})`}
        </button>
        <input
          placeholder="Filter by team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 160, maxWidth: 260 }}
        />
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        If CFBD doesn't have {season} FPI published yet (common very early in a season), set
        the source year above to something like {season - 1} — it'll still be saved under
        season {season} as a placeholder.
      </p>

      {syncMsg && <p style={{ color: "green" }}>{syncMsg}</p>}
      {syncError && <p style={{ color: "crimson" }}>{syncError}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <div style={{ marginTop: "1rem", marginBottom: "1.25rem", padding: "0.75rem", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Manually add/edit one team (for placeholder values without a CFBD pull)
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="Team name" value={manualTeam} onChange={(e) => setManualTeam(e.target.value)} style={{ minWidth: 160 }} />
          <input placeholder="Conference (optional)" value={manualConf} onChange={(e) => setManualConf(e.target.value)} style={{ minWidth: 140 }} />
          <input placeholder="FPI value" type="number" value={manualFpi} onChange={(e) => setManualFpi(e.target.value)} style={{ width: 100 }} />
          <button onClick={handleManualSave} disabled={manualSaving || !manualTeam.trim() || manualFpi.trim() === ""}>
            {manualSaving ? "Saving…" : "Save"}
          </button>
        </div>
        {manualMsg && <p style={{ color: "green", marginTop: "0.5rem" }}>{manualMsg}</p>}
        {manualError && <p style={{ color: "crimson", marginTop: "0.5rem" }}>{manualError}</p>}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "#a15c00" }}>No FPI ratings saved for {season} yet — sync or add one manually above.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8, maxHeight: 500, overflowY: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>
                  Team
                </th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>
                  Conference
                </th>
                <th style={{ textAlign: "right", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>
                  FPI
                </th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", top: 0, background: "var(--turf-panel-2)" }}>
                  Last synced
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.team}>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.team}</td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{r.conference ?? "–"}</td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)", textAlign: "right" }}>
                    {r.fpi != null ? r.fpi.toFixed(1) : "–"}
                  </td>
                  <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    {new Date(r.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: "0.75rem" }}>
        {rows.length} teams total{query.trim() ? `, ${filtered.length} shown` : ""}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Picks tab — everyone's picks, always visible here regardless of
// deadline (this is the admin-gated view, not the public reveal-after-
// deadline one).
// ---------------------------------------------------------------------
function PicksTab({ season }: { season: number }) {
  const [entrants, setEntrants] = useState<SurvivorPoolEntrant[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [poolGames, setPoolGames] = useState<PoolGameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const settings = await fetchSurvivorPoolSettings(season);
        const confs = settings?.conferences ?? [];
        const [e, p, g] = await Promise.all([
          fetchSurvivorPoolEntrants(season),
          fetchAllSeasonPicks(season),
          fetchPoolSeasonGames(season, confs),
        ]);
        setEntrants(e);
        setPicks(p);
        setPoolGames(g);
      } catch (err: any) {
        setError(err.message ?? "Failed to load picks");
      } finally {
        setLoading(false);
      }
    })();
  }, [season]);

  const gamesById = new Map(poolGames.map((g) => [g.gameId, g]));
  const entrantNameById = new Map(entrants.map((e) => [e.id, e.name]));

  if (loading) return <p>Loading picks…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;

  return (
    <div>
      <div className="section-label">All picks — {season}</div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem", marginTop: 0 }}>
        Always fully visible here, regardless of the public reveal-after-deadline rule —
        this is the admin view.
      </p>

      {picks.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No picks submitted yet.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Entrant</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Week</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Team</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Submitted At</th>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {picks.map((p) => {
                const result = gradePickResult(p, gamesById);
                return (
                  <tr key={p.id}>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                      {entrantNameById.get(p.entrant_id) ?? `#${p.entrant_id}`}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{p.week}</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>{p.team}</td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                      {new Date(p.submitted_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                      {result === "pending" ? "–" : result === "win" ? "✅ Win" : "❌ Loss"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: "1rem" }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.open(`#survivorpool-standings-${season}`, "_blank");
          }}
        >
          Open public standings page ↗
        </a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Private Standings tab — like the public standings page, but NEVER
// gated by the reveal deadline. Shows submission time per pick and
// flags any past-or-current week where an entrant is missing one or
// both picks, so you know exactly who to remind.
// ---------------------------------------------------------------------
function PrivateStandingsTab({ season }: { season: number }) {
  const [entrants, setEntrants] = useState<SurvivorPoolEntrant[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [poolGames, setPoolGames] = useState<PoolGameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const settings = await fetchSurvivorPoolSettings(season);
        const confs = settings?.conferences ?? [];
        const [e, p, g] = await Promise.all([
          fetchSurvivorPoolEntrants(season),
          fetchAllSeasonPicks(season),
          fetchPoolSeasonGames(season, confs),
        ]);
        setEntrants(e);
        setPicks(p);
        setPoolGames(g);
      } catch (err: any) {
        setError(err.message ?? "Failed to load standings");
      } finally {
        setLoading(false);
      }
    })();
  }, [season]);

  const gamesById = new Map(poolGames.map((g) => [g.gameId, g]));
  const weeks = Array.from(new Set(poolGames.map((g) => g.week))).sort((a, b) => a - b);
  const currentWeek = (() => {
    const completed = poolGames.filter((g) => g.completed).map((g) => g.week);
    return completed.length > 0 ? Math.max(...completed) + 1 : weeks[0] ?? 1;
  })();

  const picksByEntrant = new Map<number, Map<number, any[]>>();
  for (const p of picks) {
    const inner = picksByEntrant.get(p.entrant_id) ?? new Map<number, any[]>();
    const list = inner.get(p.week) ?? [];
    list.push(p);
    inner.set(p.week, list);
    picksByEntrant.set(p.entrant_id, inner);
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;

  return (
    <div>
      <div className="section-label">Private Standings — {season}</div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.82rem", marginTop: 0 }}>
        Same shape as the public standings page, but never withheld by the reveal deadline —
        every pick and its submission time is visible here immediately, and any week up to
        and including the current one with fewer than 2 picks is flagged in red so you know
        who to remind.
      </p>

      {entrants.length === 0 ? (
        <p style={{ color: "var(--chalk-dim)" }}>No entrants in this pool yet.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--hash)", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem 0.6rem", borderBottom: "1px solid var(--hash)", position: "sticky", left: 0, background: "var(--turf-panel-2)", zIndex: 1 }}>
                  Entrant
                </th>
                {weeks.map((w) => (
                  <th key={w} style={{ padding: "0.4rem 0.5rem", textAlign: "center", minWidth: 130, borderBottom: "1px solid var(--hash)" }}>
                    Wk {w}
                    {w === currentWeek && <div style={{ fontSize: "0.62rem", fontWeight: 400 }}>(current)</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entrants.map((entrant) => {
                const inner = picksByEntrant.get(entrant.id) ?? new Map<number, any[]>();
                return (
                  <tr key={entrant.id}>
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        background: "var(--turf-panel)",
                        padding: "0.4rem 0.75rem",
                        borderBottom: "1px solid var(--hash)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {entrant.name}
                    </td>
                    {weeks.map((w) => {
                      const weekPicks: any[] = inner.get(w) ?? [];
                      const needsAttention = w <= currentWeek && weekPicks.length < 2;
                      return (
                        <td
                          key={w}
                          style={{
                            padding: "0.4rem 0.5rem",
                            borderBottom: "1px solid var(--hash)",
                            textAlign: "center",
                            background: needsAttention ? "rgba(196,92,82,0.15)" : undefined,
                          }}
                        >
                          {weekPicks.length === 0 ? (
                            w <= currentWeek ? (
                              <span style={{ color: "#c45c52", fontWeight: 700 }}>NEEDS PICKS</span>
                            ) : (
                              <span style={{ color: "var(--chalk-dim)" }}>–</span>
                            )
                          ) : (
                            <>
                              {weekPicks.map((p, i) => {
                                const result = gradePickResult(p, gamesById);
                                return (
                                  <div key={i} style={{ marginBottom: "0.1rem" }}>
                                    <span style={{ color: result === "loss" ? "#c45c52" : result === "win" ? "#8fd39a" : undefined }}>
                                      {p.team}
                                    </span>
                                    {result !== "pending" && <span style={{ fontSize: "0.65rem" }}>{result === "win" ? " ✅" : " ❌"}</span>}
                                    <div style={{ fontSize: "0.62rem", color: "var(--chalk-dim)" }}>
                                      {new Date(p.submitted_at).toLocaleString(undefined, {
                                        month: "short",
                                        day: "numeric",
                                        hour: "numeric",
                                        minute: "2-digit",
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                              {weekPicks.length < 2 && w <= currentWeek && (
                                <div style={{ fontSize: "0.65rem", color: "#c45c52", fontWeight: 700 }}>MISSING 1</div>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SurvivorPoolAdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"settings" | "entrants" | "picks" | "fpiratings" | "privatestandings">("settings");
  const [season, setSeason] = useState(new Date().getFullYear());

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2 style={{ marginTop: 0 }}>Survivor Pool (Public)</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        A separate, public-facing survivor pool for others to join — distinct from your own
        Survivor tool under Admin. This is step 1: one-time conference scope and entrant
        management. The public grid, picks, and reveal logic come next.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <label>
          Season{" "}
          <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 90 }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem" }}>
        <button className={`mode-btn ${tab === "settings" ? "mode-btn-active" : ""}`} onClick={() => setTab("settings")}>
          Settings
        </button>
        <button className={`mode-btn ${tab === "entrants" ? "mode-btn-active" : ""}`} onClick={() => setTab("entrants")}>
          Entrants
        </button>
        <button className={`mode-btn ${tab === "picks" ? "mode-btn-active" : ""}`} onClick={() => setTab("picks")}>
          Picks
        </button>
        <button className={`mode-btn ${tab === "fpiratings" ? "mode-btn-active" : ""}`} onClick={() => setTab("fpiratings")}>
          FPI Ratings
        </button>
        <button className={`mode-btn ${tab === "privatestandings" ? "mode-btn-active" : ""}`} onClick={() => setTab("privatestandings")}>
          Private Standings
        </button>
      </div>

      {tab === "settings" && <SettingsTab season={season} />}
      {tab === "entrants" && <EntrantsTab season={season} />}
      {tab === "picks" && <PicksTab season={season} />}
      {tab === "fpiratings" && <FpiRatingsTab season={season} />}
      {tab === "privatestandings" && <PrivateStandingsTab season={season} />}
    </div>
  );
}
