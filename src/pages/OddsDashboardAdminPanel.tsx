import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import SortHeader from "../components/SortHeader";
import { spreadToWinPct, fairMoneylineFromWinPct } from "../lib/odds";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { fetchOddsFeed, invalidateOddsFeed, BOOK_META, BOOK_ORDER } from "../lib/api/oddsApi";
import { fetchKalshiCfbMarkets, type KalshiGame } from "../lib/api/kalshi";
import type { OddsGame } from "../lib/api/oddsApi";
import { matchOddsGames, type OddsMatchRow, type BookOdds } from "../lib/oddsMatch";
import { moneylineEdgePct, spreadEdgePts, totalCall, bestIndex, SPREAD_EDGE_THRESHOLD, TOTAL_EDGE_THRESHOLD, ML_EDGE_THRESHOLD } from "../lib/oddsValue";
import { SeasonPicker, DivisionPicker, filterRowsByDivision } from "./GameTotalsAdminPanel";

const CP: CSSProperties = { padding: "0.3rem 0.5rem", fontSize: "0.78rem", borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap" };
const GOOD_VALUE_BG = "rgba(90, 168, 105, 0.28)";
const BEST_LINE_BG = "rgba(212, 175, 55, 0.22)";

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

function BookLink({ bookKey, children }: { bookKey: string; children: ReactNode }) {
  const meta = BOOK_META[bookKey];
  if (!meta) return <>{children}</>;
  return (
    <a href={meta.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
      {children}
    </a>
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

// ---------------------------------------------------------------------
// Spread tab
// ---------------------------------------------------------------------
function SpreadCell({ book, odds, my }: { book: string; odds: BookOdds | undefined; my: MyLine }) {
  if (!odds || (odds.spreadHome == null && odds.spreadAway == null)) {
    return <td style={{ ...CP, textAlign: "center", color: "var(--chalk-dim)" }}>–</td>;
  }
  const awayEdge = spreadEdgePts(my.myAwaySpread, odds.spreadAway);
  const homeEdge = spreadEdgePts(my.myHomeSpread, odds.spreadHome);
  const goodAway = awayEdge != null && awayEdge >= SPREAD_EDGE_THRESHOLD;
  const goodHome = homeEdge != null && homeEdge >= SPREAD_EDGE_THRESHOLD;
  return (
    <td style={{ ...CP, textAlign: "center", padding: 0 }}>
      <BookLink bookKey={book}>
        <div style={{ padding: "0.15rem 0.5rem", background: goodAway ? GOOD_VALUE_BG : undefined }}>
          {fmtPoint(odds.spreadAway)} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.spreadAwayPrice)}</span>
        </div>
        <div style={{ padding: "0.15rem 0.5rem", background: goodHome ? GOOD_VALUE_BG : undefined }}>
          {fmtPoint(odds.spreadHome)} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.spreadHomePrice)}</span>
        </div>
      </BookLink>
    </td>
  );
}

function bestSpread(row: OddsMatchRow, side: "away" | "home"): { book: string; value: number } | null {
  const books = booksPresent(row);
  const values = books.map((b) => (side === "away" ? row.books[b]!.spreadAway : row.books[b]!.spreadHome));
  const i = bestIndex(values, (a, b) => a > b); // biggest number = most points = best price for either side of a spread
  return i === -1 ? null : { book: books[i], value: values[i]! };
}

type SpreadSortKey = "week" | "date" | "awayTeam" | "homeTeam" | "bestAway" | "bestHome";

