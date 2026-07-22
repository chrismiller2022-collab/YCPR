export function fmtOdds(v) {
  if (v == null) return "–";
  return `${v > 0 ? "+" : ""}${v}`;
}

export function fmtPct(v) {
  if (v == null) return "–";
  return `${(v * 100).toFixed(2)}%`;
}

export function fmtNum(v, decimals = 2) {
  if (v == null) return "–";
  return v.toFixed(decimals);
}


export function dateLabelFor(game) {
  const dateObj = new Date(game.date);
  return dateObj.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}
