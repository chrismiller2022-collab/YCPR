import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { spreadToWinPct, fairMoneylineFromWinPct } from "../lib/odds";
import { useGameTotalsEngine, buildBetRows } from "../lib/gameTotalsEngine";
import { fetchOddsFeed, invalidateOddsFeed, BOOK_META, BOOK_ORDER } from "../lib/api/oddsApi";
import { fetchKalshiCfbMarkets, type KalshiGame } from "../lib/api/kalshi";
import type { OddsGame } from "../lib/api/oddsApi";
import { matchOddsGames, type OddsMatchRow, type BookOdds } from "../lib/oddsMatch";
import { moneylineEdgePct, spreadEdgePts, totalCall, bestIndex, SPREAD_EDGE_THRESHOLD, TOTAL_EDGE_THRESHOLD, ML_EDGE_THRESHOLD } from "../lib/oddsValue";
import { SeasonPicker, DivisionPicker, filterRowsByDivision } from "./GameTotalsAdminPanel";
import { fetchGamesWithLines, type GameWithLines } from "../lib/api/gamesLines";
import { computeRow, homeSideMlValues, mlBetSideFor, type MatchupComputed } from "../lib/matchupsCompute";
import { useWeekAccurateRatings } from "../lib/weekAccurateRatings";
import { useFuturesMarkets, useFuturesWinTotals, type FuturesMarketGroup, type FuturesOutcomeRow } from "../lib/futuresData";

// ---------------------------------------------------------------------
// Bet signals for the Game Cards / filters — reuses the exact same
// canonical logic as Admin Matchups (spread: filteredBetTeam/
// weightedFilteredBetTeam/nwfbTeam; moneyline: mlBetSideFor) and the
// Totals admin page (buildBetRows), rather than a third parallel
// definition of "what counts as a bet" specific to this dashboard.
// Spread/moneyline need the Supabase consensus lines (matchupsCompute's
// own data source) — a second source alongside the Odds-API feed this
// page already has — matched to each odds-board game by team + week.
// ---------------------------------------------------------------------
export interface OddsBetSignal {
  spreadTier: "NWFB" | "WFB" | "Filtered" | null;
  spreadTeam: string | null;
  mlBet: boolean;
  mlSide: "away" | "home" | null;
  mlEv: number | null; // whichever side is the play
  totalBet: boolean;
  totalCall: "Over" | "Under" | null;
  totalAmountOff: number | null;
  totalStdDevOff: number | null;
  spreadAmountOff: number | null; // |ours - vegas|, for sorting
  spreadSigmaOff: number | null;
}

function spreadTierFor(c: MatchupComputed): { tier: OddsBetSignal["spreadTier"]; team: string | null } {
  if (c.nwfbTeam) return { tier: "NWFB", team: c.nwfbTeam === "away" ? c.game.away_team : c.game.home_team };
  if (c.weightedFilteredBetTeam)
    return { tier: "WFB", team: c.weightedFilteredBetTeam === "away" ? c.game.away_team : c.game.home_team };
  if (c.filteredBetTeam)
    return { tier: "Filtered", team: c.filteredBetTeam === "away" ? c.game.away_team : c.game.home_team };
  return { tier: null, team: null };
}

