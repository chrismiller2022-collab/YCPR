import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Clock, ExternalLink, KeyRound, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import "../styles/admin.css";
import SurvivorPanel from "./SurvivorPanel";
import SplashSurvivorPanel from "./SplashSurvivorPanel";
import WeeklyBettingReportPanel from "./WeeklyBettingReportPanel";
import GamesLinesPanel from "./GamesLinesPanel";
import AdminMatchupsPanel from "./AdminMatchupsPanel";
import ResumeRatingAdminPanel from "./ResumeRatingAdminPanel";
import GameTotalsAdminPanel from "./GameTotalsAdminPanel";
import TotalsHistoryPanel from "./TotalsHistoryPanel";
import PredictionsAdminPanel from "./PredictionsAdminPanel";
import LineMovementAdminPanel from "./LineMovementAdminPanel";
import OddsDashboardAdminPanel from "./OddsDashboardAdminPanel";
import WeeklyImageDumpAdminPanel from "./WeeklyImageDumpAdminPanel";
import PoolsMenuPanel, { POOL_LABELS } from "./PoolsMenuPanel";
import NflDraftPoolAdminPanel from "./NflDraftPoolAdminPanel";
import BritPoolPanel from "./BritPoolPanel";
import PeayPoolPanel from "./PeayPoolPanel";
import WestgatePoolPanel from "./WestgatePoolPanel";
import PoolBalanceSheetPanel from "./PoolBalanceSheetPanel";
import PoolHistoryPanel from "./PoolHistoryPanel";
import CbsSplashPoolPanel from "./CbsSplashPoolPanel";
import EspnMoneylinePanel from "./EspnMoneylinePanel";
import EspnSpreadPanel from "./EspnSpreadPanel";
import EspnConfidencePanel from "./EspnConfidencePanel";
import RedditConfidencePanel from "./RedditConfidencePanel";
import CfbdPickemPanel from "./CfbdPickemPanel";
import CbsPickemPanel from "./CbsPickemPanel";
import SurvivorPoolAdminPanel from "./SurvivorPoolAdminPanel";
import BetHistoryAdminPanel from "./BetHistoryAdminPanel";
import LockGamesPanel from "./LockGamesPanel";
import LockedHistoryPanel from "./LockedHistoryPanel";
import PublishPage from "./PublishPage";
import PlacedBetsPanel, { gradeBetAgainstGame } from "./PlacedBetsPanel";
import MoneylineBetHistoryPanel from "./MoneylineBetHistoryPanel";
import MonteCarloPanel from "./MonteCarloPanel";
import PeriodProjectionsPanel from "./PeriodProjectionsPanel";
import OddsHistoricalPanel from "./OddsHistoricalPanel";
import PeriodGradingPanel from "./PeriodGradingPanel";
import PmAdminPanel from "./PmAdminPanel";
import RatingSystemsPanel from "./RatingSystemsPanel";
import SosAdminPanel from "./SosAdminPanel";
import MatchupHistoryPanel from "./MatchupHistoryPanel";
import TeamInfoPanel from "./TeamInfoPanel";
import WeatherPanel from "./WeatherPanel";
import AdminToolsPanel from "./AdminToolsPanel";
import VizBuilderPanel from "./VizBuilderPanel";
import RatingSystemsMatchupsPanel from "./RatingSystemsMatchupsPanel";
import DrogbaAdminPanel from "./DrogbaAdminPanel";
import { fetchAvailableWeeks, fetchLastUpload, type LastUpload } from "../lib/api/weeklyStats";
import { fetchChecklistState, toggleChecklistItem } from "../lib/api/adminChecklist";
import { CHECKLIST_ITEMS, type ChecklistItemDef } from "../lib/checklistItems";
import ChecklistItemsBlock from "../components/ChecklistItemsBlock";
import AdminChecklistPage from "./AdminChecklistPage";
import { WEEK_OPTIONS } from "../lib/weekOptions";
import { AdminWeekProvider, useAdminWeek } from "../lib/adminWeek";
import { useAdminTheme, useSidebarCollapsed, type AdminTheme } from "../lib/adminPrefs";
import { fetchPlacedBets } from "../lib/api/placedBets";
import { addBetToRecord, emptyRecord, roi } from "../lib/betRecord";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { pickLine } from "../lib/matchupsCompute";
import AdminWeekSelector from "../components/AdminWeekSelector";
import PasskeysPanel from "./PasskeysPanel";
import { passkeysSupported, restorePasskeySession, signInWithPasskey } from "../lib/adminAuth";

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
  | "splashsurvivor"
  | "bettingreport"
  | "montecarlo"
  | "periodproj"
  | "matchuphistory"
  | "teaminfo"
  | "weather"
  | "tools"
  | "vizbuilder"
  | "oddshistorical"
  | "periodgrading"
  | "pm"
  | "gametotals"
  | "drogba"
  | "totalshistory"
  | "gameslines"
  | "matchups"
  | "pools"
  | "poolbalance"
  | "brit"
  | "peay"
  | "westgate"
  | "poolhistory"
  | "cbssplash"
  | "espnml"
  | "espnspread"
  | "espnconfidence"
  | "redditconfidence"
  | "cfbdpickem"
  | "cbspickem"
  | "nfldraftpool"
  | "survivorpooladmin"
  | "bethistory"
  | "lockgames"
  | "lockedhistory"
  | "publish"
  | "placedbets"
  | "mlbethistory"
  | "resumerating"
  | "gametotals"
  | "predictions"
  | "linemovement"
  | "odds"
  | "imagedump"
  | "ratingsystems"
  | "ratingmatchups"
  | "sos"
  | "checklist"
  | "passkeys";

