import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import SortHeader from "../components/SortHeader";
import TeamLogo from "../components/TeamLogo";
import { spreadToWinPct, fairMoneylineFromWinPct } from "../lib/odds";
import { useGameTotalsEngine } from "../lib/gameTotalsEngine";
import { fetchOddsFeed, invalidateOddsFeed, BOOK_META, BOOK_ORDER } from "../lib/api/oddsApi";
import { fetchKalshiCfbMarkets, type KalshiGame } from "../lib/api/kalshi";
import type { OddsGame } from "../lib/api/oddsApi";
import { matchOddsGames, type OddsMatchRow, type BookOdds } from "../lib/oddsMatch";
import { moneylineEdgePct, spreadEdgePts, totalCall, bestIndex, SPREAD_EDGE_THRESHOLD, TOTAL_EDGE_THRESHOLD, ML_EDGE_THRESHOLD } from "../lib/oddsValue";
import { SeasonPicker, DivisionPicker, filterRowsByDivision } from "./GameTotalsAdminPanel";

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

function GameCard({ row }: { row: OddsMatchRow }) {
  const [expanded, setExpanded] = useState(false);
  const bestAwaySpread = bestSpread(row, "away");
  const bestHomeSpread = bestSpread(row, "home");
  const bestAwayMl = bestMoneyline(row, "away");
  const bestHomeMl = bestMoneyline(row, "home");
  const bestOver = bestTotal(row, "over");
  const bestUnder = bestTotal(row, "under");

  const teamRow = (team: string, spread: { book: string; value: number } | null, ml: { book: string; value: number } | null) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.4rem 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
        <TeamLogo team={team} size={26} />
        <span style={{ fontWeight: 700, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team}</span>
      </div>
      <div style={{ display: "flex", gap: "1rem", flexShrink: 0 }}>
        <ValueChip label="Spread" best={spread ? fmtPoint(spread.value) : "–"} book={spread?.book} />
        <ValueChip label="ML" best={ml ? fmtPrice(ml.value) : "–"} book={ml?.book} />
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
      <div style={{ fontSize: "0.7rem", color: "var(--chalk-dim)", marginBottom: "0.3rem" }}>
        Wk {row.game.game.week} · {dateLabel(row.game.game.startDate)} · {kickoffLabel(row.game.game.startDate)}
      </div>

      {teamRow(row.game.game.awayTeam, bestAwaySpread, bestAwayMl)}
      <div style={{ borderTop: "1px solid var(--hash)" }} />
      {teamRow(row.game.game.homeTeam, bestHomeSpread, bestHomeMl)}

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
        <span style={{ fontSize: "0.62rem", color: "var(--chalk-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Total</span>
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
          <button className={`mode-btn ${topView === "cards" ? "mode-btn-active" : ""}`} onClick={() => setTopView("cards")}>
            Game Cards
          </button>
          <button className={`mode-btn ${topView === "oddscreen" ? "mode-btn-active" : ""}`} onClick={() => setTopView("oddscreen")}>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
            {matched
              .slice()
              .sort((a, b) => a.game.game.week - b.game.game.week || String(a.game.game.startDate).localeCompare(String(b.game.game.startDate)))
              .map((row) => (
                <GameCard key={row.game.game.id} row={row} />
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
          {oddscreenTab === "spread" && <OddscreenSpread rows={matched} />}
          {oddscreenTab === "moneyline" && <OddscreenMoneyline rows={matched} />}
          {oddscreenTab === "total" && <OddscreenTotal rows={matched} />}
        </div>
      )}
    </div>
  );
}