function useOddsBetSignals(season: number, matched: OddsMatchRow[], siteRows: ReturnType<typeof filterRowsByDivision>, filterThresholdMultiplier: number) {
  const [linesGames, setLinesGames] = useState<GameWithLines[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchGamesWithLines(season)
      .then((rows) => {
        if (!cancelled) setLinesGames(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [season]);

  const weekNumbers = useMemo(() => Array.from(new Set(matched.map((r) => r.game.game.week))), [matched]);
  const { byWeek: ratingsByWeek } = useWeekAccurateRatings(season, weekNumbers, season);

  const totalBetByGameId = useMemo(() => {
    const rows = buildBetRows(siteRows, filterThresholdMultiplier);
    const map = new Map<string, ReturnType<typeof buildBetRows>[number]>();
    for (const r of rows) map.set(r.row.game.id, r);
    return map;
  }, [siteRows, filterThresholdMultiplier]);

  return useMemo(() => {
    const map = new Map<string, OddsBetSignal>();
    for (const row of matched) {
      const g = row.game.game;
      const lineMatch = linesGames.find(
        (lg) =>
          lg.week === g.week &&
          ((lg.home_team === g.homeTeam && lg.away_team === g.awayTeam) ||
            (lg.home_team === g.awayTeam && lg.away_team === g.homeTeam))
      );

      let spreadTier: OddsBetSignal["spreadTier"] = null;
      let spreadTeam: string | null = null;
      let mlBet = false;
      let mlSide: "away" | "home" | null = null;
      let mlEv: number | null = null;
      let spreadAmountOff: number | null = null;
      let spreadSigmaOff: number | null = null;

      if (lineMatch) {
        const computed = computeRow(lineMatch, ratingsByWeek[g.week] ?? {});
        const tier = spreadTierFor(computed);
        spreadTier = tier.tier;
        spreadTeam = tier.team;
        spreadAmountOff = computed.absAmountOff;
        spreadSigmaOff = computed.sigmaOff;
        mlSide = mlBetSideFor(computed);
        if (mlSide) {
          mlBet = true;
          mlEv = mlSide === "away" ? computed.ev : homeSideMlValues(computed).evHome;
        }
      }

      const totalRow = totalBetByGameId.get(g.id);

      map.set(g.id, {
        spreadTier,
        spreadTeam,
        mlBet,
        mlSide,
        mlEv,
        totalBet: totalRow?.isFiltered ?? false,
        totalCall: totalRow?.call ?? null,
        totalAmountOff: totalRow?.amountOff ?? null,
        totalStdDevOff: totalRow?.stdDevOff ?? null,
        spreadAmountOff,
        spreadSigmaOff,
      });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, linesGames, ratingsByWeek, totalBetByGameId]);
}

const GOOD_VALUE_BG = "rgba(63, 185, 80, 0.18)";
const BEST_LINE_BG = "rgba(255, 200, 87, 0.14)";

// Slightly roomier than the ultra-dense admin tables elsewhere on the
// site (Totals, Matchups) — this page compares up to 5 sources per game
// side by side, so it needs a bit more air to stay readable rather than
// maximum row density.
const TD: CSSProperties = { padding: "0.6rem 0.75rem", verticalAlign: "middle" };
const TH: CSSProperties = { padding: "0.7rem 0.75rem" };

function fmtPoint(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
function fmtPrice(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  return `${v > 0 ? "+" : ""}${Math.round(v)}`;
}
function dateLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}
function kickoffLabel(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function BookLink({ bookKey, children, block }: { bookKey: string; children: ReactNode; block?: boolean }) {
  const meta = BOOK_META[bookKey];
  if (!meta) return <>{children}</>;
  return (
    <a
      href={meta.url}
      target="_blank"
      rel="noreferrer"
      style={{ color: "inherit", textDecoration: "none", display: block ? "block" : undefined }}
    >
      {children}
    </a>
  );
}

function BookBadge({ bookKey }: { bookKey: string }) {
  const meta = BOOK_META[bookKey];
  if (!meta) return null;
  return (
    <span
      style={{
        display: "inline-block",
        background: meta.color,
        color: "#14152b",
        fontSize: "0.62rem",
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        borderRadius: "999px",
        padding: "0.08rem 0.4rem",
        whiteSpace: "nowrap",
      }}
    >
      {meta.label}
    </span>
  );
}

// One column standing in for what used to be separate Away/Home columns
// — stacked so it reads top-to-bottom exactly like every value column
// next to it (My Line, Best, per-book), instead of sitting side-by-side
// while every other column stacks its away/home values vertically.
function TeamStack({ away, home }: { away: string; home: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.15rem 0" }}>
        <TeamLogo team={away} size={18} />
        <span>{away}</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.15rem 0",
          borderTop: "1px solid var(--hash)",
        }}
      >
        <TeamLogo team={home} size={18} />
        <span>{home}</span>
      </div>
    </div>
  );
}

// Same top/bottom split as TeamStack, used for every value column so the
// top line always means "away" (or "over") and the bottom line always
// means "home" (or "under") — reading straight across a row now lines up
// team-to-number correctly instead of teams sitting in separate columns
// from their numbers.
function SplitCell({ top, bottom, bg, link }: { top: ReactNode; bottom: ReactNode; bg?: string; link?: string }) {
  const content = (
    <div style={{ background: bg }}>
      <div style={{ padding: "0.3rem 0.6rem" }}>{top}</div>
      <div style={{ padding: "0.3rem 0.6rem", borderTop: "1px solid var(--hash)" }}>{bottom}</div>
    </div>
  );
  if (!link) return content;
  return <BookLink bookKey={link} block>{content}</BookLink>;
}

function WhenCell({ week, iso }: { week: number; iso: string | null }) {
  return (
    <div>
      <div style={{ fontSize: "0.78rem" }}>
        Wk {week} · {dateLabel(iso)}
      </div>
      <div style={{ fontSize: "0.72rem", color: "var(--chalk-dim)" }}>{kickoffLabel(iso)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------
// "My" numbers per game — mirrors the exact pattern PredictionsAdminPanel
// uses (myAwaySpread = -myHomeSpread, myTotal = projection.projectedTotal),
// plus fair moneylines derived from spreadToWinPct the same way
// moneylineBetHistory.ts and AdminMatchupsPanel already do.
// ---------------------------------------------------------------------
interface MyLine {
  myHomeSpread: number | null;
  myAwaySpread: number | null;
  myTotal: number | null;
  myHomeWinPct: number | null;
  myAwayWinPct: number | null;
  myHomeMl: number | null;
  myAwayMl: number | null;
}

function myLineFor(row: OddsMatchRow): MyLine {
  const myHomeSpread = row.game.myHomeSpread;
  const myAwaySpread = myHomeSpread != null ? -myHomeSpread : null;
  const myTotal = row.game.projection?.projectedTotal ?? null;
  const myHomeWinPct = myHomeSpread != null ? spreadToWinPct(myHomeSpread) : null;
  const myAwayWinPct = myAwaySpread != null ? spreadToWinPct(myAwaySpread) : null;
  return {
    myHomeSpread,
    myAwaySpread,
    myTotal,
    myHomeWinPct,
    myAwayWinPct,
    myHomeMl: myHomeWinPct != null ? fairMoneylineFromWinPct(myHomeWinPct) : null,
    myAwayMl: myAwayWinPct != null ? fairMoneylineFromWinPct(myAwayWinPct) : null,
  };
}

function booksPresent(row: OddsMatchRow): string[] {
  return BOOK_ORDER.filter((k) => row.books[k]);
}

function bestSpread(row: OddsMatchRow, side: "away" | "home"): { book: string; value: number } | null {
  const books = booksPresent(row);
  const values = books.map((b) => (side === "away" ? row.books[b]!.spreadAway : row.books[b]!.spreadHome));
  const i = bestIndex(values, (a, b) => a > b); // biggest number = most points = best price for either side of a spread
  return i === -1 ? null : { book: books[i], value: values[i]! };
}

function bestMoneyline(row: OddsMatchRow, side: "away" | "home"): { book: string; value: number } | null {
  const books = booksPresent(row);
  const values = books.map((b) => (side === "away" ? row.books[b]!.mlAway : row.books[b]!.mlHome));
  // Best price for the bettor: for a favorite (negative) the least negative wins; for a dog (positive) the most positive wins.
  // Comparing raw American-odds values with ">" happens to get this right in both cases (-105 > -110, +250 > +200).
  const i = bestIndex(values, (a, b) => a > b);
  return i === -1 ? null : { book: books[i], value: values[i]! };
}

function bestTotal(row: OddsMatchRow, side: "over" | "under"): { book: string; value: number } | null {
  const books = booksPresent(row);
  const values = books.map((b) => row.books[b]!.totalPoint);
  // Best Over = lowest total (easiest to clear); best Under = highest total (easiest to stay below).
  const i = bestIndex(values, side === "over" ? (a, b) => a < b : (a, b) => a > b);
  return i === -1 ? null : { book: books[i], value: values[i]! };
}

// ---------------------------------------------------------------------
// Shared sortable-table shell for the three Oddscreen tabs — same
// Matchup/When columns and sort plumbing each time, only the value
// columns differ.
// ---------------------------------------------------------------------
type CoreSortKey = "when" | "matchup";

function useOddscreenSort<ExtraKey extends string>(extraVal: (r: OddsMatchRow, key: ExtraKey) => number) {
  const [sortKey, setSortKey] = useState<CoreSortKey | ExtraKey>("when");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(k: string) {
    const key = k as CoreSortKey | ExtraKey;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortRows(rows: OddsMatchRow[]): OddsMatchRow[] {
    const val = (r: OddsMatchRow): number | string => {
      if (sortKey === "when") return `${String(r.game.game.startDate ?? "")}`;
      if (sortKey === "matchup") return r.game.game.awayTeam;
      return extraVal(r, sortKey as ExtraKey);
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }

  return { sortKey, sortDir, handleSort, sortRows };
}

// ---------------------------------------------------------------------
// Spread tab
// ---------------------------------------------------------------------
type SpreadKey = "bestAway" | "bestHome";

function OddscreenSpread({ rows }: { rows: OddsMatchRow[] }) {
  const { sortKey, sortDir, handleSort, sortRows } = useOddscreenSort<SpreadKey>((r, key) =>
    key === "bestAway" ? bestSpread(r, "away")?.value ?? -Infinity : bestSpread(r, "home")?.value ?? -Infinity
  );
  const sorted = sortRows(rows);
  const sh = (label: string, key: CoreSortKey | SpreadKey) => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("When", "when")}
            {sh("Matchup", "matchup")}
            <th style={TH}>My Line</th>
            {sh("Best Away", "bestAway")}
            {sh("Best Home", "bestHome")}
            {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => (
              <th key={b} style={TH}>
                <BookLink bookKey={b}>{BOOK_META[b].label}</BookLink>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const my = myLineFor(r);
            const bestAway = bestSpread(r, "away");
            const bestHome = bestSpread(r, "home");
            return (
              <tr key={r.game.game.id}>
                <td style={TD}>
                  <WhenCell week={r.game.game.week} iso={r.game.game.startDate} />
                </td>
                <td style={TD}>
                  <TeamStack away={r.game.game.awayTeam} home={r.game.game.homeTeam} />
                </td>
                <td style={{ ...TD, padding: 0 }}>
                  <SplitCell top={fmtPoint(my.myAwaySpread)} bottom={fmtPoint(my.myHomeSpread)} />
                </td>
                <td style={{ ...TD, padding: 0 }}>
                  <SplitCell
                    bg={bestAway ? BEST_LINE_BG : undefined}
                    top={bestAway ? <>{fmtPoint(bestAway.value)} <BookBadge bookKey={bestAway.book} /></> : "–"}
                    bottom=""
                  />
                </td>
                <td style={{ ...TD, padding: 0 }}>
                  <SplitCell
                    bg={bestHome ? BEST_LINE_BG : undefined}
                    top=""
                    bottom={bestHome ? <>{fmtPoint(bestHome.value)} <BookBadge bookKey={bestHome.book} /></> : "–"}
                  />
                </td>
                {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => {
                  const odds: BookOdds | undefined = r.books[b];
                  if (!odds || (odds.spreadHome == null && odds.spreadAway == null)) {
                    return (
                      <td key={b} style={{ ...TD, textAlign: "center", color: "var(--chalk-dim)" }}>
                        –
                      </td>
                    );
                  }
                  const awayEdge = spreadEdgePts(my.myAwaySpread, odds.spreadAway);
                  const homeEdge = spreadEdgePts(my.myHomeSpread, odds.spreadHome);
                  const goodAway = awayEdge != null && awayEdge >= SPREAD_EDGE_THRESHOLD;
                  const goodHome = homeEdge != null && homeEdge >= SPREAD_EDGE_THRESHOLD;
                  return (
                    <td key={b} style={{ ...TD, padding: 0 }}>
                      <SplitCell
                        link={b}
                        top={
                          <span style={{ background: goodAway ? GOOD_VALUE_BG : undefined }}>
                            {fmtPoint(odds.spreadAway)} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.spreadAwayPrice)}</span>
                          </span>
                        }
                        bottom={
                          <span style={{ background: goodHome ? GOOD_VALUE_BG : undefined }}>
                            {fmtPoint(odds.spreadHome)} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.spreadHomePrice)}</span>
                          </span>
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                No matched games with spread data yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Moneyline tab (includes Kalshi)
// ---------------------------------------------------------------------
type MlKey = "bestAway" | "bestHome";

function OddscreenMoneyline({ rows }: { rows: OddsMatchRow[] }) {
  const { sortKey, sortDir, handleSort, sortRows } = useOddscreenSort<MlKey>((r, key) =>
    key === "bestAway" ? bestMoneyline(r, "away")?.value ?? -Infinity : bestMoneyline(r, "home")?.value ?? -Infinity
  );
  const sorted = sortRows(rows);
  const sh = (label: string, key: CoreSortKey | MlKey) => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("When", "when")}
            {sh("Matchup", "matchup")}
            <th style={TH}>My Line</th>
            {sh("Best Away", "bestAway")}
            {sh("Best Home", "bestHome")}
            {BOOK_ORDER.map((b) => (
              <th key={b} style={TH}>
                <BookLink bookKey={b}>{BOOK_META[b].label}</BookLink>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const my = myLineFor(r);
            const bestAway = bestMoneyline(r, "away");
            const bestHome = bestMoneyline(r, "home");
            return (
              <tr key={r.game.game.id}>
                <td style={TD}>
                  <WhenCell week={r.game.game.week} iso={r.game.game.startDate} />
                </td>
                <td style={TD}>
                  <TeamStack away={r.game.game.awayTeam} home={r.game.game.homeTeam} />
                </td>
                <td style={{ ...TD, padding: 0 }}>
                  <SplitCell top={fmtPrice(my.myAwayMl)} bottom={fmtPrice(my.myHomeMl)} />
                </td>
                <td style={{ ...TD, padding: 0 }}>
                  <SplitCell
                    bg={bestAway ? BEST_LINE_BG : undefined}
                    top={bestAway ? <>{fmtPrice(bestAway.value)} <BookBadge bookKey={bestAway.book} /></> : "–"}
                    bottom=""
                  />
                </td>
                <td style={{ ...TD, padding: 0 }}>
                  <SplitCell
                    bg={bestHome ? BEST_LINE_BG : undefined}
                    top=""
                    bottom={bestHome ? <>{fmtPrice(bestHome.value)} <BookBadge bookKey={bestHome.book} /></> : "–"}
                  />
                </td>
                {BOOK_ORDER.map((b) => {
                  const odds: BookOdds | undefined = r.books[b];
                  if (!odds || (odds.mlHome == null && odds.mlAway == null)) {
                    return (
                      <td key={b} style={{ ...TD, textAlign: "center", color: "var(--chalk-dim)" }}>
                        –
                      </td>
                    );
                  }
                  const awayEdge = moneylineEdgePct(my.myAwayWinPct, odds.mlAway);
                  const homeEdge = moneylineEdgePct(my.myHomeWinPct, odds.mlHome);
                  const goodAway = awayEdge != null && awayEdge >= ML_EDGE_THRESHOLD;
                  const goodHome = homeEdge != null && homeEdge >= ML_EDGE_THRESHOLD;
                  return (
                    <td key={b} style={{ ...TD, padding: 0 }}>
                      <SplitCell
                        link={b}
                        top={<span style={{ background: goodAway ? GOOD_VALUE_BG : undefined }}>{fmtPrice(odds.mlAway)}</span>}
                        bottom={<span style={{ background: goodHome ? GOOD_VALUE_BG : undefined }}>{fmtPrice(odds.mlHome)}</span>}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
                No matched games with moneyline data yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Total tab
// ---------------------------------------------------------------------
type TotalKey = "bestOver" | "bestUnder";

function OddscreenTotal({ rows }: { rows: OddsMatchRow[] }) {
  const { sortKey, sortDir, handleSort, sortRows } = useOddscreenSort<TotalKey>((r, key) =>
    key === "bestOver" ? bestTotal(r, "over")?.value ?? Infinity : bestTotal(r, "under")?.value ?? -Infinity
  );
  const sorted = sortRows(rows);
  const sh = (label: string, key: CoreSortKey | TotalKey) => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("When", "when")}
            {sh("Matchup", "matchup")}
            <th style={TH}>My Total</th>
            {sh("Best Over", "bestOver")}
            {sh("Best Under", "bestUnder")}
            {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => (
              <th key={b} style={TH}>
                <BookLink bookKey={b}>{BOOK_META[b].label}</BookLink>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const my = myLineFor(r);
            const bestOver = bestTotal(r, "over");
            const bestUnder = bestTotal(r, "under");
            return (
              <tr key={r.game.game.id}>
                <td style={TD}>
                  <WhenCell week={r.game.game.week} iso={r.game.game.startDate} />
                </td>
                <td style={TD}>
                  <TeamStack away={r.game.game.awayTeam} home={r.game.game.homeTeam} />
                </td>
                <td style={TD}>{my.myTotal != null ? my.myTotal.toFixed(1) : "–"}</td>
                <td style={{ ...TD, background: bestOver ? BEST_LINE_BG : undefined }}>
                  {bestOver ? (
                    <BookLink bookKey={bestOver.book}>
                      O {bestOver.value} <BookBadge bookKey={bestOver.book} />
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                <td style={{ ...TD, background: bestUnder ? BEST_LINE_BG : undefined }}>
                  {bestUnder ? (
                    <BookLink bookKey={bestUnder.book}>
                      U {bestUnder.value} <BookBadge bookKey={bestUnder.book} />
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => {
                  const odds: BookOdds | undefined = r.books[b];
                  if (!odds || odds.totalPoint == null) {
                    return (
                      <td key={b} style={{ ...TD, textAlign: "center", color: "var(--chalk-dim)" }}>
                        –
                      </td>
                    );
                  }
                  const { amountOff, call } = totalCall(my.myTotal, odds.totalPoint);
                  const good = amountOff != null && Math.abs(amountOff) >= TOTAL_EDGE_THRESHOLD;
                  return (
                    <td key={b} style={{ ...TD, padding: 0 }}>
                      <BookLink bookKey={b} block>
                        <div style={{ padding: "0.4rem 0.6rem", background: good ? GOOD_VALUE_BG : undefined }}>
                          <div>
                            O {odds.totalPoint} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.overPrice)}</span>
                          </div>
                          <div>
                            U {odds.totalPoint} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.underPrice)}</span>
                          </div>
                          {good && <div style={{ fontSize: "0.68rem", opacity: 0.85 }}>{call}</div>}
                        </div>
                      </BookLink>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={8} className="empty">
                No matched games with total data yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------
// Game detail (expanded card) — a purpose-built layout rather than
// reusing the multi-game Oddscreen tables at 1 row, which read poorly
// that small. One clean list per market: My Line first, then every book
// sorted with the best price on top, best cell called out.
// ---------------------------------------------------------------------
function DetailRow({ label, my, book, awayVal, homeVal }: { label: string; my?: boolean; book?: string; awayVal: ReactNode; homeVal: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "5.5rem 1fr 1fr",
        gap: "0.5rem",
        alignItems: "center",
        padding: "0.4rem 0",
        borderTop: "1px solid var(--hash)",
        fontWeight: my ? 700 : 400,
        color: my ? "var(--gold)" : undefined,
      }}
    >
      <div style={{ fontSize: "0.75rem" }}>{book ? <BookBadge bookKey={book} /> : label}</div>
      <div>{awayVal}</div>
      <div>{homeVal}</div>
    </div>
  );
}

function GameDetail({ row }: { row: OddsMatchRow }) {
  const my = myLineFor(row);
  const books = booksPresent(row);

  return (
    <div style={{ background: "var(--turf)", border: "1px solid var(--hash)", borderRadius: "10px", padding: "1rem", marginTop: "0.75rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "5.5rem 1fr 1fr", gap: "0.5rem", fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        <div />
        <div>{row.game.game.awayTeam}</div>
        <div>{row.game.game.homeTeam}</div>
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Spread</div>
      <DetailRow label="My Line" my awayVal={fmtPoint(my.myAwaySpread)} homeVal={fmtPoint(my.myHomeSpread)} />
      {books
        .filter((b) => b !== "kalshi")
        .map((b) => {
          const o = row.books[b]!;
          return (
            <DetailRow
              key={b}
              label={BOOK_META[b].label}
              book={b}
              awayVal={o.spreadAway != null ? `${fmtPoint(o.spreadAway)} (${fmtPrice(o.spreadAwayPrice)})` : "–"}
              homeVal={o.spreadHome != null ? `${fmtPoint(o.spreadHome)} (${fmtPrice(o.spreadHomePrice)})` : "–"}
            />
          );
        })}

      <div style={{ marginTop: "1rem", fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Moneyline</div>
      <DetailRow label="My Line" my awayVal={fmtPrice(my.myAwayMl)} homeVal={fmtPrice(my.myHomeMl)} />
      {books.map((b) => {
        const o = row.books[b]!;
        return <DetailRow key={b} label={BOOK_META[b].label} book={b} awayVal={fmtPrice(o.mlAway)} homeVal={fmtPrice(o.mlHome)} />;
      })}

      <div style={{ marginTop: "1rem", fontSize: "0.72rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total (Over / Under)</div>
      <DetailRow label="My Line" my awayVal={my.myTotal != null ? my.myTotal.toFixed(1) : "–"} homeVal="" />
      {books
        .filter((b) => b !== "kalshi")
        .map((b) => {
          const o = row.books[b]!;
          return (
            <DetailRow
              key={b}
              label={BOOK_META[b].label}
              book={b}
              awayVal={o.totalPoint != null ? `O ${o.totalPoint} (${fmtPrice(o.overPrice)})` : "–"}
              homeVal={o.totalPoint != null ? `U ${o.totalPoint} (${fmtPrice(o.underPrice)})` : "–"}
            />
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Game Cards — a tile grid, one per game. Team name only appears once
// per row (next to that team's logo); the value chips beside it don't
// repeat it.
// ---------------------------------------------------------------------
function ValueChip({ label, best, book, onClick }: { label: string; best: string; book?: string; onClick?: () => void }) {
  return (
    <div style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ fontSize: "0.62rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      {book ? (
        <BookLink bookKey={book}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{best}</div>
          <BookBadge bookKey={book} />
        </BookLink>
      ) : (
        <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--chalk-dim)" }} onClick={onClick}>
          {best}
        </div>
      )}
    </div>
  );
}

function BetBadge({ label, tone }: { label: string; tone: "gold" | "green" }) {
  return (
    <span
      style={{
        fontSize: "0.62rem",
        fontWeight: 700,
        padding: "0.15rem 0.4rem",
        borderRadius: 4,
        background: tone === "gold" ? "rgba(255, 200, 87, 0.18)" : "rgba(63, 185, 80, 0.2)",
        color: tone === "gold" ? "var(--gold)" : "#8fd39a",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function GameCard({ row, signal }: { row: OddsMatchRow; signal: OddsBetSignal | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const bestAwaySpread = bestSpread(row, "away");
  const bestHomeSpread = bestSpread(row, "home");
  const bestAwayMl = bestMoneyline(row, "away");
  const bestHomeMl = bestMoneyline(row, "home");
  const bestOver = bestTotal(row, "over");
  const bestUnder = bestTotal(row, "under");

  const myHomeSpread = row.game.myHomeSpread;
  const myAwaySpread = myHomeSpread != null ? -myHomeSpread : null;
  const myAwayWinPct = myAwaySpread != null ? spreadToWinPct(myAwaySpread) : null;
  const myHomeWinPct = myAwayWinPct != null ? 1 - myAwayWinPct : null;
  const myAwayMl = myAwayWinPct != null ? fairMoneylineFromWinPct(myAwayWinPct) : null;
  const myHomeMl = myHomeWinPct != null ? fairMoneylineFromWinPct(myHomeWinPct) : null;
  const myTotal = row.game.projection?.projectedTotal ?? null;

  const teamRow = (
    team: string,
    spread: { book: string; value: number } | null,
    ml: { book: string; value: number } | null,
    mySpread: number | null,
    myMl: number | null
  ) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.4rem 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
        <TeamLogo team={team} size={26} />
        <span style={{ fontWeight: 700, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team}</span>
      </div>
      <div style={{ display: "flex", gap: "1rem", flexShrink: 0, textAlign: "right" }}>
        <div>
          <ValueChip label="Spread" best={spread ? fmtPoint(spread.value) : "–"} book={spread?.book} />
          <div style={{ fontSize: "0.68rem", color: "var(--chalk-dim)", marginTop: "0.1rem" }}>
            Me: {fmtPoint(mySpread)}
          </div>
        </div>
        <div>
          <ValueChip label="ML" best={ml ? fmtPrice(ml.value) : "–"} book={ml?.book} />
          <div style={{ fontSize: "0.68rem", color: "var(--chalk-dim)", marginTop: "0.1rem" }}>
            Me: {fmtPrice(myMl)}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div
      style={{
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: "12px",
        padding: "1rem",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onClick={() => setExpanded((e) => !e)}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--gold-dim)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--hash)")}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.3rem" }}>
        <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)" }}>
          Wk {row.game.game.week} · {dateLabel(row.game.game.startDate)} · {kickoffLabel(row.game.game.startDate)}
        </div>
        <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "55%" }}>
          {signal?.spreadTier && <BetBadge label={`Spread: ${signal.spreadTier}`} tone="gold" />}
          {signal?.mlBet && <BetBadge label="ML: Bet" tone="green" />}
          {signal?.totalBet && <BetBadge label="Total: Bet" tone="green" />}
        </div>
      </div>

      {teamRow(row.game.game.awayTeam, bestAwaySpread, bestAwayMl, myAwaySpread, myAwayMl)}
      <div style={{ borderTop: "1px solid var(--hash)" }} />
      {teamRow(row.game.game.homeTeam, bestHomeSpread, bestHomeMl, myHomeSpread, myHomeMl)}

      <div
        style={{
          borderTop: "1px solid var(--hash)",
          marginTop: "0.4rem",
          paddingTop: "0.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: "0.62rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Total {myTotal != null && <span style={{ textTransform: "none" }}>· Me: {myTotal.toFixed(1)}</span>}
        </span>
        <div style={{ display: "flex", gap: "1rem" }}>
          <ValueChip label="Over" best={bestOver ? bestOver.value.toString() : "–"} book={bestOver?.book} />
          <ValueChip label="Under" best={bestUnder ? bestUnder.value.toString() : "–"} book={bestUnder?.book} />
        </div>
      </div>

      {expanded && (
        <div onClick={(e) => e.stopPropagation()}>
          <GameDetail row={row} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Futures — a market picker (championship / conference / playoff-tree
// qualifiers / undefeated / win totals) with the same Cards/Oddscreen
// choice as the game-level views above. Column order: Team, our own
// fair Yes/No (from the most recent Monte Carlo run), Kalshi's Yes/No,
// Value (ours minus Kalshi's, on the Yes side), then any bookmaker
// columns the market has (championship/conference only).
// ---------------------------------------------------------------------
function fmtPct1(p: number | null): string {
  return p == null ? "–" : `${p.toFixed(1)}%`;
}
function fmtCents(p: number | null): string {
  return p == null ? "–" : `${Math.round(p)}¢`;
}
function valueColor(v: number | null): string | undefined {
  if (v == null) return undefined;
  if (v > 0.5) return "#8fd39a";
  if (v < -0.5) return "#c45c52";
  return undefined;
}
function fmtValue(v: number | null): string {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}pp`;
}

// Shared filter: |value| at/above this many percentage points counts as
// "has value" for the Value-only toggle on both Cards and Oddscreen.
const VALUE_THRESHOLD_PP = 1;
function hasValue(v: number | null): boolean {
  return v != null && Math.abs(v) >= VALUE_THRESHOLD_PP;
}

function FuturesOutcomeCard({ row }: { row: FuturesOutcomeRow }) {
  return (
    <div
      style={{
        background: "var(--turf-panel)",
        border: "1px solid var(--hash)",
        borderRadius: "12px",
        padding: "0.7rem 0.85rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <TeamLogo team={row.team} size={24} />
        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{row.team}</span>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.72rem" }}>
        <div style={{ padding: "0.2rem 0.5rem", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ color: "var(--chalk-dim)" }}>Me Y/N</div>
          <div style={{ fontWeight: 700 }}>
            {fmtCents(row.myYesPct)} / {fmtCents(row.myNoPct)}
          </div>
        </div>
        <div style={{ padding: "0.2rem 0.5rem", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ color: "var(--chalk-dim)" }}>Kalshi Y/N</div>
          <div style={{ fontWeight: 700 }}>
            {fmtCents(row.kalshiYesPct)} / {fmtCents(row.kalshiNoPct)}
          </div>
        </div>
        <div style={{ padding: "0.2rem 0.5rem", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
          <div style={{ color: "var(--chalk-dim)" }}>Value</div>
          <div style={{ fontWeight: 700, color: valueColor(row.valuePct) }}>{fmtValue(row.valuePct)}</div>
        </div>
        {row.otherSources.map((s, i) => (
          <div key={i} style={{ padding: "0.2rem 0.5rem", borderRadius: 6, background: "rgba(255,255,255,0.04)" }}>
            <div style={{ color: "var(--chalk-dim)" }}>{s.label}</div>
            <div style={{ fontWeight: 700 }}>{fmtPrice(s.americanOdds)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FuturesOddscreenTable({ group }: { group: FuturesMarketGroup }) {
  const allLabels = Array.from(new Set(group.outcomes.flatMap((o) => o.otherSources.map((s) => s.label))));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr>
            <th style={{ ...TH, textAlign: "left" }}>Team</th>
            <th style={{ ...TH, textAlign: "right" }}>Me Yes</th>
            <th style={{ ...TH, textAlign: "right" }}>Me No</th>
            <th style={{ ...TH, textAlign: "right" }}>Kalshi Yes</th>
            <th style={{ ...TH, textAlign: "right" }}>Kalshi No</th>
            <th style={{ ...TH, textAlign: "right" }}>Value</th>
            {allLabels.map((label) => (
              <th key={label} style={{ ...TH, textAlign: "right" }}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.outcomes.map((row) => {
            const byLabel = new Map(row.otherSources.map((s) => [s.label, s]));
            return (
              <tr key={row.team} style={{ borderTop: "1px solid var(--hash)" }}>
                <td style={TD}>
                  <TeamLogo team={row.team} size={18} /> {row.team}
                </td>
                <td style={{ ...TD, textAlign: "right" }}>{fmtCents(row.myYesPct)}</td>
                <td style={{ ...TD, textAlign: "right" }}>{fmtCents(row.myNoPct)}</td>
                <td style={{ ...TD, textAlign: "right" }}>{fmtCents(row.kalshiYesPct)}</td>
                <td style={{ ...TD, textAlign: "right" }}>{fmtCents(row.kalshiNoPct)}</td>
                <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: valueColor(row.valuePct) }}>{fmtValue(row.valuePct)}</td>
                {allLabels.map((label) => {
                  const s = byLabel.get(label);
                  return (
                    <td key={label} style={{ ...TD, textAlign: "right" }}>
                      {s ? fmtPrice(s.americanOdds) : "–"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Sticky header row + sticky first column, since a full win-total ladder
// (1+ through 11+, dozens of teams) runs well past one screen both ways.
const STICKY_TH: CSSProperties = { ...TH, position: "sticky", top: 0, background: "var(--turf-panel)", zIndex: 2, textAlign: "right" };
const STICKY_TEAM_TH: CSSProperties = { ...STICKY_TH, left: 0, zIndex: 3, textAlign: "left" };
const STICKY_TEAM_TD: CSSProperties = { ...TD, position: "sticky", left: 0, background: "var(--turf-panel)", zIndex: 1 };

function FuturesWinTotalsTable({ season }: { season: number }) {
  const { rows, thresholds, loading, error } = useFuturesWinTotals(season);
  const [sortThreshold, setSortThreshold] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [sortMetric, setSortMetric] = useState<"value" | "kalshi">("value");
  const [valueOnly, setValueOnly] = useState(false);

  if (loading) return <div className="empty">Loading win totals…</div>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (rows.length === 0) return <div className="empty">No win-total markets found (KXNCAAFWINS may be closed right now).</div>;

  const filtered = valueOnly ? rows.filter((r) => Object.values(r.byThreshold).some((c) => hasValue(c.valuePct))) : rows;
  const sorted =
    sortThreshold == null
      ? filtered
      : [...filtered].sort((a, b) => {
          const field = sortMetric === "value" ? "valuePct" : "kalshiPct";
          const av = a.byThreshold[sortThreshold]?.[field] ?? -Infinity;
          const bv = b.byThreshold[sortThreshold]?.[field] ?? -Infinity;
          return sortDir === "asc" ? av - bv : bv - av;
        });

  function handleSortClick(t: number) {
    if (sortThreshold === t) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortThreshold(t);
      setSortDir("desc");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.6rem" }}>
        <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <input type="checkbox" checked={valueOnly} onChange={(e) => setValueOnly(e.target.checked)} />
          Only show teams with value somewhere on the ladder
        </label>
        <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Sort headers by:</span>
        <select value={sortMetric} onChange={(e) => setSortMetric(e.target.value as "value" | "kalshi")}>
          <option value="value">Value</option>
          <option value="kalshi">Kalshi price</option>
        </select>
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--chalk-dim)", marginTop: 0 }}>
        Each cell: Kalshi's price (top) / mine (bottom). Green background = I'm higher than Kalshi (Yes has value);
        red = Kalshi's higher than me (No has value). Click a threshold header to sort every row by that column's{" "}
        {sortMetric === "value" ? "value" : "Kalshi price"}.
      </p>
      <div style={{ overflow: "auto", maxHeight: "70vh", border: "1px solid var(--hash)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <th style={STICKY_TEAM_TH}>Team</th>
              {thresholds.map((t) => (
                <th key={t} style={{ ...STICKY_TH, cursor: "pointer" }} onClick={() => handleSortClick(t)}>
                  {t}+ {sortThreshold === t ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.team} style={{ borderTop: "1px solid var(--hash)" }}>
                <td style={STICKY_TEAM_TD}>
                  <TeamLogo team={row.team} size={18} /> {row.team}
                </td>
                {thresholds.map((t) => {
                  const cell = row.byThreshold[t];
                  if (!cell || (cell.kalshiPct == null && cell.myPct == null)) {
                    return (
                      <td key={t} style={{ ...TD, textAlign: "right" }}>
                        –
                      </td>
                    );
                  }
                  return (
                    <td
                      key={t}
                      style={{
                        ...TD,
                        textAlign: "right",
                        background: hasValue(cell.valuePct) ? (cell.valuePct! > 0 ? GOOD_VALUE_BG : "rgba(196,92,82,0.16)") : undefined,
                      }}
                    >
                      <div>{fmtPct1(cell.kalshiPct)}</div>
                      <div style={{ color: "var(--chalk-dim)" }}>{fmtPct1(cell.myPct)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type FuturesSortMode = "default" | "value";

function FuturesTab({ season }: { season: number }) {
  const { groups, loading, error } = useFuturesMarkets(season);
  const [marketKey, setMarketKey] = useState<string>("championship");
  const [view, setView] = useState<"cards" | "oddscreen">("oddscreen");
  const [sortMode, setSortMode] = useState<FuturesSortMode>("default");
  const [valueOnly, setValueOnly] = useState(false);

  const nonConfGroups = groups.filter((g) => !g.key.startsWith("conf-"));
  const confGroups = groups.filter((g) => g.key.startsWith("conf-"));
  const rawGroup = marketKey === "wintotals" ? null : groups.find((g) => g.key === marketKey);

  const selectedGroup = rawGroup
    ? {
        ...rawGroup,
        outcomes: (() => {
          let outcomes = rawGroup.outcomes;
          if (valueOnly) outcomes = outcomes.filter((o) => hasValue(o.valuePct));
          if (sortMode === "value") outcomes = [...outcomes].sort((a, b) => Math.abs(b.valuePct ?? 0) - Math.abs(a.valuePct ?? 0));
          return outcomes;
        })(),
      }
    : null;

  return (
    <div>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.8rem", marginTop: 0, marginBottom: "0.75rem" }}>
        My fair Yes/No comes from the most recently saved Monte Carlo run (same numbers as Prediction Markets).
        Value = my Yes price minus Kalshi's Yes price, in cents — positive (green) means buying Yes has an edge,
        negative (red) means buying No does.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem", alignItems: "center" }}>
        {nonConfGroups.map((g) => (
          <button key={g.key} className={`mode-btn ${marketKey === g.key ? "mode-btn-active" : ""}`} onClick={() => setMarketKey(g.key)}>
            {g.label}
          </button>
        ))}
        <button className={`mode-btn ${marketKey === "wintotals" ? "mode-btn-active" : ""}`} onClick={() => setMarketKey("wintotals")}>
          Win Totals
        </button>
        {confGroups.length > 0 && (
          <>
            <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginLeft: "0.5rem" }}>Conference:</span>
            <select value={confGroups.some((g) => g.key === marketKey) ? marketKey : ""} onChange={(e) => setMarketKey(e.target.value)}>
              <option value="" disabled>
                Choose a conference…
              </option>
              {confGroups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {marketKey !== "wintotals" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input type="checkbox" checked={valueOnly} onChange={(e) => setValueOnly(e.target.checked)} />
            Only show value
          </label>
          <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Sort:</span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as FuturesSortMode)}>
            <option value="default">Best price</option>
            <option value="value">Value (biggest edge first)</option>
          </select>
          <span style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
            <button className={`mode-btn ${view === "cards" ? "mode-btn-active" : ""}`} onClick={() => setView("cards")}>
              Cards
            </button>
            <button className={`mode-btn ${view === "oddscreen" ? "mode-btn-active" : ""}`} onClick={() => setView("oddscreen")}>
              Oddscreen
            </button>
          </span>
        </div>
      )}

      {marketKey === "wintotals" ? (
        <FuturesWinTotalsTable season={season} />
      ) : loading ? (
        <div className="empty">Loading futures…</div>
      ) : error ? (
        <p style={{ color: "crimson" }}>{error}</p>
      ) : !selectedGroup || selectedGroup.outcomes.length === 0 ? (
        <div className="empty">No prices match right now (try turning off "Only show value").</div>
      ) : view === "cards" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.6rem" }}>
          {selectedGroup.outcomes.map((row) => (
            <FuturesOutcomeCard key={row.team} row={row} />
          ))}
        </div>
      ) : (
        <FuturesOddscreenTable group={selectedGroup} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
type TopView = "cards" | "oddscreen" | "futures";
type OddscreenTab = "spread" | "moneyline" | "total";

export default function OddsDashboardAdminPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [division, setDivision] = useState("FBS");
  const { rows: allRows, settings, loading: loadingSite, error: siteError } = useGameTotalsEngine(season);
  const siteRows = filterRowsByDivision(allRows, division);

  const [oddsGames, setOddsGames] = useState<OddsGame[]>([]);
  const [kalshiGames, setKalshiGames] = useState<KalshiGame[]>([]);
  const [loadingOdds, setLoadingOdds] = useState(true);
  const [oddsError, setOddsError] = useState<string | null>(null);

  const [topView, setTopView] = useState<TopView>("oddscreen");
  const [oddscreenTab, setOddscreenTab] = useState<OddscreenTab>("spread");

  // Fetch on open, and again only when the Refresh button is clicked —
  // deliberately no interval/polling so this doesn't burn API credits in
  // the background while the tab just sits open.
  function loadOdds() {
    setLoadingOdds(true);
    setOddsError(null);
    Promise.all([fetchOddsFeed(), fetchKalshiCfbMarkets()])
      .then(([odds, kalshi]) => {
        setOddsGames(odds);
        setKalshiGames(kalshi);
      })
      .catch((err) => setOddsError(err.message ?? "Failed to load odds"))
      .finally(() => setLoadingOdds(false));
  }

  useEffect(() => {
    loadOdds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRefresh() {
    invalidateOddsFeed();
    loadOdds();
  }

  const matched = useMemo(() => matchOddsGames(oddsGames, kalshiGames, siteRows), [oddsGames, kalshiGames, siteRows]);
  const betSignals = useOddsBetSignals(season, matched, siteRows, settings.filterThresholdMultiplier);
  const loading = loadingSite || loadingOdds;

  // Filters — apply to both Game Cards and Oddscreen.
  const availableWeeks = useMemo(() => Array.from(new Set(matched.map((r) => r.game.game.week))).sort((a, b) => a - b), [matched]);
  const [weekFilter, setWeekFilter] = useState<Set<number>>(new Set());
  const [betOnly, setBetOnly] = useState(false);
  const [betTypeFilter, setBetTypeFilter] = useState<Set<"spread" | "moneyline" | "total">>(
    new Set(["spread", "moneyline", "total"])
  );
  type SortMode = "week" | "betPriority" | "mlEv" | "spreadAmountOff" | "spreadSigmaOff" | "totalAmountOff";
  const [sortMode, setSortMode] = useState<SortMode>("week");

  // "This week & later" — the earliest week among games that haven't
  // been played yet (no score), rather than today's calendar date, so
  // it still makes sense mid-week before every game in the current week
  // has kicked off.
  function selectThisWeekAndLater() {
    const upcoming = matched.filter((r) => !r.game.game.completed);
    const weeks = upcoming.length > 0 ? upcoming.map((r) => r.game.game.week) : matched.map((r) => r.game.game.week);
    const currentWeek = Math.min(...weeks);
    setWeekFilter(new Set(availableWeeks.filter((w) => w >= currentWeek)));
  }
  function toggleWeek(w: number) {
    setWeekFilter((prev) => {
      const next = new Set(prev);
      if (next.has(w)) next.delete(w);
      else next.add(w);
      return next;
    });
  }
  function toggleBetType(t: "spread" | "moneyline" | "total") {
    setBetTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function rowHasBetOfSelectedType(row: OddsMatchRow): boolean {
    const sig = betSignals.get(row.game.game.id);
    if (!sig) return false;
    if (betTypeFilter.has("spread") && sig.spreadTier != null) return true;
    if (betTypeFilter.has("moneyline") && sig.mlBet) return true;
    if (betTypeFilter.has("total") && sig.totalBet) return true;
    return false;
  }

  const filteredMatched = useMemo(() => {
    return matched.filter((row) => {
      if (weekFilter.size > 0 && !weekFilter.has(row.game.game.week)) return false;
      if (betOnly && !rowHasBetOfSelectedType(row)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, weekFilter, betOnly, betTypeFilter, betSignals]);

  const spreadTierRank: Record<string, number> = { NWFB: 3, WFB: 2, Filtered: 1 };
  function sortedRows(rows: OddsMatchRow[]): OddsMatchRow[] {
    const withSignal = rows.map((r) => ({ r, sig: betSignals.get(r.game.game.id) }));
    withSignal.sort((a, b) => {
      switch (sortMode) {
        case "betPriority": {
          const av = a.sig ? Math.max(spreadTierRank[a.sig.spreadTier ?? ""] ?? 0, a.sig.mlBet ? 2 : 0, a.sig.totalBet ? 2 : 0) : 0;
          const bv = b.sig ? Math.max(spreadTierRank[b.sig.spreadTier ?? ""] ?? 0, b.sig.mlBet ? 2 : 0, b.sig.totalBet ? 2 : 0) : 0;
          return bv - av;
        }
        case "mlEv": {
          const av = a.sig?.mlEv ?? -Infinity;
          const bv = b.sig?.mlEv ?? -Infinity;
          return bv - av;
        }
        case "spreadAmountOff": {
          const av = a.sig?.spreadAmountOff ?? -Infinity;
          const bv = b.sig?.spreadAmountOff ?? -Infinity;
          return bv - av;
        }
        case "spreadSigmaOff": {
          const av = a.sig?.spreadSigmaOff ?? -Infinity;
          const bv = b.sig?.spreadSigmaOff ?? -Infinity;
          return bv - av;
        }
        case "totalAmountOff": {
          const av = a.sig?.totalAmountOff ?? -Infinity;
          const bv = b.sig?.totalAmountOff ?? -Infinity;
          return bv - av;
        }
        case "week":
        default:
          return a.r.game.game.week - b.r.game.game.week || String(a.r.game.game.startDate).localeCompare(String(b.r.game.game.startDate));
      }
    });
    return withSignal.map((x) => x.r);
  }

  return (
    <div>
      <button className="menu-btn" onClick={onBack} style={{ marginBottom: "1.5rem" }}>
        ‹ Admin
      </button>
      <h2 style={{ marginTop: 0 }}>Odds</h2>
      <p style={{ color: "var(--chalk-dim)", fontSize: "0.85rem", marginTop: 0 }}>
        Live snapshot from Novig, BetOnline, and Bovada (via The Odds API) plus Kalshi (moneyline only — it has no
        spread/total product), lined up against my own projections. Fetched when this page opens and on manual
        refresh only — nothing polls in the background, to stay well under the API quota.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
        <button className="menu-btn" onClick={handleRefresh} disabled={loadingOdds}>
          {loadingOdds ? "Refreshing…" : "Refresh odds"}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
          <button className={`mode-btn ${topView === "cards" ? "mode-btn-active" : ""}`} onClick={() => setTopView("cards")}>
            Game Cards
          </button>
          <button className={`mode-btn ${topView === "oddscreen" ? "mode-btn-active" : ""}`} onClick={() => setTopView("oddscreen")}>
            Oddscreen
          </button>
          <button className={`mode-btn ${topView === "futures" ? "mode-btn-active" : ""}`} onClick={() => setTopView("futures")}>
            Futures
          </button>
        </div>
      </div>

      {topView !== "futures" && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem" }}>
            <label style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <input type="checkbox" checked={betOnly} onChange={(e) => setBetOnly(e.target.checked)} />
              Bets only
            </label>
            <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Bet type:</span>
            {(["spread", "moneyline", "total"] as const).map((t) => (
              <button key={t} className={`mode-btn ${betTypeFilter.has(t) ? "mode-btn-active" : ""}`} onClick={() => toggleBetType(t)}>
                {t === "spread" ? "Spread" : t === "moneyline" ? "Moneyline" : "Total"}
              </button>
            ))}
            <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)", marginLeft: "0.5rem" }}>Sort:</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
              <option value="week">Week / kickoff</option>
              <option value="betPriority">Bet priority</option>
              <option value="mlEv">Moneyline EV</option>
              <option value="spreadAmountOff">Spread amount off</option>
              <option value="spreadSigmaOff">Spread sigma off</option>
              <option value="totalAmountOff">Total amount off</option>
            </select>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center", marginBottom: "1rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--chalk-dim)" }}>Weeks:</span>
            <button className="mode-btn" onClick={selectThisWeekAndLater}>
              This week &amp; later
            </button>
            {weekFilter.size > 0 && (
              <button className="mode-btn" onClick={() => setWeekFilter(new Set())}>
                Clear
              </button>
            )}
            {availableWeeks.map((w) => (
              <button
                key={w}
                className={`mode-btn ${weekFilter.size === 0 || weekFilter.has(w) ? "mode-btn-active" : ""}`}
                style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }}
                onClick={() => toggleWeek(w)}
              >
                Wk {w}
              </button>
            ))}
          </div>
        </>
      )}

      {siteError && <p style={{ color: "crimson" }}>{siteError}</p>}
      {oddsError && <p style={{ color: "crimson" }}>Odds feed: {oddsError}</p>}

      {topView === "futures" ? (
        <FuturesTab season={season} />
      ) : loading ? (
        <div className="empty">Loading…</div>
      ) : topView === "cards" ? (
        <div>
          {filteredMatched.length === 0 && <div className="empty">No games match these filters.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
            {sortedRows(filteredMatched).map((row) => (
              <GameCard key={row.game.game.id} row={row} signal={betSignals.get(row.game.game.id)} />
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem" }}>
            <button className={`mode-btn ${oddscreenTab === "spread" ? "mode-btn-active" : ""}`} onClick={() => setOddscreenTab("spread")}>
              Spread
            </button>
            <button className={`mode-btn ${oddscreenTab === "moneyline" ? "mode-btn-active" : ""}`} onClick={() => setOddscreenTab("moneyline")}>
              Moneyline
            </button>
            <button className={`mode-btn ${oddscreenTab === "total" ? "mode-btn-active" : ""}`} onClick={() => setOddscreenTab("total")}>
              Total
            </button>
          </div>
          {oddscreenTab === "spread" && <OddscreenSpread rows={sortedRows(filteredMatched)} />}
          {oddscreenTab === "moneyline" && <OddscreenMoneyline rows={sortedRows(filteredMatched)} />}
          {oddscreenTab === "total" && <OddscreenTotal rows={sortedRows(filteredMatched)} />}
        </div>
      )}
    </div>
  );
}