// ---------------------------------------------------------------------
// Password gate — verifies against /api/admin-save (action: "checkPassword")
// on the server before granting access (previously this just checked the
// field wasn't empty).
// ---------------------------------------------------------------------
function AdminPasswordGate({ onAuthed, onHome, theme }: { onAuthed: () => void; onHome?: () => void; theme: AdminTheme }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function passkeyLogin() {
    setChecking(true);
    setError(null);
    try {
      await signInWithPasskey();
      onAuthed();
    } catch (err: any) {
      setError(err.message ?? "Passkey sign-in failed");
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    if (!password) {
      setError("Enter a password first.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, action: "checkPassword" }),
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

  const canPasskey = passkeysSupported();

  return (
    <div className="admin-shell admin-login" data-admin-theme={theme}>
      <form
        className="admin-login-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="admin-login-brand">
          <i>YC</i>
          <span>
            <b>YCPR</b>
            <small>Admin</small>
          </span>
        </div>
        <h1 className="admin-page-title" style={{ fontSize: "1.6rem" }}>
          Sign in
        </h1>
        {canPasskey && (
          <>
            <button type="button" className="admin-btn primary admin-login-wide" onClick={passkeyLogin} disabled={checking}>
              <KeyRound size={16} /> {checking ? "Checking…" : "Sign in with passkey"}
            </button>
            <div className="admin-login-or">
              <span>or use the password</span>
            </div>
          </>
        )}
        <label className="admin-field" htmlFor="admin-password">
          Password
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!canPasskey}
          />
        </label>
        <button type="submit" className={`admin-btn admin-login-wide${canPasskey ? "" : " primary"}`} disabled={checking}>
          {checking ? "Checking…" : "Continue"}
        </button>
        {error && <div className="admin-callout bad">{error}</div>}
        <button type="button" className="admin-link admin-login-back" onClick={() => onHome?.()}>
          ← Back to site
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Dashboard — last upload date, current week, quick links, and the menu
// into the four admin sections.
// ---------------------------------------------------------------------
interface BetSummary {
  season: number;
  wins: number;
  losses: number;
  pushes: number;
  pending: number;
  staked: number;
  profit: number;
  roi: number | null;
  pendingBooks: number;
}

function leafKeys(item: ChecklistItemDef): string[] {
  return item.subItems ? item.subItems.flatMap(leafKeys) : [item.key];
}

/** A top-level checklist item counts as done once every one of its leaf boxes is checked. */
function checklistItemDone(item: ChecklistItemDef, checked: Record<string, boolean>): boolean {
  return leafKeys(item).every((k) => checked[k]);
}

function weekLabel(w: string | null): string {
  if (!w) return "—";
  const m = /^week\s*(\d+)$/i.exec(w);
  if (m) return `Week ${m[1]}`;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function fmtMoney(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })}`;
}

function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="admin-stat">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub != null && <div className={`d${tone ? ` ${tone}` : ""}`}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Weekly checklist — lives on the admin dashboard home view (not its own
// page). Two of the seven top-level items have a collapsible sub-checklist;
// the parent checkbox reflects (and bulk-toggles) whether every sub-item is
// checked. State is keyed by the current week label (same "week1"/
// "preseason" strings used elsewhere) and persisted to Supabase so it
// carries across devices/browsers, not just localStorage on one machine.
// The state itself is owned by AdminPage so the sidebar badge stays in
// sync. Item definitions live in lib/checklistItems.ts, shared with the
// full Weekly Checklist page.
// ---------------------------------------------------------------------
function WeeklyChecklist({
  week,
  checked,
  loading,
  onToggle,
  onOpenFull,
}: {
  week: string | null;
  checked: Record<string, boolean>;
  loading: boolean;
  onToggle: (key: string, next: boolean) => void;
  onOpenFull: () => void;
}) {
  if (!week) return null;
  const done = CHECKLIST_ITEMS.filter((i) => checklistItemDone(i, checked)).length;
  const total = CHECKLIST_ITEMS.length;
  return (
    <section className="admin-panel">
      <div className="admin-panel-head">
        <h3>Weekly checklist · {weekLabel(week)}</h3>
        <span style={{ display: "inline-flex", gap: 12, alignItems: "baseline" }}>
          {loading && <span className="admin-muted" style={{ fontSize: "0.78rem" }}>Loading…</span>}
          <button className="admin-link admin-panel-link" onClick={onOpenFull}>
            Open checklist →
          </button>
        </span>
      </div>
      <div className="admin-progress" style={{ marginBottom: 12 }} title={`${done} of ${total} done`}>
        <span style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <div className="admin-checklist">
        <ChecklistItemsBlock items={CHECKLIST_ITEMS} isChecked={(k) => checked[k] ?? false} onToggle={onToggle} />
      </div>
    </section>
  );
}

interface AdminDashboardProps {
  lastUpload: LastUpload | null;
  currentWeek: string | null;
  loadingSummary: boolean;
  betSummary: BetSummary | null;
  checklist: Record<string, boolean>;
  checklistLoading: boolean;
  onToggleChecklist: (key: string, next: boolean) => void;
  onNavigate: (v: AdminView) => void;
  onGoToRatings?: () => void;
  onGoToResume?: () => void;
  onGoToSOS?: () => void;
}

// Overview — number tiles, weekly checklist, quick links to public rating
// pages and the next games in the admin week. Every other admin page is a
// sidebar item.
function AdminDashboard({
  lastUpload,
  currentWeek,
  loadingSummary,
  betSummary,
  checklist,
  checklistLoading,
  onToggleChecklist,
  onNavigate,
  onGoToRatings,
  onGoToResume,
  onGoToSOS,
}: AdminDashboardProps) {
  const { week: adminWeek } = useAdminWeek();
  const season = new Date().getFullYear();
  const [games, setGames] = useState<GameWithLines[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGames(null);
    fetchGamesWithLines(season, adminWeek)
      .then((g) => !cancelled && setGames(g))
      .catch(() => !cancelled && setGames([]));
    return () => {
      cancelled = true;
    };
  }, [season, adminWeek]);

  const upcoming = useMemo(() => {
    if (!games) return [];
    return games
      // Not final and not kicked off more than ~4 hours ago (a game can sit un-final until the next sync).
      .filter((g) => !g.completed && (!g.start_date || Date.parse(g.start_date) > Date.now() - 4 * 3600 * 1000))
      .filter((g) => g.home_classification === "fbs" || g.away_classification === "fbs")
      .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""))
      .slice(0, 6);
  }, [games]);

  const done = CHECKLIST_ITEMS.filter((i) => checklistItemDone(i, checklist)).length;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const bs = betSummary;

  return (
    <div>
      <h2>Overview</h2>
      <p>
        {today} · {season} season
      </p>

      <div className="admin-stats" style={{ marginTop: 16 }}>
        <StatTile label="Current week" value={loadingSummary ? "…" : weekLabel(currentWeek)} sub="latest uploaded ratings" />
        <StatTile
          label="Last upload"
          value={
            loadingSummary
              ? "…"
              : lastUpload
              ? new Date(lastUpload.insertedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "None yet"
          }
          sub={lastUpload ? `${weekLabel(lastUpload.week)} ratings` : undefined}
        />
        <StatTile label="Checklist" value={currentWeek ? `${done} / ${CHECKLIST_ITEMS.length}` : "—"} sub={currentWeek ? `done for ${weekLabel(currentWeek).toLowerCase()}` : undefined} />
        <StatTile
          label="Bets this season"
          value={bs ? `${bs.wins}–${bs.losses}${bs.pushes ? `–${bs.pushes}` : ""}` : "—"}
          sub={bs ? `${fmtMoney(bs.profit)}${bs.roi != null ? ` · ${bs.roi > 0 ? "+" : ""}${bs.roi.toFixed(1)}% ROI` : ""}` : undefined}
          tone={bs ? (bs.profit > 0 ? "up" : bs.profit < 0 ? "down" : undefined) : undefined}
        />
        <StatTile label="Pending bets" value={bs ? bs.pending : "—"} sub={bs && bs.pending ? `across ${bs.pendingBooks} book${bs.pendingBooks === 1 ? "" : "s"}` : undefined} />
      </div>

      <div className="admin-cols">
        <WeeklyChecklist
          week={loadingSummary ? null : currentWeek}
          checked={checklist}
          loading={checklistLoading}
          onToggle={onToggleChecklist}
          onOpenFull={() => onNavigate("checklist")}
        />
        <div style={{ display: "grid", gap: 16 }}>
          <section className="admin-panel">
            <div className="admin-panel-head">
              <h3>Quick links</h3>
            </div>
            <div className="admin-quicklinks">
              <button onClick={onGoToRatings}>
                Power Ratings <span>public page →</span>
              </button>
              <button onClick={onGoToResume}>
                Resume Ratings <span>public page →</span>
              </button>
              <button onClick={onGoToSOS}>
                Strength of Schedule <span>public page →</span>
              </button>
            </div>
          </section>
          <section className="admin-panel">
            <div className="admin-panel-head">
              <h3>Next up · week {adminWeek}</h3>
              <button className="admin-link admin-panel-link" onClick={() => onNavigate("gameslines")}>
                Games &amp; Lines →
              </button>
            </div>
            {games == null ? (
              <p className="admin-muted" style={{ margin: 0, fontSize: "0.85rem" }}>Loading…</p>
            ) : upcoming.length === 0 ? (
              <p className="admin-muted" style={{ margin: 0, fontSize: "0.85rem" }}>No upcoming FBS games synced for week {adminWeek}.</p>
            ) : (
              <table className="admin-mini-table">
                <tbody>
                  {upcoming.map((g) => {
                    const line = pickLine(g.lines);
                    const fav =
                      line?.spread == null ? null : line.spread === 0 ? "PK" : line.spread < 0 ? `${g.home_team} ${line.spread}` : `${g.away_team} −${line.spread}`;
                    return (
                      <tr key={g.id}>
                        <td className="admin-muted">
                          {g.start_date
                            ? new Date(g.start_date).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })
                            : "TBD"}
                        </td>
                        <td>
                          {g.away_team} {g.neutral_site ? "vs" : "@"} {g.home_team}
                        </td>
                        <td style={{ textAlign: "right" }} className={fav ? undefined : "admin-muted"}>
                          {fav ?? "No line"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Sidebar — persistent left nav grouped by category, replacing the old
// flat tile grid. Every AdminView still exists exactly as before (same
// panels, same onBack wiring); this only changes how you get to them.
// Pool sub-views (brit/peay/etc.) aren't their own sidebar entries — they
// render inside the main content area same as always, reached by clicking
// a tile inside the Pools panel — but they highlight "Pools" as active in
// the sidebar so it's clear which section you're still in.
// ---------------------------------------------------------------------
interface NavItem {
  key: AdminView;
  label: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
  // Collapsed by default, expand-on-click — for groups Chris wants out
  // of the way (currently just Archived) rather than always visible.
  collapsible?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "This week",
    items: [
      { key: "checklist", label: "Weekly Checklist" },
      { key: "lockgames", label: "Freeze Week" },
      { key: "lockedhistory", label: "Locked History" },
      { key: "publish", label: "Publish" },
      { key: "montecarlo", label: "Monte Carlo" },
      { key: "gameslines", label: "Games & Lines" },
      { key: "weather", label: "Game Weather" },
      { key: "pools", label: "Pools" },
    ],
  },
  {
    label: "Ratings & models",
    items: [
      { key: "ratingsystems", label: "Rating Systems" },
      { key: "ratingmatchups", label: "Rating Systems Matchups" },
      { key: "resumerating", label: "Resume Rating" },
      { key: "sos", label: "Strength of Schedule" },
      { key: "gametotals", label: "Totals" },
      { key: "drogba", label: "DROGBA (Spreads)" },
      { key: "periodproj", label: "Period Projections" },
      { key: "periodgrading", label: "Period Grading" },
      { key: "oddshistorical", label: "Historical Odds Pull" },
      { key: "totalshistory", label: "Totals History" },
      { key: "bethistory", label: "Bet History" },
      { key: "mlbethistory", label: "Moneyline Bet History" },
    ],
  },
  {
    label: "Betting",
    items: [
      { key: "placedbets", label: "Placed Bets" },
      { key: "pm", label: "Prediction Markets" },
      { key: "matchups", label: "Matchups" },
      { key: "linemovement", label: "Line Movement" },
      { key: "odds", label: "Odds" },
    ],
  },
  {
    label: "Tools",
    items: [
      { key: "vizbuilder", label: "Viz Builder" },
      { key: "tools", label: "Public Tools" },
    ],
  },
  {
    label: "Reports",
    items: [
      { key: "imagedump", label: "Public Report" },
      { key: "bettingreport", label: "Weekly Betting Report" },
    ],
  },
  {
    label: "Public tools",
    items: [{ key: "survivorpooladmin", label: "Survivor Pool (Public)" }],
  },
  {
    label: "Settings",
    items: [{ key: "passkeys", label: "Passkeys" }],
  },
  {
    label: "Archived",
    collapsible: true,
    items: [
      { key: "matchuphistory", label: "Matchup History" },
      { key: "teaminfo", label: "Team Info" },
      { key: "upload", label: "Data Upload" },
    ],
  },
];

const POOL_SUBVIEWS: AdminView[] = [
  "poolbalance",
  "brit",
  "survivor",
  "splashsurvivor",
  "peay",
  "westgate",
  "poolhistory",
  "cbssplash",
  "espnml",
  "espnspread",
  "espnconfidence",
  "redditconfidence",
  "cfbdpickem",
  "cbspickem",
  "nfldraftpool",
];

function activeNavKey(view: AdminView): AdminView {
  return POOL_SUBVIEWS.includes(view) ? "pools" : view;
}

/** Breadcrumb trail for the top bar: group › page, or group › Pools › pool. */
function crumbsFor(view: AdminView): { label: string; to?: AdminView }[] {
  if (view === "home") return [{ label: "Overview" }];
  const navKey = activeNavKey(view);
  const group = NAV_GROUPS.find((g) => g.items.some((i) => i.key === navKey));
  const item = group?.items.find((i) => i.key === navKey);
  const trail: { label: string; to?: AdminView }[] = [];
  if (group) trail.push({ label: group.label });
  if (POOL_SUBVIEWS.includes(view)) {
    trail.push({ label: item?.label ?? "Pools", to: "pools" });
    trail.push({ label: POOL_LABELS[view] ?? view });
  } else {
    trail.push({ label: item?.label ?? view });
  }
  return trail;
}

function AdminSidebar({
  view,
  onNavigate,
  onCollapse,
  onHome,
  counts,
}: {
  view: AdminView;
  onNavigate: (v: AdminView) => void;
  onCollapse: () => void;
  onHome?: () => void;
  counts: Partial<Record<AdminView, number>>;
}) {
  const active = activeNavKey(view);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <aside className="admin-side" aria-label="Admin navigation">
      <div className="admin-side-head">
        <button className="admin-brand" onClick={() => onNavigate("home")}>
          <i>YC</i>
          <span>
            <b>YCPR</b>
            <small>Admin</small>
          </span>
        </button>
        <button className="admin-icon-btn" onClick={onCollapse} title="Hide sidebar" aria-label="Hide sidebar">
          <PanelLeftClose size={17} />
        </button>
      </div>
      <div className="admin-nav-group">
        <button className={`admin-nav-item${active === "home" ? " on" : ""}`} onClick={() => onNavigate("home")}>
          Overview
        </button>
      </div>
      {NAV_GROUPS.map((group) => {
        // Auto-expands if the active view lives inside it, so landing on
        // e.g. Data Upload directly doesn't look like it's nowhere.
        const isOpen = !group.collapsible || openGroups.has(group.label) || group.items.some((i) => i.key === active);
        return (
          <div key={group.label} className="admin-nav-group">
            {group.collapsible ? (
              <button className="admin-nav-label" onClick={() => toggleGroup(group.label)} aria-expanded={isOpen}>
                <span>{group.label}</span>
                <span style={{ fontSize: "0.6rem" }}>{isOpen ? "▾" : "▸"}</span>
              </button>
            ) : (
              <div className="admin-nav-label">{group.label}</div>
            )}
            {isOpen &&
              group.items.map((item) => (
                <button key={item.key} className={`admin-nav-item${active === item.key ? " on" : ""}`} onClick={() => onNavigate(item.key)}>
                  <span>{item.label}</span>
                  {counts[item.key] ? <span className="admin-nav-count">{counts[item.key]}</span> : null}
                </button>
              ))}
          </div>
        );
      })}
      <div className="admin-side-foot">
        <button className="admin-nav-item" onClick={() => onHome?.()}>
          <span>← Back to site</span>
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------
// Coming soon panel for Monte Carlo / Game Totals.
// ---------------------------------------------------------------------
function AdminComingSoon({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div>
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
            <p style={{ color: "var(--c-warn)" }}>
              Columns not recognized (ignored): {parsed.unmatchedHeaders.join(", ")}
            </p>
          )}
          {parsed.rows.length > 0 && (
            <div className="table-scroll" style={{ overflowX: "auto", maxHeight: 300, border: "1px solid #ddd" }}>
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

      {saveResult && <p style={{ color: "var(--c-ok)" }}>{saveResult}</p>}
      {saveError && <p style={{ color: "var(--c-err)" }}>{saveError}</p>}
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
  // Decided before the first paint: a signed-in tab (password earlier this session, or a passkey session saved on this
  // device) goes straight to admin; anyone else sees only the sign-in page, never a flash of admin.
  const [authed, setAuthed] = useState<boolean>(() => {
    try {
      return restorePasskeySession();
    } catch {
      return false;
    }
  });
  const [view, setView] = useState<AdminView>("home");
  const [lastUpload, setLastUpload] = useState<LastUpload | null>(null);
  const [currentWeek, setCurrentWeek] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [betSummary, setBetSummary] = useState<BetSummary | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [theme, setTheme] = useAdminTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsed();

  function navigate(v: AdminView) {
    setView(v);
    window.scrollTo?.(0, 0);
  }

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
    if (!authed) return;
    loadSummary();
    // Season bet record for the Overview tiles and the Placed Bets badge.
    const season = new Date().getFullYear();
    // Pending bets are graded live against synced final scores, the same
    // way the Placed Bets page does, so the counts here match it.
    Promise.all([fetchPlacedBets(season), fetchGamesWithLines(season)])
      .then(([raw, games]) => {
        const gamesById = new Map(games.map((g) => [g.id, g]));
        const bets = raw.map((b) => (b.result === "pending" && b.game_id ? { ...b, result: gradeBetAgainstGame(b, gamesById.get(b.game_id)) } : b));
        const rec = emptyRecord();
        const books = new Set<string>();
        bets.forEach((b) => {
          addBetToRecord(rec, b);
          if (b.result === "pending") books.add(b.book);
        });
        setBetSummary({ season, ...rec, roi: roi(rec), pendingBooks: books.size });
      })
      .catch(() => setBetSummary(null));
  }, [authed]);

  // Weekly checklist state lives here (not in the widget) so the sidebar
  // badge and the Overview tile stay in step with every checkbox click.
  useEffect(() => {
    if (!authed || !currentWeek) return;
    setChecklistLoading(true);
    fetchChecklistState(currentWeek)
      .then(setChecklist)
      .catch(() => {})
      .finally(() => setChecklistLoading(false));
  }, [authed, currentWeek]);

  function toggleChecklist(key: string, next: boolean) {
    if (!currentWeek) return;
    setChecklist((c) => ({ ...c, [key]: next }));
    toggleChecklistItem(currentWeek, key, next).catch(() => {
      // Revert locally if the save failed — keeps the UI honest about what's actually persisted.
      setChecklist((c) => ({ ...c, [key]: !next }));
    });
  }

  const checklistRemaining = currentWeek ? CHECKLIST_ITEMS.filter((item) => !checklistItemDone(item, checklist)).length : 0;

  if (!authed) {
    return <AdminPasswordGate onAuthed={() => setAuthed(true)} onHome={onHome} theme={theme} />;
  }

  return (
    <AdminWeekProvider season={new Date().getFullYear()}>
    <div className="admin-shell admin-page" data-admin-theme={theme} data-sidebar={sidebarCollapsed ? "collapsed" : "open"}>
      <AdminSidebar
        view={view}
        onNavigate={navigate}
        onCollapse={() => setSidebarCollapsed(true)}
        onHome={onHome}
        counts={{ placedbets: betSummary?.pending ?? 0, checklist: checklistRemaining }}
      />

      <div className="admin-main">
        <header className="admin-top">
          <div className="admin-top-left">
            {sidebarCollapsed && (
              <button className="admin-icon-btn" onClick={() => setSidebarCollapsed(false)} title="Show sidebar" aria-label="Show sidebar">
                <PanelLeftOpen size={16} /> Menu
              </button>
            )}
            <nav className="admin-crumbs" aria-label="Breadcrumb">
              {crumbsFor(view).map((c, i, all) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {i === all.length - 1 ? <b>{c.label}</b> : c.to ? <button onClick={() => navigate(c.to!)}>{c.label}</button> : <span>{c.label}</span>}
                  {i < all.length - 1 && <ChevronRight size={13} />}
                </span>
              ))}
            </nav>
          </div>
          <div className="admin-top-right">
            <AdminWeekSelector />
            <button
              className="admin-icon-btn"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
              {theme === "light" ? "Dark" : "Light"}
            </button>
            <button className="admin-icon-btn" onClick={() => onHome?.()} title="Back to the public site">
              View site <ExternalLink size={13} />
            </button>
          </div>
        </header>

        <main className="admin-content admin-view">
          {view === "home" && (
            <AdminDashboard
              lastUpload={lastUpload}
              currentWeek={currentWeek}
              loadingSummary={loadingSummary}
              betSummary={betSummary}
              checklist={checklist}
              checklistLoading={checklistLoading}
              onToggleChecklist={toggleChecklist}
              onNavigate={navigate}
              onGoToRatings={onGoToRatings}
              onGoToResume={onGoToResume}
              onGoToSOS={onGoToSOS}
            />
          )}

          {view === "upload" && (
            <DataUploadPanel onBack={() => setView("home")} onSaved={loadSummary} />
          )}

          {view === "survivor" && <SurvivorPanel onBack={() => setView("pools")} />}

          {view === "splashsurvivor" && <SplashSurvivorPanel onBack={() => setView("pools")} />}
          {view === "bettingreport" && <WeeklyBettingReportPanel onBack={() => setView("home")} />}

          {view === "survivorpooladmin" && <SurvivorPoolAdminPanel onBack={() => setView("home")} />}

          {view === "bethistory" && <BetHistoryAdminPanel onBack={() => setView("home")} />}
          {view === "lockgames" && <LockGamesPanel onBack={() => setView("home")} />}
          {view === "lockedhistory" && <LockedHistoryPanel onBack={() => setView("home")} />}
          {view === "publish" && <PublishPage onBack={() => setView("home")} onNavigate={(v) => setView(v as AdminView)} />}
          {view === "placedbets" && <PlacedBetsPanel onBack={() => setView("home")} />}

          {view === "mlbethistory" && <MoneylineBetHistoryPanel onBack={() => setView("home")} />}

          {view === "gameslines" && <GamesLinesPanel onBack={() => setView("home")} />}

          {view === "matchups" && <AdminMatchupsPanel onBack={() => setView("home")} />}
          {view === "resumerating" && <ResumeRatingAdminPanel onBack={() => setView("home")} />}

          {view === "pools" && (
            <PoolsMenuPanel onBack={() => setView("home")} onSelectPool={(pool) => setView(pool as AdminView)} />
          )}

          {view === "poolbalance" && <PoolBalanceSheetPanel onBack={() => setView("pools")} />}
          {view === "brit" && <BritPoolPanel onBack={() => setView("pools")} />}

          {view === "peay" && <PeayPoolPanel onBack={() => setView("pools")} />}
          {view === "westgate" && <WestgatePoolPanel onBack={() => setView("pools")} />}
          {view === "poolhistory" && <PoolHistoryPanel onBack={() => setView("pools")} />}
          {view === "cbssplash" && <CbsSplashPoolPanel onBack={() => setView("pools")} />}

          {view === "espnml" && <EspnMoneylinePanel onBack={() => setView("pools")} />}

          {view === "espnspread" && <EspnSpreadPanel onBack={() => setView("pools")} />}

          {view === "espnconfidence" && <EspnConfidencePanel onBack={() => setView("pools")} />}
          {view === "redditconfidence" && <RedditConfidencePanel onBack={() => setView("pools")} />}

          {view === "cfbdpickem" && <CfbdPickemPanel onBack={() => setView("pools")} />}

          {view === "cbspickem" && <CbsPickemPanel onBack={() => setView("pools")} />}

          {view === "nfldraftpool" && <NflDraftPoolAdminPanel onBack={() => setView("pools")} />}

          {view === "montecarlo" && <MonteCarloPanel onBack={() => setView("home")} />}

          {view === "pm" && <PmAdminPanel onBack={() => setView("home")} />}

          {view === "ratingsystems" && <RatingSystemsPanel onBack={() => setView("home")} />}
          {view === "ratingmatchups" && <RatingSystemsMatchupsPanel onBack={() => setView("home")} />}

          {view === "sos" && <SosAdminPanel onBack={() => setView("home")} />}
          {view === "checklist" && <AdminChecklistPage onBack={() => setView("home")} />}

          {view === "gametotals" && <GameTotalsAdminPanel onBack={() => setView("home")} />}
          {view === "drogba" && <DrogbaAdminPanel onBack={() => setView("home")} />}
          {view === "passkeys" && <PasskeysPanel onBack={() => setView("home")} />}

          {view === "periodproj" && <PeriodProjectionsPanel onBack={() => setView("home")} />}
          {view === "matchuphistory" && <MatchupHistoryPanel onBack={() => setView("home")} />}
          {view === "teaminfo" && <TeamInfoPanel onBack={() => setView("home")} />}
          {view === "weather" && <WeatherPanel onBack={() => setView("home")} />}
          {view === "tools" && <AdminToolsPanel onBack={() => setView("home")} />}
          {view === "vizbuilder" && <VizBuilderPanel />}

          {view === "oddshistorical" && <OddsHistoricalPanel onBack={() => setView("home")} />}

          {view === "periodgrading" && <PeriodGradingPanel onBack={() => setView("home")} />}
          {view === "totalshistory" && <TotalsHistoryPanel onBack={() => setView("home")} />}
          {view === "linemovement" && <LineMovementAdminPanel onBack={() => setView("home")} />}
          {view === "odds" && <OddsDashboardAdminPanel onBack={() => setView("home")} />}
          {view === "imagedump" && <WeeklyImageDumpAdminPanel onBack={() => setView("home")} />}
        </main>
      </div>
    </div>
    </AdminWeekProvider>
  );
}
