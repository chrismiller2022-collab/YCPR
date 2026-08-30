import TeamLogo from "./TeamLogo";
import { spreadColor } from "../lib/odds";
import type { ImageDumpTeamRow } from "../lib/imageDump";

// Static (non-interactive) replica of HomePage.tsx's live table — same
// markup, same CSS classes (home-table / rating-cell / wintotals-total-cell
// / mini-rank-flag / conf-cell / div-pill / team-link / change-cell), so a
// captured PNG of this looks identical to "the reg table" on the public
// site, per Chris's instruction that Top 25/Gainers/Losers/G6 images should
// just be the real table, not a bespoke compact graphic. Deliberately not
// reusing HomePage's JSX directly (no shared component was extracted) —
// see imageDump.ts's file header for why the two are kept independent.
export default function RankedTeamsTableGraphic({
  title,
  rows,
}: {
  title: string;
  rows: ImageDumpTeamRow[];
}) {
  return (
    <div style={{ background: "#1f2041", padding: "18px 22px", width: "fit-content" }}>
      <div
        style={{
          fontSize: 19,
          fontWeight: 800,
          letterSpacing: "0.04em",
          color: "#fff",
          marginBottom: 14,
        }}
      >
        {title}
      </div>
      {/* Inline width:auto overrides the site-wide `table { width: 100% }`
          rule in global.css. On the live page that rule is fine because
          .table-wrap gives the table a fixed max-width to stretch against;
          this graphic has no such ancestor (it's captured off-screen with
          nothing to anchor a percentage width to), so without this override
          the table stretched to the full off-screen canvas width with all
          its content squeezed into one corner. Same fix the site itself
          already uses elsewhere for this exact rule (see the
          .preseason-ratings-page .table-scroll table override in
          global.css). */}
      <table className="home-table" style={{ width: "auto" }}>
        <thead>
          <tr>
            <th className="th">Team</th>
            <th className="th">Conference</th>
            <th className="th">Record</th>
            <th className="th th-right">Power Rating</th>
            <th className="th th-right">Proj. Win Total</th>
            <th className="th th-right">Proj. Conf Win Total</th>
            <th className="th th-right">YC Resume Rating</th>
            <th className="th th-right">SOR</th>
            <th className="th th-right">Change from Last Week</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.team}>
              <td>
                <span className="team-link">
                  <TeamLogo team={t} />
                  {t.team}
                </span>
                <span className={`div-pill ${t.div === "FBS" ? "div-fbs" : "div-fcs"}`}>{t.div}</span>
              </td>
              <td className="conf-cell">{t.conf}</td>
              <td className="wintotals-record-cell">0-0</td>
              <td className={`rating-cell ${t.rating < 0 ? "rating-good" : "rating-bad"}`}>
                <span className="mini-rank-flag">{t.rank}</span>
                {t.rating > 0 ? "+" : ""}
                {t.rating.toFixed(2)}
              </td>
              <td className="wintotals-total-cell">
                <span className="mini-rank-flag">{t.winTotalRank}</span>
                {t.winTotal.toFixed(2)}
              </td>
              <td className="wintotals-total-cell">
                <span className="mini-rank-flag">{t.confWinTotalRank}</span>
                {t.confWinTotal.toFixed(2)}
              </td>
              <td className="wintotals-total-cell">
                {t.resumeRating != null ? (
                  <>
                    <span className="mini-rank-flag">{t.resumeRank}</span>
                    {t.resumeRating.toFixed(2)}
                  </>
                ) : (
                  "–"
                )}
              </td>
              <td className="wintotals-total-cell" style={t.sos != null ? { color: spreadColor(t.sos) } : undefined}>
                {t.sos != null ? (
                  <>
                    <span className="mini-rank-flag">{t.sosRank}</span>
                    {(t.sos > 0 ? "+" : "") + t.sos.toFixed(2)}
                  </>
                ) : (
                  "–"
                )}
              </td>
              <td
                className="wintotals-total-cell change-cell"
                style={t.change != null ? { color: spreadColor(t.change) } : undefined}
              >
                {t.change != null ? `${t.change > 0 ? "+" : ""}${t.change.toFixed(2)}` : "–"}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
                No teams to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
