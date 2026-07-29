export default function FAQPage({ onHome }: { onHome?: () => void }) {
  return (
    <div className="matchups-page">
      <div className="team-hero">
        <button className="back-link" onClick={onHome}>
          ‹ All rankings
        </button>
        <div className="eyebrow">FAQ</div>
        <h1 className="title matchup-title">How the Ratings Work</h1>
        <p className="subtitle team-subtitle">
          What a power rating actually means, how we turn two ratings into a
          projected point spread, and how that compares to a Vegas line.
        </p>
      </div>

      <div className="table-wrap">
        <div className="section-label">What is a power rating?</div>
        <p style={{ lineHeight: 1.6 }}>
          Every team gets a single power rating meant to capture its overall
          quality — think of it as "how many points better or worse than an
          average team is this squad, on a neutral field." On this site,{" "}
          <strong>lower (more negative) is better</strong>. Ohio State
          sitting at around <strong>-29</strong> means the model thinks
          they're roughly 29 points better than an average team; a team at{" "}
          <strong>+20</strong> is judged to be about 20 points worse than
          average. The rating itself doesn't mean anything in isolation — its
          value comes from comparing two teams' ratings against each other.
        </p>
      </div>

      <div className="table-wrap">
        <div className="section-label">How we turn two ratings into a spread</div>
        <p style={{ lineHeight: 1.6 }}>
          For any matchup, we take the difference between the two teams'
          ratings, then add a home-field boost (worth roughly{" "}
          <strong>2.4 points</strong> by default, or a team-specific number
          where we have one) to whichever team is playing at home. That's
          the entire projected spread — no adjustment for public betting
          money, injury news, or "narrative."
        </p>
        <p style={{ lineHeight: 1.6 }}>
          In plain terms: <em>spread = (away team's rating) − (home team's rating) + (home field boost)</em>.
          A negative result means the home team is favored by that many
          points; a positive result means the away team is favored.
        </p>
      </div>

      <div className="table-wrap">
        <div className="section-label">Worked examples</div>

        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
            Two powerhouses — Alabama at Georgia
          </div>
          <p style={{ lineHeight: 1.6 }}>
            Georgia (rating ≈ -21.8) hosts Alabama (rating ≈ -20.8). The raw
            gap between two elite teams is small — about 1 point — so once
            you add Georgia's home-field boost, the projected line comes out
            to roughly <strong>Georgia -3.5</strong>. Both teams are
            excellent; the spread here is really just "home field plus a
            hair of a quality edge," not a reflection of one team being
            actually bad.
          </p>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
            Two bad teams — Sam Houston at Massachusetts
          </div>
          <p style={{ lineHeight: 1.6 }}>
            Neither of these teams grades out well (both rated below
            average), but the model doesn't care about "good" or "bad" in
            absolute terms — only the gap between the two. Sam Houston
            (rating ≈ +22.5) is still meaningfully better than Massachusetts
            (rating ≈ +30.6), so even on the road, Sam Houston projects as
            roughly a <strong>5.5-point favorite</strong>. Two bad teams can
            still produce a real, lopsided spread.
          </p>
        </div>

        <div style={{ marginBottom: "0.5rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
            Good vs. bad — Massachusetts at Ohio State
          </div>
          <p style={{ lineHeight: 1.6 }}>
            This is where the gap really shows: Ohio State (rating ≈ -29.3)
            hosting Massachusetts (rating ≈ +30.6) produces a projected
            spread north of <strong>60 points</strong>. In practice, real
            sportsbooks typically cap posted lines well below that (often
            in the 40s-50s) for reputational and liability reasons — but our
            model has no such ceiling, so it'll show you the true scale of
            the mismatch even when no book would actually post that number.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        <div className="section-label">How this differs from the Vegas line</div>
        <p style={{ lineHeight: 1.6 }}>
          A Vegas line isn't a pure quality projection — it's a price, shaped
          by where sportsbooks expect money to land on each side, plus
          injury reports, weather, short-week/travel situations, and
          "trap game" narratives the market is pricing in. Two things follow
          from that:
        </p>
        <ul style={{ lineHeight: 1.8, paddingLeft: "1.25rem" }}>
          <li>
            Our number is a snapshot of team quality plus home field — it
            won't move because of an injury, a weather forecast, or heavy
            public betting on one side.
          </li>
          <li>
            Vegas lines move continuously as money comes in; our rating only
            updates when we refresh the underlying power ratings (typically
            weekly).
          </li>
        </ul>
      </div>

      <div className="table-wrap">
        <div className="section-label">When your own number differs from Vegas</div>
        <p style={{ lineHeight: 1.6 }}>
          If our projected spread and the actual Vegas line disagree by a
          meaningful margin — say, we have a team as a 3-point favorite but
          the market has them at +2 — that gap is sometimes read as a signal
          that the market may be pricing in something our rating doesn't
          capture (or, just as often, something the market knows that our
          rating can't see, like a key injury). A persistent, sizeable gap is
          the kind of thing bettors use as one input among several, not a
          standalone signal to act on by itself.
        </p>
        <p style={{ lineHeight: 1.6, marginTop: "0.75rem" }}>
          A few things worth keeping in mind before treating any gap as
          "value": a single power-rating model is only ever one opinion, it
          can be wrong, and it can't see everything a market-driven Vegas
          line accounts for. This page is meant to explain how the numbers
          on this site are built, not as betting advice — sports betting
          carries real financial risk, so treat any gap between our number
          and the market as a starting point for your own research, not a
          conclusion.
        </p>
      </div>
    </div>
  );
}
