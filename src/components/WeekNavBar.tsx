import { useNavigate } from "react-router-dom";
import { WEEKS } from "../data/games";

const MIN_WEEK = 1;
const MAX_WEEK = WEEKS.length;

// Small prev/next strip shown above a weekly page's own hero, so a
// visitor on Week 3 can jump to Week 2 or Week 4 without going back
// into the nav menu. Deliberately doesn't check whether the target
// week actually has saved data — landing on an empty/"coming soon"
// week is fine, per product decision.
export default function WeekNavBar({
  basePath,
  week,
  minWeek = MIN_WEEK,
  maxWeek = MAX_WEEK,
}: {
  basePath: string;
  week: number;
  minWeek?: number;
  maxWeek?: number;
}) {
  const navigate = useNavigate();
  const prev = week - 1;
  const next = week + 1;
  const showPrev = prev >= minWeek;
  const showNext = next <= maxWeek;

  if (!showPrev && !showNext) return null;

  return (
    <div className="week-nav-bar">
      {showPrev ? (
        <button
          type="button"
          className="week-nav-btn week-nav-prev"
          onClick={() => {
            navigate(`${basePath}/${prev}`);
            window.scrollTo?.(0, 0);
          }}
        >
          ‹ Week {prev}
        </button>
      ) : (
        <span />
      )}
      {showNext ? (
        <button
          type="button"
          className="week-nav-btn week-nav-next"
          onClick={() => {
            navigate(`${basePath}/${next}`);
            window.scrollTo?.(0, 0);
          }}
        >
          Week {next} ›
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}
