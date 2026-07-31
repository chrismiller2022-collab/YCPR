import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import SurvivorPanel from "./SurvivorPanel";
import GamesLinesPanel from "./GamesLinesPanel";
import AdminMatchupsPanel from "./AdminMatchupsPanel";
import PoolsMenuPanel from "./PoolsMenuPanel";
import BritPoolPanel from "./BritPoolPanel";
import PeayPoolPanel from "./PeayPoolPanel";
import EspnMoneylinePanel from "./EspnMoneylinePanel";
import EspnSpreadPanel from "./EspnSpreadPanel";
import EspnConfidencePanel from "./EspnConfidencePanel";
import CfbdPickemPanel from "./CfbdPickemPanel";
import CbsPickemPanel from "./CbsPickemPanel";
import SurvivorPoolAdminPanel from "./SurvivorPoolAdminPanel";
import MonteCarloPanel from "./MonteCarloPanel";
import { fetchAvailableWeeks, fetchLastUpload, type LastUpload } from "../lib/api/weeklyStats";

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

const ADMIN_AUTH_KEY = "admin_authed";

type AdminView =
  | "home"
  | "upload"
  | "survivor"
  | "montecarlo"
  | "gametotals"
  | "gameslines"
  | "matchups"
  | "pools"
  | "brit"
  | "peay"
  | "espnml"
  | "espnspread"
  | "espnconfidence"
  | "cfbdpickem"
  | "cbspickem"
  | "survivorpooladmin";

// ---------------------------------------------------------------------
// Password gate — verifies against /api/admin-auth on the server before
// granting access (previously this just checked the field wasn't empty).
// ---------------------------------------------------------------------
function AdminPasswordGate({ onAuthed, onHome }: { onAuthed: () => void; onHome?: () => void }) {
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
      const res = await fetch("/api/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Incorrect password");
        return;
      }
      sessionStorage.setItem(ADMIN_AUTH_KEY, "1");
      // Stored so Data Upload doesn't need to ask for the password a
      // second time — admin-save.ts still independently re-checks it
      // server-side before writing anything, so this doesn't weaken that.
      sessionStorage.setItem("admin_password", password);
      onAuthed();
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setChecking(false);
    }
  }

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
          if (e.key === "Enter") submit();
        }}
      />
      <button onClick={submit} disabled={checking}>
        {checking ? "Checking…" : "Continue"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <p style={{ marginTop: "2rem" }}>
        <a href="#" onClick={(e) => { e.preventDefault(); onHome?.(); }}>
          ← Back to site
        </a>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Dashboard — last upload date, current week, quick links, and the menu
// into the four admin sections.
// ---------------------------------------------------------------------
function DashboardCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: "1 1 200px",
        padding: "0.9rem 1rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginBottom: "0.35rem" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function MenuTile({
  label,
  description,
  comingSoon,
  onClick,
}: {
  label: string;
  description: string;
  comingSoon?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "1rem 1.1rem",
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: 8,
        cursor: "pointer",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 700 }}>{label}</span>
        {comingSoon && (
          <span
            style={{
              fontSize: "0.68rem",
              padding: "0.15rem 0.5rem",
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              color: "var(--chalk-dim)",
            }}
          >
            Coming soon
          </span>
        )}
      </div>
      <span style={{ fontSize: "0.82rem", color: "var(--chalk-dim)" }}>{description}</span>
    </button>
  );
}

interface AdminDashboardProps {
  lastUpload: LastUpload | null;
  currentWeek: string | null;
  loadingSummary: boolean;
  onGoToRatings?: () => void;
  onGoToResume?: () => void;
  onGoToSOS?: () => void;
  onNavigateView: (view: AdminView) => void;
}

