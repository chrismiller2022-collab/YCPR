import { useMemo, useState } from "react";

// Maps flexible/human column headers (however you happen to label them when
// pasting from a spreadsheet) to the actual database column names.
const HEADER_ALIASES: Record<string, string> = {
  team: "team",
  rating: "rating",
  "power rating": "rating",
  rank: "rank",
  sor: "sor",
  sos: "sor",
  "strength of resume": "sor",
  "strength of schedule": "sor",
  "resume rank": "resume_rank",
  "resume rating": "resume_rating",
  "total wins": "total_wins",
  "conf proj wins": "conf_proj_wins",
  "conference projected wins": "conf_proj_wins",
  "conf line": "conf_line",
  "conference line": "conf_line",
  dif: "dif",
  diff: "dif",
  abs: "abs_dif",
  "abs dif": "abs_dif",
  bet: "bet",
  edge: "edge",
  "conf win pct": "conf_win_pct",
  "conference win %": "conf_win_pct",
  "fair price": "fair_price",
  "implied pct": "implied_pct",
  "implied %": "implied_pct",
  odds: "odds",
  value: "value",
  "natty odds": "natty_odds",
  "natl champ odds": "natty_odds",
};

const NUMERIC_FIELDS = new Set([
  "rating",
  "rank",
  "sor",
  "resume_rank",
  "resume_rating",
  "total_wins",
  "conf_proj_wins",
  "conf_line",
  "dif",
  "abs_dif",
  "edge",
  "conf_win_pct",
  "fair_price",
  "implied_pct",
  "odds",
  "value",
  "natty_odds",
]);

const WEEK_OPTIONS = [
  "preseason",
  ...Array.from({ length: 16 }, (_, i) => `week${i + 1}`),
];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function parsePaste(raw: string) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [] as any[], unmatchedHeaders: [] as string[], headerMap: {} as Record<string, string> };
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const rawHeaders = lines[0].split(delimiter).map((h) => h.trim());

  const headerMap: Record<number, string> = {};
  const unmatchedHeaders: string[] = [];
  rawHeaders.forEach((h, i) => {
    const key = HEADER_ALIASES[normalizeHeader(h)];
    if (key) {
      headerMap[i] = key;
    } else if (h) {
      unmatchedHeaders.push(h);
    }
  });

  const rows = lines.slice(1).map((line) => {
    const cells = line.split(delimiter).map((c) => c.trim());
    const row: Record<string, any> = {};
    cells.forEach((cell, i) => {
      const field = headerMap[i];
      if (!field) return;
      if (field === "team" || field === "bet") {
        row[field] = cell === "" ? null : cell;
      } else if (NUMERIC_FIELDS.has(field)) {
        const n = parseFloat(cell.replace(/[^0-9.\-]/g, ""));
        row[field] = cell === "" || Number.isNaN(n) ? null : n;
      }
    });
    return row;
  });

  return { rows, unmatchedHeaders, headerMap };
}

export default function AdminPage({ onHome }: any) {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [week, setWeek] = useState("preseason");
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsed = useMemo(() => parsePaste(raw), [raw]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);
    try {
      const res = await fetch("/api/admin-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, week, rows: parsed.rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Save failed");
      } else {
        setSaveResult(`Saved ${data.saved} teams for ${week}.`);
      }
    } catch (err: any) {
      setSaveError(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!authed) {
    return (
      <div className="page" style={{ maxWidth: 420, margin: "4rem auto", padding: "0 1rem" }}>
        <h2>Admin</h2>
        <p>Enter the admin password to continue.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{ width: "100%", padding: "0.6rem", marginBottom: "0.75rem" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setAuthed(true);
              setAuthError(null);
            }
          }}
        />
        <button
          onClick={() => {
            if (!password) {
              setAuthError("Enter a password first.");
              return;
            }
            setAuthed(true);
            setAuthError(null);
          }}
        >
          Continue
        </button>
        {authError && <p style={{ color: "crimson" }}>{authError}</p>}
        <p style={{ marginTop: "2rem" }}>
          <a href="#" onClick={(e) => { e.preventDefault(); onHome?.(); }}>
            ← Back to site
          </a>
        </p>
        <p style={{ fontSize: "0.85rem", color: "#666", marginTop: "1rem" }}>
          Note: this just gates the paste screen from casual visitors — the
          password is checked again on the server before anything is written,
          so a wrong guess here does nothing on its own.
        </p>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 900, margin: "2rem auto", padding: "0 1rem" }}>
      <h2>Weekly data entry</h2>
      <p>
        <a href="#" onClick={(e) => { e.preventDefault(); onHome?.(); }}>
          ← Back to site
        </a>
      </p>

      <label style={{ display: "block", margin: "1rem 0 0.25rem", fontWeight: 600 }}>
        Week
      </label>
      <select value={week} onChange={(e) => setWeek(e.target.value)}>
        {WEEK_OPTIONS.map((w) => (
          <option key={w} value={w}>
            {w}
          </option>
        ))}
      </select>

      <label style={{ display: "block", margin: "1rem 0 0.25rem", fontWeight: 600 }}>
        Paste this week's data (copy straight out of your spreadsheet — first row
        must be column headers)
      </label>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={12}
        style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem" }}
        placeholder={"Team\tRating\tRank\tSOR\t...\nOhio State\t34.2\t1\t-8.46\t..."}
      />

      {raw && (
        <div style={{ marginTop: "1rem" }}>
          <p>
            Parsed <strong>{parsed.rows.length}</strong> team rows.
          </p>
          {parsed.unmatchedHeaders.length > 0 && (
            <p style={{ color: "#a15c00" }}>
              Columns not recognized (ignored): {parsed.unmatchedHeaders.join(", ")}
            </p>
          )}
          {parsed.rows.length > 0 && (
            <div style={{ overflowX: "auto", maxHeight: 300, border: "1px solid #ddd" }}>
              <table style={{ fontSize: "0.8rem", borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    {Object.keys(parsed.rows[0]).map((k) => (
                      <th key={k} style={{ textAlign: "left", padding: "0.25rem 0.5rem", borderBottom: "1px solid #ccc" }}>
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 15).map((row, i) => (
                    <tr key={i}>
                      {Object.keys(parsed.rows[0]).map((k) => (
                        <td key={k} style={{ padding: "0.25rem 0.5rem", borderBottom: "1px solid #eee" }}>
                          {String(row[k] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 15 && (
                <p style={{ padding: "0.5rem", color: "#666" }}>
                  ...and {parsed.rows.length - 15} more rows
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <button
        disabled={saving || parsed.rows.length === 0}
        onClick={handleSave}
        style={{ marginTop: "1rem" }}
      >
        {saving ? "Saving..." : `Save as ${week}`}
      </button>

      {saveResult && <p style={{ color: "green" }}>{saveResult}</p>}
      {saveError && <p style={{ color: "crimson" }}>{saveError}</p>}
    </div>
  );
}
