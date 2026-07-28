import { useMemo, useState } from "react";

// Maps flexible/human column headers (however you happen to label them when
// pasting from a spreadsheet) to the actual database column names. Keys are
// lowercased/whitespace-collapsed but otherwise exact, so punctuation like
// the trailing period in "Conf." still needs to be included here.
const HEADER_ALIASES: Record<string, string> = {
  div: "div",
  division: "div",
  "conf.": "conf",
  conf: "conf",
  conference: "conf",
  team: "team",
  rating: "rating",
  "power rating": "rating",
  "power ratings": "rating",
  rank: "rank",
  sor: "sor",
  sos: "sor",
  "strength of resume": "sor",
  "strength of schedule": "sor",
  "resume rank": "resume_rank",
  "resume ranking": "resume_rank",
  "resume rating": "resume_rating",
  "total wins": "total_wins",
  "live win proj": "total_wins",
  "vegas win total": "season_win_line",
  "vegas win total line": "season_win_line",
  "season win line": "season_win_line",
  "preseason proj": "preseason_proj",
  change: "change_from_preseason",
  "live wins": "live_wins",
  "live losses": "live_losses",
  "wins left": "wins_left",
  "losses left": "losses_left",
  "conf proj wins": "conf_proj_wins",
  "conference projected wins": "conf_proj_wins",
  "conf win total": "conf_proj_wins",
  "conf line": "conf_line",
  "conference line": "conf_line",
  "conf wins": "conf_line",
  win: "season_win_line",
  dif: "dif",
  diff: "dif",
  abs: "abs_dif",
  "abs dif": "abs_dif",
  bet: "bet",
  edge: "edge",
  "conf win pct": "conf_win_pct",
  "conf win %": "conf_win_pct",
  "conference win %": "conf_win_pct",
  "fair price": "fair_price",
  "implied pct": "implied_pct",
  "implied %": "implied_pct",
  odds: "odds",
  value: "value",
  "natty odds": "natty_odds",
  "my natty odds": "natty_odds",
  "natl champ odds": "natty_odds",
  "draftkings natty odds": "draftkings_natty_odds",
  "natty rank": "natty_rank",
  "vegas natty rank": "natty_rank",
  "playoff seeding": "playoff_seed",
  "playoff seed": "playoff_seed",
  "ats wins": "ats_wins",
  "ats losses": "ats_losses",
  "games completed": "games_completed",
  "ats record rank": "ats_rank",
  "wins rank": "rank",
  hfa: "hfa",
  "home field advantage": "hfa",
  "home field adv": "hfa",
};

// Columns that are expected in the export but intentionally not stored per
// week — shown as "ignored" rather than "not recognized" so it's clear
// they're accounted for, not a mistake. "Column 1", "Column 2", etc. are
// spacer columns that shift names as the sheet is edited, so match them
// by pattern rather than an exact list.
const IGNORED_HEADERS = new Set([".", "record", "ats record"]);
const IGNORED_HEADER_PATTERN = /^column\s*\d+$/;

const TEXT_FIELDS = new Set(["team", "bet", "div", "conf"]);

// Stored as fractions (0.1633) so they match fmtPct's expectation, even
// though the export shows them as "16.33%".
const PERCENT_FIELDS = new Set([
  "conf_win_pct",
  "implied_pct",
  "value",
  "natty_odds",
  "draftkings_natty_odds",
]);

const NUMERIC_FIELDS = new Set([
  "rating",
  "rank",
  "sor",
  "resume_rank",
  "resume_rating",
  "total_wins",
  "season_win_line",
  "preseason_proj",
  "change_from_preseason",
  "live_wins",
  "live_losses",
  "wins_left",
  "losses_left",
  "conf_proj_wins",
  "conf_line",
  "dif",
  "abs_dif",
  "edge",
  "fair_price",
  "odds",
  "natty_rank",
  "playoff_seed",
  "ats_wins",
  "ats_losses",
  "games_completed",
  "ats_rank",
  "hfa",
  ...PERCENT_FIELDS,
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
    const normalized = normalizeHeader(h);
    if (IGNORED_HEADERS.has(normalized) || IGNORED_HEADER_PATTERN.test(normalized)) return;
    const key = HEADER_ALIASES[normalized];
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
      if (TEXT_FIELDS.has(field)) {
        row[field] = cell === "" ? null : cell;
      } else if (PERCENT_FIELDS.has(field)) {
        const n = parseFloat(cell.replace(/[^0-9.\-]/g, ""));
        row[field] = cell === "" || Number.isNaN(n) ? null : n / 100;
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
        const teamsNote = data.teamsSynced ? ` (${data.teamsSynced} teams synced)` : "";
        setSaveResult(`Saved ${data.saved} teams for ${week}.${teamsNote}`);
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