function AdminDashboard({
  lastUpload,
  currentWeek,
  loadingSummary,
  onGoToRatings,
  onGoToResume,
  onGoToSOS,
  onNavigateView,
}: AdminDashboardProps) {
  const lastUploadLabel = loadingSummary
    ? "Loading…"
    : lastUpload
    ? `${lastUpload.week} · ${new Date(lastUpload.insertedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    : "No uploads yet";

  const currentWeekLabel = loadingSummary ? "Loading…" : currentWeek ?? "—";

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Admin</h2>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <DashboardCard label="Last upload date" value={lastUploadLabel} />
        <DashboardCard label="Current week" value={currentWeekLabel} />
      </div>

      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ fontSize: "0.8rem", color: "var(--chalk-dim)", marginBottom: "0.5rem" }}>
          Quick links
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          <button className="menu-btn" onClick={onGoToRatings}>
            Power Ratings →
          </button>
          <button className="menu-btn" onClick={onGoToResume}>
            Resume Ratings →
          </button>
          <button className="menu-btn" onClick={onGoToSOS}>
            Strength of Schedule →
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "0.75rem",
        }}
      >
        <MenuTile
          label="Data Upload"
          description="Paste this week's power ratings and save them."
          onClick={() => onNavigateView("upload")}
        />
        <MenuTile
          label="Survivor"
          description="Manage Survivor Pool picks and scores."
          onClick={() => onNavigateView("survivor")}
        />
        <MenuTile
          label="Survivor Pool (Public)"
          description="Conference scope + entrants for a public survivor pool."
          onClick={() => onNavigateView("survivorpooladmin")}
        />
        <MenuTile
          label="Games & Lines"
          description="View and sync CFBD games and betting lines."
          onClick={() => onNavigateView("gameslines")}
        />
        <MenuTile
          label="Matchups"
          description="Admin matchups view (template copy of the public page for now)."
          onClick={() => onNavigateView("matchups")}
        />
        <MenuTile
          label="Pools"
          description="Weekly pools: The Brit, ESPN pools, Peay Pool."
          onClick={() => onNavigateView("pools")}
        />
        <MenuTile
          label="Monte Carlo"
          description="Run season simulations for win totals, playoff, and title odds."
          onClick={() => onNavigateView("montecarlo")}
        />
        <MenuTile
          label="Game Totals"
          description="Projected spreads and totals from power ratings."
          comingSoon
          onClick={() => onNavigateView("gametotals")}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Coming soon panel for Monte Carlo / Game Totals.
// ---------------------------------------------------------------------
function AdminComingSoon({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <div
        style={{
          textAlign: "center",
          padding: "3rem 1rem",
          background: "var(--turf-panel)",
          border: "1px solid var(--hash)",
          borderRadius: 8,
        }}
      >
        <Clock size={26} strokeWidth={1.75} style={{ margin: "0 auto 0.75rem" }} />
        <div style={{ fontWeight: 700, marginBottom: "0.35rem" }}>{title}</div>
        <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", margin: 0 }}>
          This section isn't built yet — check back soon.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Data Upload panel — unchanged parsing/save logic, just relocated under
// the Admin menu instead of being the entire page.
// ---------------------------------------------------------------------
function DataUploadPanel({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
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
      // The admin password itself is still checked here (not just at the
      // gate) because /api/admin-save re-verifies it server-side before
      // writing anything — but since the gate now already confirms the
      // password up front, we can safely reuse the same value the person
      // already entered rather than asking for it a second time.
      const storedPassword = sessionStorage.getItem("admin_password") ?? "";
      const res = await fetch("/api/admin-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: storedPassword, week, rows: parsed.rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "Save failed");
      } else {
        const teamsNote = data.teamsSynced ? ` (${data.teamsSynced} teams synced)` : "";
        setSaveResult(`Saved ${data.saved} teams for ${week}.${teamsNote}`);
        onSaved();
      }
    } catch (err: any) {
      setSaveError(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>

      <h2>Weekly data entry</h2>

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

// ---------------------------------------------------------------------
// Top-level Admin page.
// ---------------------------------------------------------------------
interface AdminPageProps {
  onHome?: () => void;
  onGoToRatings?: () => void;
  onGoToResume?: () => void;
  onGoToSOS?: () => void;
}

export default function AdminPage({ onHome, onGoToRatings, onGoToResume, onGoToSOS }: AdminPageProps) {
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<AdminView>("home");
  const [lastUpload, setLastUpload] = useState<LastUpload | null>(null);
  const [currentWeek, setCurrentWeek] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);

  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_AUTH_KEY) === "1") setAuthed(true);
  }, []);

  function loadSummary() {
    setLoadingSummary(true);
    Promise.all([fetchAvailableWeeks(), fetchLastUpload()])
      .then(([weeks, last]) => {
        setCurrentWeek(weeks[0] ?? null);
        setLastUpload(last);
      })
      .catch(() => {
        // Dashboard summary is informational only — if it fails to load,
        // the cards just show a dash rather than blocking the rest of Admin.
      })
      .finally(() => setLoadingSummary(false));
  }

  useEffect(() => {
    if (authed) loadSummary();
  }, [authed]);

  if (!authed) {
    return <AdminPasswordGate onAuthed={() => setAuthed(true)} onHome={onHome} />;
  }

  return (
    <div className="page" style={{ maxWidth: 1000, margin: "2rem auto", padding: "0 1rem" }}>
      {view === "home" && (
        <p style={{ marginTop: 0 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); onHome?.(); }}>
            ← Back to site
          </a>
        </p>
      )}

      {view === "home" && (
        <AdminDashboard
          lastUpload={lastUpload}
          currentWeek={currentWeek}
          loadingSummary={loadingSummary}
          onGoToRatings={onGoToRatings}
          onGoToResume={onGoToResume}
          onGoToSOS={onGoToSOS}
          onNavigateView={setView}
        />
      )}

      {view === "upload" && (
        <DataUploadPanel onBack={() => setView("home")} onSaved={loadSummary} />
      )}

      {view === "survivor" && <SurvivorPanel onBack={() => setView("home")} />}

      {view === "survivorpooladmin" && <SurvivorPoolAdminPanel onBack={() => setView("home")} />}

      {view === "gameslines" && <GamesLinesPanel onBack={() => setView("home")} />}

      {view === "matchups" && <AdminMatchupsPanel onBack={() => setView("home")} />}

      {view === "pools" && (
        <PoolsMenuPanel onBack={() => setView("home")} onSelectPool={(pool) => setView(pool as AdminView)} />
      )}

      {view === "brit" && <BritPoolPanel onBack={() => setView("pools")} />}

      {view === "peay" && <PeayPoolPanel onBack={() => setView("pools")} />}

      {view === "espnml" && <EspnMoneylinePanel onBack={() => setView("pools")} />}

      {view === "espnspread" && <EspnSpreadPanel onBack={() => setView("pools")} />}

      {view === "espnconfidence" && <EspnConfidencePanel onBack={() => setView("pools")} />}

      {view === "cfbdpickem" && <CfbdPickemPanel onBack={() => setView("pools")} />}

      {view === "cbspickem" && <CbsPickemPanel onBack={() => setView("pools")} />}

      {view === "montecarlo" && <MonteCarloPanel onBack={() => setView("home")} />}

      {view === "gametotals" && (
        <AdminComingSoon title="Game Totals" onBack={() => setView("home")} />
      )}
    </div>
  );
}