function OddscreenSpread({ rows }: { rows: OddsMatchRow[] }) {
  const [sortKey, setSortKey] = useState<SpreadSortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(k: string) {
    const key = k as SpreadSortKey;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const val = (r: OddsMatchRow): number | string => {
      switch (sortKey) {
        case "week":
          return r.game.game.week;
        case "date":
          return r.game.game.startDate ?? "";
        case "awayTeam":
          return r.game.game.awayTeam;
        case "homeTeam":
          return r.game.game.homeTeam;
        case "bestAway":
          return bestSpread(r, "away")?.value ?? -Infinity;
        case "bestHome":
          return bestSpread(r, "home")?.value ?? -Infinity;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sortKey, sortDir]);

  const sh = (label: string, key: SpreadSortKey) => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("Wk", "week")}
            {sh("Date", "date")}
            <th style={CP}>Kickoff</th>
            {sh("Away", "awayTeam")}
            {sh("Home", "homeTeam")}
            <th style={CP}>My Line</th>
            {sh("Best Away", "bestAway")}
            {sh("Best Home", "bestHome")}
            {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => (
              <th key={b} style={CP}>
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
                <td style={CP}>{r.game.game.week}</td>
                <td style={CP}>{dateLabel(r.game.game.startDate)}</td>
                <td style={CP}>{kickoffLabel(r.game.game.startDate)}</td>
                <td style={CP}>{r.game.game.awayTeam}</td>
                <td style={CP}>{r.game.game.homeTeam}</td>
                <td style={{ ...CP, textAlign: "center" }}>
                  <div>{fmtPoint(my.myAwaySpread)}</div>
                  <div>{fmtPoint(my.myHomeSpread)}</div>
                </td>
                <td style={{ ...CP, textAlign: "center", background: bestAway ? BEST_LINE_BG : undefined }}>
                  {bestAway ? (
                    <BookLink bookKey={bestAway.book}>
                      {fmtPoint(bestAway.value)} <span style={{ opacity: 0.6 }}>{BOOK_META[bestAway.book]?.label}</span>
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                <td style={{ ...CP, textAlign: "center", background: bestHome ? BEST_LINE_BG : undefined }}>
                  {bestHome ? (
                    <BookLink bookKey={bestHome.book}>
                      {fmtPoint(bestHome.value)} <span style={{ opacity: 0.6 }}>{BOOK_META[bestHome.book]?.label}</span>
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => (
                  <SpreadCell key={b} book={b} odds={r.books[b]} my={my} />
                ))}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
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
function MoneylineCell({ book, odds, my }: { book: string; odds: BookOdds | undefined; my: MyLine }) {
  if (!odds || (odds.mlHome == null && odds.mlAway == null)) {
    return <td style={{ ...CP, textAlign: "center", color: "var(--chalk-dim)" }}>–</td>;
  }
  const awayEdge = moneylineEdgePct(my.myAwayWinPct, odds.mlAway);
  const homeEdge = moneylineEdgePct(my.myHomeWinPct, odds.mlHome);
  const goodAway = awayEdge != null && awayEdge >= ML_EDGE_THRESHOLD;
  const goodHome = homeEdge != null && homeEdge >= ML_EDGE_THRESHOLD;
  return (
    <td style={{ ...CP, textAlign: "center", padding: 0 }}>
      <BookLink bookKey={book}>
        <div style={{ padding: "0.15rem 0.5rem", background: goodAway ? GOOD_VALUE_BG : undefined }}>{fmtPrice(odds.mlAway)}</div>
        <div style={{ padding: "0.15rem 0.5rem", background: goodHome ? GOOD_VALUE_BG : undefined }}>{fmtPrice(odds.mlHome)}</div>
      </BookLink>
    </td>
  );
}

function bestMoneyline(row: OddsMatchRow, side: "away" | "home"): { book: string; value: number } | null {
  const books = booksPresent(row);
  const values = books.map((b) => (side === "away" ? row.books[b]!.mlAway : row.books[b]!.mlHome));
  // Best price for the bettor: for a favorite (negative) the least negative wins; for a dog (positive) the most positive wins.
  // Comparing raw American-odds values with ">" happens to get this right in both cases (-105 > -110, +250 > +200).
  const i = bestIndex(values, (a, b) => a > b);
  return i === -1 ? null : { book: books[i], value: values[i]! };
}

type MlSortKey = "week" | "date" | "awayTeam" | "homeTeam" | "bestAway" | "bestHome";

function OddscreenMoneyline({ rows }: { rows: OddsMatchRow[] }) {
  const [sortKey, setSortKey] = useState<MlSortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(k: string) {
    const key = k as MlSortKey;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const val = (r: OddsMatchRow): number | string => {
      switch (sortKey) {
        case "week":
          return r.game.game.week;
        case "date":
          return r.game.game.startDate ?? "";
        case "awayTeam":
          return r.game.game.awayTeam;
        case "homeTeam":
          return r.game.game.homeTeam;
        case "bestAway":
          return bestMoneyline(r, "away")?.value ?? -Infinity;
        case "bestHome":
          return bestMoneyline(r, "home")?.value ?? -Infinity;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sortKey, sortDir]);

  const sh = (label: string, key: MlSortKey) => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("Wk", "week")}
            {sh("Date", "date")}
            <th style={CP}>Kickoff</th>
            {sh("Away", "awayTeam")}
            {sh("Home", "homeTeam")}
            <th style={CP}>My Line</th>
            {sh("Best Away", "bestAway")}
            {sh("Best Home", "bestHome")}
            {BOOK_ORDER.map((b) => (
              <th key={b} style={CP}>
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
                <td style={CP}>{r.game.game.week}</td>
                <td style={CP}>{dateLabel(r.game.game.startDate)}</td>
                <td style={CP}>{kickoffLabel(r.game.game.startDate)}</td>
                <td style={CP}>{r.game.game.awayTeam}</td>
                <td style={CP}>{r.game.game.homeTeam}</td>
                <td style={{ ...CP, textAlign: "center" }}>
                  <div>{fmtPrice(my.myAwayMl)}</div>
                  <div>{fmtPrice(my.myHomeMl)}</div>
                </td>
                <td style={{ ...CP, textAlign: "center", background: bestAway ? BEST_LINE_BG : undefined }}>
                  {bestAway ? (
                    <BookLink bookKey={bestAway.book}>
                      {fmtPrice(bestAway.value)} <span style={{ opacity: 0.6 }}>{BOOK_META[bestAway.book]?.label}</span>
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                <td style={{ ...CP, textAlign: "center", background: bestHome ? BEST_LINE_BG : undefined }}>
                  {bestHome ? (
                    <BookLink bookKey={bestHome.book}>
                      {fmtPrice(bestHome.value)} <span style={{ opacity: 0.6 }}>{BOOK_META[bestHome.book]?.label}</span>
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                {BOOK_ORDER.map((b) => (
                  <MoneylineCell key={b} book={b} odds={r.books[b]} my={my} />
                ))}
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
function TotalCell({ book, odds, myTotal }: { book: string; odds: BookOdds | undefined; myTotal: number | null }) {
  if (!odds || odds.totalPoint == null) {
    return <td style={{ ...CP, textAlign: "center", color: "var(--chalk-dim)" }}>–</td>;
  }
  const { amountOff, call } = totalCall(myTotal, odds.totalPoint);
  const good = amountOff != null && Math.abs(amountOff) >= TOTAL_EDGE_THRESHOLD;
  return (
    <td style={{ ...CP, textAlign: "center", padding: "0.15rem 0.5rem", background: good ? GOOD_VALUE_BG : undefined }}>
      <BookLink bookKey={book}>
        <div>
          O {odds.totalPoint} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.overPrice)}</span>
        </div>
        <div>
          U {odds.totalPoint} <span style={{ opacity: 0.6 }}>{fmtPrice(odds.underPrice)}</span>
        </div>
        {good && <div style={{ fontSize: "0.68rem", opacity: 0.85 }}>{call}</div>}
      </BookLink>
    </td>
  );
}

function bestTotal(row: OddsMatchRow, side: "over" | "under"): { book: string; value: number } | null {
  const books = booksPresent(row);
  const values = books.map((b) => row.books[b]!.totalPoint);
  // Best Over = lowest total (easiest to clear); best Under = highest total (easiest to stay below).
  const i = bestIndex(values, side === "over" ? (a, b) => a < b : (a, b) => a > b);
  return i === -1 ? null : { book: books[i], value: values[i]! };
}

type TotalSortKey = "week" | "date" | "awayTeam" | "homeTeam" | "bestOver" | "bestUnder";

function OddscreenTotal({ rows }: { rows: OddsMatchRow[] }) {
  const [sortKey, setSortKey] = useState<TotalSortKey>("week");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(k: string) {
    const key = k as TotalSortKey;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const val = (r: OddsMatchRow): number | string => {
      switch (sortKey) {
        case "week":
          return r.game.game.week;
        case "date":
          return r.game.game.startDate ?? "";
        case "awayTeam":
          return r.game.game.awayTeam;
        case "homeTeam":
          return r.game.game.homeTeam;
        case "bestOver":
          return bestTotal(r, "over")?.value ?? Infinity;
        case "bestUnder":
          return bestTotal(r, "under")?.value ?? -Infinity;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [rows, sortKey, sortDir]);

  const sh = (label: string, key: TotalSortKey) => (
    <SortHeader label={label} sortKey={key} active={sortKey === key} dir={sortDir} onClick={handleSort} />
  );

  return (
    <div className="table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {sh("Wk", "week")}
            {sh("Date", "date")}
            <th style={CP}>Kickoff</th>
            {sh("Away", "awayTeam")}
            {sh("Home", "homeTeam")}
            <th style={CP}>My Total</th>
            {sh("Best Over", "bestOver")}
            {sh("Best Under", "bestUnder")}
            {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => (
              <th key={b} style={CP}>
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
                <td style={CP}>{r.game.game.week}</td>
                <td style={CP}>{dateLabel(r.game.game.startDate)}</td>
                <td style={CP}>{kickoffLabel(r.game.game.startDate)}</td>
                <td style={CP}>{r.game.game.awayTeam}</td>
                <td style={CP}>{r.game.game.homeTeam}</td>
                <td style={{ ...CP, textAlign: "center" }}>{my.myTotal != null ? my.myTotal.toFixed(1) : "–"}</td>
                <td style={{ ...CP, textAlign: "center", background: bestOver ? BEST_LINE_BG : undefined }}>
                  {bestOver ? (
                    <BookLink bookKey={bestOver.book}>
                      O {bestOver.value} <span style={{ opacity: 0.6 }}>{BOOK_META[bestOver.book]?.label}</span>
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                <td style={{ ...CP, textAlign: "center", background: bestUnder ? BEST_LINE_BG : undefined }}>
                  {bestUnder ? (
                    <BookLink bookKey={bestUnder.book}>
                      U {bestUnder.value} <span style={{ opacity: 0.6 }}>{BOOK_META[bestUnder.book]?.label}</span>
                    </BookLink>
                  ) : (
                    "–"
                  )}
                </td>
                {BOOK_ORDER.filter((b) => b !== "kalshi").map((b) => (
                  <TotalCell key={b} book={b} odds={r.books[b]} myTotal={my.myTotal} />
                ))}
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
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
// Game Cards
// ---------------------------------------------------------------------
function GameCard({ row }: { row: OddsMatchRow }) {
  const [expanded, setExpanded] = useState(false);
  const bestAwaySpread = bestSpread(row, "away");
  const bestHomeSpread = bestSpread(row, "home");
  const bestAwayMl = bestMoneyline(row, "away");
  const bestHomeMl = bestMoneyline(row, "home");
  const bestOver = bestTotal(row, "over");
  const bestUnder = bestTotal(row, "under");

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "8px",
        padding: "0.75rem",
        marginBottom: "0.6rem",
        cursor: "pointer",
      }}
      onClick={() => setExpanded((e) => !e)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "0.85rem" }}>
        <div>
          <strong>{row.game.game.awayTeam}</strong> @ <strong>{row.game.game.homeTeam}</strong>
        </div>
        <div style={{ color: "var(--chalk-dim)", fontSize: "0.75rem" }}>
          Wk {row.game.game.week} · {dateLabel(row.game.game.startDate)} {kickoffLabel(row.game.game.startDate)}
        </div>
      </div>
      <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.5rem", fontSize: "0.78rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "var(--chalk-dim)" }}>Best Spread</div>
          {bestAwaySpread && (
            <div onClick={(e) => e.stopPropagation()}>
              <BookLink bookKey={bestAwaySpread.book}>
                {row.game.game.awayTeam} {fmtPoint(bestAwaySpread.value)} ({BOOK_META[bestAwaySpread.book]?.label})
              </BookLink>
            </div>
          )}
          {bestHomeSpread && (
            <div onClick={(e) => e.stopPropagation()}>
              <BookLink bookKey={bestHomeSpread.book}>
                {row.game.game.homeTeam} {fmtPoint(bestHomeSpread.value)} ({BOOK_META[bestHomeSpread.book]?.label})
              </BookLink>
            </div>
          )}
        </div>
        <div>
          <div style={{ color: "var(--chalk-dim)" }}>Best Moneyline</div>
          {bestAwayMl && (
            <div onClick={(e) => e.stopPropagation()}>
              <BookLink bookKey={bestAwayMl.book}>
                {row.game.game.awayTeam} {fmtPrice(bestAwayMl.value)} ({BOOK_META[bestAwayMl.book]?.label})
              </BookLink>
            </div>
          )}
          {bestHomeMl && (
            <div onClick={(e) => e.stopPropagation()}>
              <BookLink bookKey={bestHomeMl.book}>
                {row.game.game.homeTeam} {fmtPrice(bestHomeMl.value)} ({BOOK_META[bestHomeMl.book]?.label})
              </BookLink>
            </div>
          )}
        </div>
        <div>
          <div style={{ color: "var(--chalk-dim)" }}>Best Total</div>
          {bestOver && (
            <div onClick={(e) => e.stopPropagation()}>
              <BookLink bookKey={bestOver.book}>
                O {bestOver.value} ({BOOK_META[bestOver.book]?.label})
              </BookLink>
            </div>
          )}
          {bestUnder && (
            <div onClick={(e) => e.stopPropagation()}>
              <BookLink bookKey={bestUnder.book}>
                U {bestUnder.value} ({BOOK_META[bestUnder.book]?.label})
              </BookLink>
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div style={{ marginTop: "0.75rem" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ marginBottom: "0.3rem", fontSize: "0.72rem", color: "var(--chalk-dim)" }}>Spread</div>
          <OddscreenSpread rows={[row]} />
          <div style={{ margin: "0.6rem 0 0.3rem", fontSize: "0.72rem", color: "var(--chalk-dim)" }}>Moneyline</div>
          <OddscreenMoneyline rows={[row]} />
          <div style={{ margin: "0.6rem 0 0.3rem", fontSize: "0.72rem", color: "var(--chalk-dim)" }}>Total</div>
          <OddscreenTotal rows={[row]} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
type TopView = "cards" | "oddscreen";
type OddscreenTab = "spread" | "moneyline" | "total";

export default function OddsDashboardAdminPanel({ onBack }: { onBack: () => void }) {
  const [season, setSeason] = useState(new Date().getFullYear());
  const [division, setDivision] = useState("FBS");
  const { rows: allRows, loading: loadingSite, error: siteError } = useGameTotalsEngine(season);
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

  const loading = loadingSite || loadingOdds;

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

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
        <SeasonPicker season={season} setSeason={setSeason} />
        <DivisionPicker division={division} setDivision={setDivision} />
        <button className="menu-btn" onClick={handleRefresh} disabled={loadingOdds}>
          {loadingOdds ? "Refreshing…" : "Refresh odds"}
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
          <button className={topView === "cards" ? "menu-btn active" : "menu-btn"} onClick={() => setTopView("cards")}>
            Game Cards
          </button>
          <button className={topView === "oddscreen" ? "menu-btn active" : "menu-btn"} onClick={() => setTopView("oddscreen")}>
            Oddscreen
          </button>
        </div>
      </div>

      {siteError && <p style={{ color: "crimson" }}>{siteError}</p>}
      {oddsError && <p style={{ color: "crimson" }}>Odds feed: {oddsError}</p>}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : topView === "cards" ? (
        <div>
          {matched.length === 0 && <div className="empty">No matched games yet for this season/division.</div>}
          {matched
            .slice()
            .sort((a, b) => a.game.game.week - b.game.game.week || String(a.game.game.startDate).localeCompare(String(b.game.game.startDate)))
            .map((row) => (
              <GameCard key={row.game.game.id} row={row} />
            ))}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem" }}>
            <button className={oddscreenTab === "spread" ? "menu-btn active" : "menu-btn"} onClick={() => setOddscreenTab("spread")}>
              Spread
            </button>
            <button className={oddscreenTab === "moneyline" ? "menu-btn active" : "menu-btn"} onClick={() => setOddscreenTab("moneyline")}>
              Moneyline
            </button>
            <button className={oddscreenTab === "total" ? "menu-btn active" : "menu-btn"} onClick={() => setOddscreenTab("total")}>
              Total
            </button>
          </div>
          {oddscreenTab === "spread" && <OddscreenSpread rows={matched} />}
          {oddscreenTab === "moneyline" && <OddscreenMoneyline rows={matched} />}
          {oddscreenTab === "total" && <OddscreenTotal rows={matched} />}
        </div>
      )}
    </div>
  );
}
