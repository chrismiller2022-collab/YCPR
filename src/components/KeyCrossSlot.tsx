import { keyNumbersBetween, keyCrossLabel } from "../lib/keyNumberCross";

const fmt = (v: number | null) => (v == null ? "–" : v > 0 ? `+${v}` : `${v}`);

// Fixed-width slot after a pool's line input for the "crosses a key number" flag. Rows without a key keep the
// empty slot, so every input in the column starts at the same x position.
export default function KeyCrossSlot({ mine, pool }: { mine: number | null; pool: number | null }) {
  const crossed = keyNumbersBetween(mine, pool);
  return (
    <span
      title={crossed.length ? `My line (${fmt(mine)}) and the pool line (${fmt(pool)}) are on opposite sides of ${keyCrossLabel(crossed)}` : undefined}
      style={{
        display: "inline-block",
        width: "4.4rem",
        marginLeft: "0.25rem",
        verticalAlign: "middle",
        textAlign: "left",
        fontSize: "0.65rem",
        lineHeight: 1.1,
        fontWeight: 700,
        color: "var(--gold, #d4af37)",
      }}
    >
      {crossed.length ? `🔑${keyCrossLabel(crossed)}` : null}
    </span>
  );
}
