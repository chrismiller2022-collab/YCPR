import { useEffect, useState } from "react";
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

export default function SurvivorPoolAdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"settings" | "entrants" | "picks">("settings");
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
      </div>

      {tab === "settings" && <SettingsTab season={season} />}
      {tab === "entrants" && <EntrantsTab season={season} />}
      {tab === "picks" && <PicksTab season={season} />}
    </div>
  );
}
