import { MAX_ABS } from "../data/teams";

export default function RatingBar({ rating }: any) {
  const pct = (Math.abs(rating) / MAX_ABS) * 50;
  const isGood = rating < 0;
  return (
    <div className="bar-track">
      <div className="bar-center" />
      <div
        className={`bar-fill ${isGood ? "bar-good" : "bar-bad"}`}
        style={{
          width: `${pct}%`,
          left: isGood ? `${50 - pct}%` : "50%",
        }}
      />
    </div>
  );
}
