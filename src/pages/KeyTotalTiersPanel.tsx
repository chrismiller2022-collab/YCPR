import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

// Plain capture table for the "key totals" tier data Chris has from an
// external source — no modeling logic here at all. Per Chris: actually
// factoring this into the Totals model "will take a full session," so
// this just gets the raw data (tier name, rank range, associated
// numbers, percentage range) into the site instead of living only in a
// screenshot, ready for that session whenever it happens.

interface TierRow {
  tier_number: number;
  tier_label: string;
  rank_range: string;
  numbers: string;
  pct_range: string;
}

const EMPTY_ROW: TierRow = { tier_number: 1, tier_label: "", rank_range: "", numbers: "", pct_range: "" };

async function saveTiers(season: number, week: number, rows: TierRow[]) {
  const password = sessionStorage.getItem("admin_password") ?? "";
  const res = await fetch("/api/pool-save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, pool: "keytotaltiers", action: "saveWeek", season, week, rows }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Save failed");
  return data;
}

export default function KeyTotalTiersPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [week, setWeek] = useState(1);
  const [rows, setRows] = useState<TierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    supabase
      .from("key_total_tiers")
      .select("*")
      .eq("season", season)
      .eq("week", week)
      .order("tier_number", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message ?? "Failed to load");
          setLoading(false);
          return;
        }
        setRows(
          data && data.length > 0
            ? data.map((d) => ({
                tier_number: d.tier_number,
                tier_label: d.tier_label ?? "",
                rank_range: d.rank_range ?? "",
                numbers: d.numbers ?? "",
                pct_range: d.pct_range ?? "",
              }))
            : [{ ...EMPTY_ROW, tier_number: 1 }]
        );
        setLoading(false);
      });
  }

  useEffect(load, [season, week]);

  function updateRow(index: number, patch: Partial<TierRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW, tier_number: prev.length + 1 }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      await saveTiers(season, week, rows.filter((r) => r.tier_label.trim() !== "" || r.numbers.trim() !== ""));
      setSaveMsg("Saved.");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Key Total Tiers</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Plain capture table for now — just gets this week's tier data saved somewhere on the
        site. Actually factoring it into the Totals model is a separate, bigger piece of work.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <label>
          Season <input type="number" value={season} onChange={(e) => setSeason(parseInt(e.target.value, 10) || season)} style={{ width: 80 }} />
        </label>
        <label>
          Week <input type="number" value={week} onChange={(e) => setWeek(parseInt(e.target.value, 10) || week)} style={{ width: 60 }} min={0} />
        </label>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem", marginBottom: "1rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Tier #</th>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Label</th>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Rank Range</th>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>Numbers</th>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>% Range</th>
                <th style={{ padding: "0.4rem 0.6rem", borderBottom: "1px solid var(--hash)" }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <input
                      type="number"
                      value={r.tier_number}
                      onChange={(e) => updateRow(i, { tier_number: parseInt(e.target.value, 10) || r.tier_number })}
                      style={{ width: 50 }}
                    />
                  </td>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <input
                      type="text"
                      placeholder="e.g. CRITICAL"
                      value={r.tier_label}
                      onChange={(e) => updateRow(i, { tier_label: e.target.value })}
                      style={{ width: 120 }}
                    />
                  </td>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <input
                      type="text"
                      placeholder="e.g. #1-5"
                      value={r.rank_range}
                      onChange={(e) => updateRow(i, { rank_range: e.target.value })}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <input
                      type="text"
                      placeholder="e.g. 55, 48, 58, 44, 51"
                      value={r.numbers}
                      onChange={(e) => updateRow(i, { numbers: e.target.value })}
                      style={{ width: 220 }}
                    />
                  </td>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <input
                      type="text"
                      placeholder="e.g. 3.0-3.8%"
                      value={r.pct_range}
                      onChange={(e) => updateRow(i, { pct_range: e.target.value })}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td style={{ padding: "0.3rem 0.6rem", borderBottom: "1px solid var(--hash)" }}>
                    <button className="menu-btn" onClick={() => removeRow(i)} title="Remove row">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button className="menu-btn" onClick={addRow} style={{ marginRight: "0.5rem" }}>
            + Add tier
          </button>
          <button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saveMsg && <span style={{ color: "green", marginLeft: "0.75rem" }}>{saveMsg}</span>}
          {error && <p style={{ color: "crimson" }}>{error}</p>}
        </>
      )}
    </div>
  );
}
